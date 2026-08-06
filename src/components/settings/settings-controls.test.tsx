import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RangeControl,
  SelectControl,
  type SettingsSelectOption,
} from "@/components/settings/settings-controls";
import { Providers } from "@/components/providers";

afterEach(() => cleanup());

const options: readonly SettingsSelectOption[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function renderSelect(disabled = false) {
  const onValueChange = vi.fn();
  render(
    <Providers initialLanguage="en">
      <SelectControl
        aria-label="Theme"
        disabled={disabled}
        onValueChange={onValueChange}
        options={options}
        value="system"
      />
    </Providers>,
  );
  return onValueChange;
}

describe("SelectControl", () => {
  it("opens an accessible option list and reports the selected value", () => {
    const onValueChange = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Theme" });

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Dark" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("supports keyboard opening and does not open while disabled", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Theme" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    cleanup();
    renderSelect(true);
    fireEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

function RangeHarness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState(5);
  return (
    <RangeControl
      aria-label="Sources per search"
      disabled={disabled}
      marks={[
        { value: 1, label: "1" },
        { value: 5, label: "Default 5" },
        { value: 20, label: "20" },
        { value: 50, label: "50" },
      ]}
      max={50}
      min={1}
      onValueChange={setValue}
      step={1}
      value={value}
      valueText={`${value} sources`}
    />
  );
}

describe("RangeControl", () => {
  it("supports keyboard changes and clickable marks", () => {
    render(<RangeHarness />);
    const slider = screen.getByRole("slider", { name: "Sources per search" });

    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "50");
    expect(slider).toHaveAttribute("aria-valuenow", "5");
    expect(slider).toHaveAttribute("aria-valuetext", "5 sources");

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "6");
    expect(screen.getByText("6 sources")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "20" }));
    expect(slider).toHaveAttribute("aria-valuenow", "20");
  });

  it("does not change while disabled", () => {
    render(<RangeHarness disabled />);
    const slider = screen.getByRole("slider", { name: "Sources per search" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("button", { name: "20" })).toBeDisabled();
  });
});
