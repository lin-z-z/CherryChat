import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ImageGenerationCompressionControl,
  ImageGenerationParameterControl,
  ImageGenerationSizeControl,
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

  it("applies a resolution and ratio together from the size dialog", () => {
    const onSelectSize = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationSizeControl
          ariaLabel="Image size"
          capabilities={{
            customSizes: true,
            resolutionTiers: ["auto", "1K", "2K", "4K"],
            aspectRatios: ["1:1", "3:2", "2:3", "9:16"],
          }}
          disabled={false}
          onSelectSize={onSelectSize}
          parameters={{
            resolutionTier: "1K",
            aspectRatio: "1:1",
            size: "1024x1024",
            quality: "auto",
            outputFormat: "png",
            outputCompression: null,
          }}
        />
      </Providers>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Image size: 1024x1024" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "2K" }));
    fireEvent.click(screen.getByRole("button", { name: "3:2" }));
    expect(screen.getByText("2160x1440")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onSelectSize).toHaveBeenCalledWith("2160x1440");
    expect(
      screen.queryByRole("dialog", { name: "Set image size" }),
    ).not.toBeInTheDocument();
  });

  it("normalizes custom dimensions before applying them", () => {
    const onSelectSize = vi.fn();
    render(
      <Providers initialLanguage="en">
        <ImageGenerationSizeControl
          ariaLabel="Image size"
          capabilities={{
            customSizes: true,
            resolutionTiers: ["auto", "1K", "2K", "4K"],
            aspectRatios: ["1:1", "3:2", "2:3"],
          }}
          disabled={false}
          onSelectSize={onSelectSize}
          parameters={{
            resolutionTier: "1K",
            aspectRatio: "1:1",
            size: "1024x1024",
            quality: "auto",
            outputFormat: "png",
            outputCompression: null,
          }}
        />
      </Providers>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Image size: 1024x1024" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Custom dimensions" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width" }), {
      target: { value: "1300" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Height" }), {
      target: { value: "700" },
    });
    expect(screen.getByText("1296x704")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onSelectSize).toHaveBeenCalledWith("1296x704");
  });
});
