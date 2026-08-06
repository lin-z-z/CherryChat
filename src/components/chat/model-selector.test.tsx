import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSelector } from "@/components/chat/model-selector";
import { Providers } from "@/components/providers";

function renderSelector(
  overrides: Partial<React.ComponentProps<typeof ModelSelector>> = {},
) {
  const onValueChange = vi.fn();
  render(
    <Providers initialLanguage="en">
      <ModelSelector
        disabled={false}
        models={["gpt-4.1-mini", "gpt-5-mini"]}
        onValueChange={onValueChange}
        value="gpt-4.1-mini"
        {...overrides}
      />
    </Providers>,
  );
  return { onValueChange };
}

function openSelector() {
  fireEvent.click(screen.getByRole("button"));
  return screen.getByRole("searchbox");
}

describe("ModelSelector", () => {
  afterEach(() => cleanup());

  it("deduplicates models and keeps a current model outside the source list", () => {
    renderSelector({
      models: ["gpt-4.1-mini", "gpt-4.1-mini", "gpt-5-mini"],
      value: "custom-model",
    });

    const search = openSelector();
    const options = screen.getAllByRole("option");

    expect(search).toHaveFocus();
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.textContent)).toEqual([
      "custom-model",
      "gpt-4.1-mini",
      "gpt-5-mini",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("filters models and presents an empty result", () => {
    renderSelector();
    const search = openSelector();

    fireEvent.change(search, { target: { value: "gpt-5" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("gpt-5-mini");

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("selects a model, invokes the callback, and closes the popover", () => {
    const { onValueChange } = renderSelector();
    openSelector();

    fireEvent.click(screen.getByRole("option", { name: "gpt-5-mini" }));

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("gpt-5-mini");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves focus between options with listbox navigation keys", () => {
    renderSelector({
      models: ["gpt-4.1-mini", "gpt-5-mini", "o3-mini"],
    });
    const search = openSelector();
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(options[0]).toHaveFocus();

    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();

    fireEvent.keyDown(options[1]!, { key: "End" });
    expect(options[2]).toHaveFocus();

    fireEvent.keyDown(options[2]!, { key: "Home" });
    expect(options[0]).toHaveFocus();

    fireEvent.keyDown(options[0]!, { key: "ArrowUp" });
    expect(options[2]).toHaveFocus();
  });

  it("does not open while disabled", () => {
    renderSelector({ disabled: true });

    fireEvent.click(screen.getByRole("button"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
