import { expect, type Page } from "@playwright/test";

import { selectSettingsPage } from "./settings-helpers";

const defaultConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
  hostedWebSearchProvider: null as "tavily" | "exa" | "grok" | null,
  hostedWebSearchProviders: [] as Array<"tavily" | "exa" | "grok">,
  hostedImageGenerationEnabled: false,
  hostedImageGenerationModel: null as string | null,
  hostedImageGenerationProfiles: [] as Array<{
    id: string;
    name: string;
    modelId: string;
    sizeMode: "auto" | "fixed" | "custom";
  }>,
  hostedImageGenerationDefaultProfileId: null as string | null,
  imageGenerationTimeoutMs: 120_000,
  imageGenerationMaximumRequestBytes: 4 * 1024 * 1024,
  models: [] as string[],
  defaultModel: null as string | null,
  titleModel: null as string | null,
  authenticated: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
};

export async function mockConfig(
  page: Page,
  overrides: Partial<typeof defaultConfig> = {},
) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...defaultConfig, ...overrides }),
    });
  });
}

export async function mockModels(page: Page) {
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }),
    });
  });
}

export async function saveByokConnection(
  page: Page,
  mobile: boolean,
  enabledModels: readonly string[] = [],
) {
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsWorkspace = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settingsWorkspace, "Model service");
  await page.getByLabel("API key").fill("test-only-key");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settingsWorkspace.getByText("Connection saved.")).toBeVisible();
  for (const modelId of enabledModels) {
    await settingsWorkspace
      .getByRole("checkbox", { name: `Enable ${modelId}` })
      .click();
  }
  if (enabledModels.length > 0) {
    await expect(
      settingsWorkspace.getByText(
        /Saved automatically with \d+ models enabled/u,
      ),
    ).toBeVisible();
  }
  await settingsWorkspace.getByRole("button", { name: "Close" }).click();
  await expect(settingsWorkspace).toBeHidden();
}

export async function prepareByokPage(page: Page, mobile = false) {
  await mockConfig(page);
  await mockModels(page);
  await page.goto("/");
  await saveByokConnection(page, mobile);
}

type ControlledStreamWindow = Window & {
  __cherryChatStreamControl?: {
    ready: boolean;
    push: (content: string) => void;
    finish: () => void;
  };
};

export async function installControlledChatStream(page: Page) {
  await page.addInitScript(() => {
    const target = window as ControlledStreamWindow;
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

    target.__cherryChatStreamControl = {
      ready: false,
      push(content) {
        controller?.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: { content },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          ),
        );
      },
      finish() {
        if (!controller) return;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        controller = null;
        if (target.__cherryChatStreamControl) {
          target.__cherryChatStreamControl.ready = false;
        }
      },
    };

    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url !== "https://api.openai.com/v1/chat/completions") {
        return originalFetch(input, init);
      }

      const payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { stream?: boolean })
          : null;
      if (payload?.stream === false) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Controlled stream title" } }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            controller = nextController;
            if (target.__cherryChatStreamControl) {
              target.__cherryChatStreamControl.ready = true;
            }
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });
}

export async function pushControlledChunk(page: Page, content: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as ControlledStreamWindow).__cherryChatStreamControl?.ready,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate((chunk) => {
    (window as ControlledStreamWindow).__cherryChatStreamControl?.push(chunk);
  }, content);
}

export async function finishControlledStream(page: Page) {
  await page.evaluate(() => {
    (window as ControlledStreamWindow).__cherryChatStreamControl?.finish();
  });
}

export function anthropicSse(
  events: readonly Record<string, unknown>[],
): string {
  return events
    .map(
      (event) =>
        `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

export function anthropicMessageStart(model: string, inputTokens = 10) {
  return {
    type: "message_start",
    message: {
      id: "anthropic-e2e-message",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens },
    },
  };
}

export function anthropicMessageDelta(stopReason: string, outputTokens = 6) {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}
