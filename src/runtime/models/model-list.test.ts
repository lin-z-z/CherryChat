import { describe, expect, it } from "vitest";

import {
  parseModelDescriptors,
  resolveModelList,
} from "@/runtime/models/model-list";
import { resolveModelEndpointType } from "@/runtime/models/endpoint-profiles";

describe("model list", () => {
  it("keeps New API endpoint metadata per model", () => {
    expect(
      parseModelDescriptors(
        {
          data: [
            {
              id: " gemini-3.1-pro ",
              owned_by: "google",
              supported_endpoint_types: ["gemini", "openai"],
            },
            {
              id: "gpt-5.5",
              supported_endpoint_types: [
                "openai-response-compact",
                "unsupported",
              ],
            },
          ],
        },
        "new-api",
      ),
    ).toEqual([
      {
        id: "gemini-3.1-pro",
        ownedBy: "google",
        endpointTypes: ["gemini", "openai-chat"],
      },
      {
        id: "gpt-5.5",
        ownedBy: null,
        endpointTypes: ["openai-responses"],
      },
    ]);
  });

  it("does not trust New API metadata on a generic compatible service", () => {
    expect(
      parseModelDescriptors(
        {
          data: [{ id: "custom", supported_endpoint_types: ["anthropic"] }],
        },
        "openai-compatible",
      ),
    ).toEqual([{ id: "custom", ownedBy: null, endpointTypes: [] }]);
  });

  it("falls back to the manually configured model", () => {
    expect(resolveModelList({ invalid: true }, "new-api", " custom ")).toEqual({
      models: [{ id: "custom", ownedBy: null, endpointTypes: [] }],
      modelIds: ["custom"],
      source: "manual",
    });
  });

  it("resolves the explicitly requested New API model instead of the active model", () => {
    const descriptors = [
      {
        id: "active-gpt",
        ownedBy: "openai",
        endpointTypes: ["openai-responses" as const],
      },
      {
        id: "settings-gemini",
        ownedBy: "google",
        endpointTypes: ["gemini" as const, "openai-chat" as const],
      },
    ];

    expect(
      resolveModelEndpointType(
        { mode: "byok", apiType: "new-api" },
        "settings-gemini",
        descriptors,
      ),
    ).toBe("gemini");
  });
});
