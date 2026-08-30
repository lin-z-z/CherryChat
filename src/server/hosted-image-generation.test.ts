import { describe, expect, it, vi } from "vitest";

import type {
  HostedImageGenerationConfig,
  ServerConfig,
} from "@/server/config";
import { handleHostedImageGeneration } from "@/server/hosted-image-generation";
import { HostedRequestGuard } from "@/server/hosted-request-guard";
import { MAX_IMAGE_GENERATION_RESPONSE_BYTES } from "@/runtime/image-generation/image-generation-contract";
import { ACCESS_CODE_HEADER_NAME } from "@/server/auth";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const config: ServerConfig = {
  baseUrl: "https://chat.example/api",
  models: ["chat-model"],
  defaultModel: "chat-model",
  titleModel: "chat-model",
  disableByok: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
  hosted: {
    apiKey: "chat-deployment-key",
    accessCodes: ["access-code"],
    authSecret: "h".repeat(32),
    webSearch: null,
    imageGeneration: {
      apiKey: "image-deployment-key",
      baseUrl: "https://images.example/v1",
      model: "deployment-image-model",
      timeoutMs: 5_000,
      maximumRequestBytes: 4 * 1024 * 1024,
    },
  },
};

describe("hosted image generation", () => {
  it("uses the fixed generation target and deployment model without leaking secrets", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const response = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      (async (input, init) => {
        calls.push([input, init]);
        return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
      }) as typeof fetch,
      createGuard(),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("image-deployment-key");
    expect(text).not.toContain("images.example");
    expect(calls).toHaveLength(1);
    const [target, init] = calls[0] ?? [];
    expect(target).toBe("https://images.example/v1/images/generations");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer image-deployment-key",
    );
    expect(new Headers(init?.headers).has(ACCESS_CODE_HEADER_NAME)).toBe(false);
    expect(String(init?.body)).not.toContain("access-code");
    expect(JSON.parse(String(init?.body))).toEqual({
      ...requestBody(),
      model: "deployment-image-model",
      output_format: "png",
    });
  });

  it("selects only configured Hosted profiles and rejects unknown profile ids", async () => {
    const profileConfig = withImageConfig({
      profiles: [
        {
          id: "standard",
          name: "Standard",
          apiKey: "standard-image-key",
          baseUrl: "https://standard.images.example",
          model: "gpt-image-1.5",
          sizeMode: "fixed",
        },
        {
          id: "portrait",
          name: "Portrait",
          apiKey: "portrait-image-key",
          baseUrl: "https://portrait.images.example",
          model: "gpt-image-2",
          sizeMode: "auto",
        },
      ],
      defaultProfileId: "standard",
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ b64_json: PNG_BASE64 }] }),
    );
    const response = await handleHostedImageGeneration(
      imageRequest(
        JSON.stringify({
          ...requestBody(),
          profileId: "portrait",
          size: "1440x2560",
          output_format: "webp",
          output_compression: 82,
        }),
        "application/json",
      ),
      profileConfig,
      fetchMock,
      createGuard(),
    );

    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0] ?? [];
    expect(target).toBe(
      "https://portrait.images.example/v1/images/generations",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer portrait-image-key",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-image-2",
      size: "1440x2560",
      output_format: "webp",
      output_compression: 82,
    });

    const rejectedFetch = vi.fn<typeof fetch>();
    const rejected = await handleHostedImageGeneration(
      imageRequest(
        JSON.stringify({ ...requestBody(), profileId: "unlisted" }),
        "application/json",
      ),
      profileConfig,
      rejectedFetch,
      createGuard(),
    );
    expect(rejected.status).toBe(400);
    expect(rejectedFetch).not.toHaveBeenCalled();
  });

  it("preserves multipart image order and overrides the browser model", async () => {
    const upstreamForms: FormData[] = [];
    const form = new FormData();
    form.set("model", "browser-model");
    form.set("prompt", "Draw a cherry");
    form.set("size", "1024x1024");
    form.set("quality", "auto");
    form.set("n", "1");
    form.append(
      "image[]",
      new File([PNG_BYTES], "first.png", { type: "image/png" }),
    );
    form.append(
      "image[]",
      new File([PNG_BYTES], "second.png", { type: "image/png" }),
    );

    const response = await handleHostedImageGeneration(
      imageRequest(form),
      config,
      (async (_input, init) => {
        upstreamForms.push(init?.body as FormData);
        return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
      }) as typeof fetch,
      createGuard(),
    );

    expect(response.status).toBe(200);
    const upstream = upstreamForms[0];
    expect(upstream?.get("model")).toBe("deployment-image-model");
    expect(
      upstream?.getAll("image[]").map((item) => (item as File).name),
    ).toEqual(["first.png", "second.png"]);
  });

  it("downloads a same-origin URL into Base64 and rejects a cross-origin URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/result.png")) {
        return new Response(PNG_BYTES, {
          headers: { "Content-Type": "image/png" },
        });
      }
      return Response.json({
        data: [{ url: "https://images.example/result.png" }],
      });
    });
    const response = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      fetchMock,
      createGuard(),
    );
    await expect(response.json()).resolves.toEqual({
      data: [{ b64_json: PNG_BASE64 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
    });

    const rejected = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      (async () =>
        Response.json({
          data: [{ url: "https://evil.example/result.png" }],
        })) as typeof fetch,
      createGuard(),
    );
    expect(rejected.status).toBe(502);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_ERROR" },
    });
  });

  it("rejects redirected image downloads without exposing the redirect target", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/result.png")) {
        expect(init).toMatchObject({ redirect: "error" });
        throw new TypeError("redirected to https://evil.example/private.png");
      }
      return Response.json({
        data: [{ url: "https://images.example/result.png" }],
      });
    });

    const response = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      fetchMock,
      createGuard(),
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("private.png");
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "UPSTREAM_ERROR" },
    });
  });

  it("distinguishes upstream timeout, caller cancellation and oversized responses", async () => {
    const timeoutGuard = createGuard();
    const timeoutResponse = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      withImageConfig({ timeoutMs: 10 }),
      hangingFetch(),
      timeoutGuard,
    );
    expect(timeoutResponse.status).toBe(504);
    await expect(timeoutResponse.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TIMEOUT" },
    });
    expect(timeoutGuard.activeCount("image-generation")).toBe(0);

    const controller = new AbortController();
    const cancelledRequest = imageRequest(
      JSON.stringify(requestBody()),
      "application/json",
    );
    Object.defineProperty(cancelledRequest, "signal", {
      value: controller.signal,
    });
    const cancellationGuard = createGuard();
    const cancelled = handleHostedImageGeneration(
      cancelledRequest,
      config,
      hangingFetch(),
      cancellationGuard,
    );
    await vi.waitFor(() => {
      expect(cancellationGuard.activeCount("image-generation")).toBe(1);
    });
    controller.abort();
    const cancelledResponse = await cancelled;
    expect(cancelledResponse.status).toBe(499);
    await expect(cancelledResponse.json()).resolves.toMatchObject({
      error: { code: "ABORTED" },
    });
    expect(cancellationGuard.activeCount("image-generation")).toBe(0);

    const oversizedResponse = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      (async () =>
        new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_IMAGE_GENERATION_RESPONSE_BYTES + 1),
          },
        })) as typeof fetch,
      createGuard(),
    );
    expect(oversizedResponse.status).toBe(502);
    await expect(oversizedResponse.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_ERROR" },
    });
  });

  it("redacts deployment credentials from upstream error details", async () => {
    const response = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json"),
      config,
      (async () =>
        new Response(
          "bad image-deployment-key Bearer another-token sk-secret1234",
          { status: 500 },
        )) as typeof fetch,
      createGuard(),
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("image-deployment-key");
    expect(text).not.toContain("another-token");
    expect(text).not.toContain("sk-secret1234");
    expect(text).toContain("[REDACTED]");
  });

  it("rejects unauthenticated, cross-origin, oversized and malformed requests before fetch", async () => {
    const fetchMock = vi.fn();
    const unauthenticated = await handleHostedImageGeneration(
      new Request("https://cherry.example/api/image-generation", {
        method: "POST",
        headers: {
          Origin: "https://cherry.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody()),
      }),
      config,
      fetchMock as unknown as typeof fetch,
      createGuard(),
    );
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      error: { code: "HOSTED_AUTH_REQUIRED" },
    });

    const revoked = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json", {
        [ACCESS_CODE_HEADER_NAME]: "revoked-code",
      }),
      config,
      fetchMock as unknown as typeof fetch,
      createGuard(),
    );
    expect(revoked.status).toBe(401);
    expect(await revoked.text()).toContain("ACCESS_CODE_INVALID");

    const crossOrigin = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json", {
        Origin: "https://evil.example",
      }),
      config,
      fetchMock as unknown as typeof fetch,
      createGuard(),
    );
    expect(crossOrigin.status).toBe(403);

    const oversized = await handleHostedImageGeneration(
      imageRequest(JSON.stringify(requestBody()), "application/json", {
        "Content-Length": String(4 * 1024 * 1024 + 1),
      }),
      config,
      fetchMock as unknown as typeof fetch,
      createGuard(),
    );
    expect(oversized.status).toBe(413);

    const malformed = await handleHostedImageGeneration(
      imageRequest(
        JSON.stringify({ ...requestBody(), target: "https://evil.example" }),
        "application/json",
      ),
      config,
      fetchMock as unknown as typeof fetch,
      createGuard(),
    );
    expect(malformed.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function requestBody() {
  return {
    model: "browser-model",
    prompt: "Draw a cherry",
    size: "1024x1024",
    quality: "auto",
    n: 1,
  };
}

function imageRequest(
  body: BodyInit,
  contentType?: string,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers = authenticatedHeaders(extraHeaders);
  if (contentType) headers.set("Content-Type", contentType);
  return new Request("https://cherry.example/api/image-generation", {
    method: "POST",
    headers,
    body,
  });
}

function authenticatedHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    Origin: "https://cherry.example",
    [ACCESS_CODE_HEADER_NAME]: config.hosted?.accessCodes[0] ?? "",
    ...extra,
  });
}

function createGuard(): HostedRequestGuard {
  return new HostedRequestGuard({ imageGenerationConcurrencyLimit: 1 });
}

function withImageConfig(
  overrides: Partial<HostedImageGenerationConfig>,
): ServerConfig {
  if (!config.hosted?.imageGeneration) {
    throw new Error("Hosted image generation fixture is missing");
  }
  return {
    ...config,
    hosted: {
      ...config.hosted,
      imageGeneration: {
        ...config.hosted.imageGeneration,
        ...overrides,
      },
    },
  };
}

function hangingFetch(): typeof fetch {
  return ((_target, init) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    })) as typeof fetch;
}
