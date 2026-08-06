import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ThemeSwitcher,
  type ThemeSwitcherProps,
} from "@/components/chat/theme-switcher";
import { Providers } from "@/components/providers";

function renderSwitcher(overrides: Partial<ThemeSwitcherProps> = {}) {
  const props: ThemeSwitcherProps = {
    value: "system",
    resolvedTheme: "light",
    onValueChange: vi.fn(),
    ...overrides,
  };

  return {
    ...render(
      <Providers initialLanguage="en">
        <ThemeSwitcher {...props} />
      </Providers>,
    ),
    props,
  };
}

function openSwitcher() {
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  return screen.getAllByRole("menuitemradio");
}

describe("ThemeSwitcher", () => {
  afterEach(() => cleanup());

  it("shows the three supported theme options", () => {
    renderSwitcher();

    const options = openSwitcher();

    expect(options).toHaveLength(3);
    expect(options.map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
  });

  it("marks the current theme as the checked menu item", () => {
    renderSwitcher({ value: "light", resolvedTheme: "light" });

    openSwitcher();

    expect(
      screen.getByRole("menuitemradio", { name: "Light" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "System" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("reports a validated dark-theme selection", () => {
    const onValueChange = vi.fn();
    renderSwitcher({ onValueChange });
    openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("keeps the system preference label when it currently resolves to dark", () => {
    renderSwitcher({ value: "system", resolvedTheme: "dark" });

    const trigger = screen.getByRole("button");

    expect(trigger).toHaveTextContent("System");
    expect(trigger).not.toHaveTextContent("Dark");
  });
});
