import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ImageGenerationCompressionControl,
  ImageGenerationParameterControl,
} from "@/components/chat/image-generation-parameter-control";
import { Providers } from "@/components/providers";

describe("ImageGenerationParameterControl", () => {
  afterEach(() => cleanup());

  it("opens a popover, selects an option, and closes it", () => {
    const onValueChange = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationParameterControl
          ariaLabel="Resolution tier"
          disabled={false}
          onValueChange={onValueChange}
          options={[
            { value: "1K", label: "1K" },
            { value: "2K", label: "2K" },
          ]}
          value="1K"
        />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Resolution tier" }));
    expect(screen.getByRole("option", { name: "2K" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "2K" }));

    expect(onValueChange).toHaveBeenCalledWith("2K");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open or emit changes while disabled", () => {
    const onValueChange = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationParameterControl
          ariaLabel="Output format"
          disabled
          onValueChange={onValueChange}
          options={[{ value: "png", label: "PNG" }]}
          value="png"
        />
      </Providers>,
    );

    const trigger = screen.getByRole("combobox", { name: "Output format" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps arbitrary compression percentages in an input popover", () => {
    const onValueChange = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationCompressionControl
          ariaLabel="Compression quality"
          disabled={false}
          onValueChange={onValueChange}
          value={100}
        />
      </Providers>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Compression quality: 100%" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Compression quality" }),
      { target: { value: "82" } },
    );

    expect(onValueChange).toHaveBeenLastCalledWith(82);
  });
});
