import { describe, expect, it } from "vitest";

import { assertSameOrigin, RequestSecurityError } from "@/server/security";

describe("request same-origin security", () => {
  it.each([
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: "http://localhost:3202",
      host: null,
    },
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: "http://127.0.0.1:3202",
      host: "127.0.0.1:3202",
    },
    {
      requestUrl: "https://internal.example/api/auth",
      origin: "https://chat.example",
      host: "chat.example",
    },
  ])("accepts an exact request or Host origin: $origin", (input) => {
    expect(() => assertSameOrigin(originRequest(input))).not.toThrow();
  });

  it.each([
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: null,
      host: "localhost:3202",
    },
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: "not-a-url",
      host: "localhost:3202",
    },
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: "http://evil.example",
      host: "localhost:3202",
    },
    {
      requestUrl: "http://localhost:3202/api/auth",
      origin: "http://evil.example",
      host: "evil.example/path",
    },
  ])("rejects a missing, malformed, or cross-origin value", (input) => {
    expect(() => assertSameOrigin(originRequest(input))).toThrow(
      RequestSecurityError,
    );
  });
});

function originRequest({
  requestUrl,
  origin,
  host,
}: {
  requestUrl: string;
  origin: string | null;
  host: string | null;
}): Request {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (host) headers.set("Host", host);
  return new Request(requestUrl, { headers });
}
