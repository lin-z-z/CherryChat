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
        name: "Image model: GPT Image 2",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Image model: GPT Image 2",
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

  it("does not repeat the model id when it is also the profile name", () => {
    render(
      <Providers initialLanguage="en">
        <ImageGenerationProfileSelector
          disabled={false}
          onValueChange={vi.fn()}
          profiles={[
            { id: "same", name: "gpt-image-2", modelId: "gpt-image-2" },
          ]}
          value="same"
        />
      </Providers>,
    );

    const trigger = screen.getByRole("button", {
      name: "Image model: gpt-image-2",
    });
    expect(trigger).toHaveTextContent("gpt-image-2");
    expect(trigger).not.toHaveTextContent("gpt-image-2 · gpt-image-2");
  });
});
