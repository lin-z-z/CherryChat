import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageGenerationProfileSelector } from "@/components/chat/image-generation-profile-selector";
import { Providers } from "@/components/providers";

const profiles = [
  { id: "openai", name: "GPT Image 2", modelId: "gpt-image-2" },
  { id: "custom", name: "Portrait", modelId: "portrait-model" },
] as const;

describe("ImageGenerationProfileSelector", () => {
  afterEach(() => cleanup());

  it("shows profile and model identity and selects through the shared popover pattern", () => {
    const onValueChange = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationProfileSelector
          disabled={false}
          onValueChange={onValueChange}
          profiles={profiles}
          value="openai"
        />
      </Providers>,
    );

    expect(
      screen.getByRole("button", {
        name: "Image model profile: GPT Image 2 · gpt-image-2",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Image model profile: GPT Image 2 · gpt-image-2",
      }),
    );
    expect(
      screen.getByRole("option", { name: "Portrait · portrait-model" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("option", { name: "Portrait · portrait-model" }),
    );
    expect(onValueChange).toHaveBeenCalledWith("custom");
  });
});
