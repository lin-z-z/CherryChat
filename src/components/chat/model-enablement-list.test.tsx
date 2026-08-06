import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelEnablementList } from "@/components/chat/model-enablement-list";
import { Providers } from "@/components/providers";

function renderList() {
  const onEnabledModelsChange = vi.fn();
  render(
    <Providers initialLanguage="en">
      <ModelEnablementList
        enabledModels={["openai/gpt-5-mini"]}
        models={[
          "openai/gpt-5-mini",
          "xai/grok-4.5",
          "company/private-chat-model",
        ]}
        onEnabledModelsChange={onEnabledModelsChange}
        requiredModels={["openai/gpt-5-mini"]}
      />
    </Providers>,
  );
  return onEnabledModelsChange;
}

describe("ModelEnablementList", () => {
  afterEach(() => cleanup());

  it("labels models in use without locking their enabled state", () => {
    const onEnabledModelsChange = renderList();

    expect(
      screen.getByRole("checkbox", { name: "Enable openai/gpt-5-mini" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable xai/grok-4.5" }),
    );

    expect(onEnabledModelsChange).toHaveBeenCalledWith([
      "openai/gpt-5-mini",
      "xai/grok-4.5",
    ]);
  });

  it("allows an in-use model to be disabled after another model is enabled", () => {
    const onEnabledModelsChange = vi.fn();
    const { rerender } = render(
      <Providers initialLanguage="en">
        <ModelEnablementList
          enabledModels={["openai/gpt-5-mini", "xai/grok-4.5"]}
          models={["openai/gpt-5-mini", "xai/grok-4.5"]}
          onEnabledModelsChange={onEnabledModelsChange}
          requiredModels={["openai/gpt-5-mini"]}
        />
      </Providers>,
    );

    const inUseCheckbox = screen.getByRole("checkbox", {
      name: "Enable openai/gpt-5-mini",
    });
    expect(inUseCheckbox).toBeEnabled();
    fireEvent.click(inUseCheckbox);
    expect(onEnabledModelsChange).toHaveBeenCalledWith(["xai/grok-4.5"]);
    onEnabledModelsChange.mockClear();

    rerender(
      <Providers initialLanguage="en">
        <ModelEnablementList
          enabledModels={["xai/grok-4.5"]}
          models={["openai/gpt-5-mini", "xai/grok-4.5"]}
          onEnabledModelsChange={onEnabledModelsChange}
          requiredModels={["openai/gpt-5-mini"]}
        />
      </Providers>,
    );
    expect(
      screen.getByRole("checkbox", { name: "Enable xai/grok-4.5" }),
    ).toBeDisabled();
    const keepInUse = screen.getByRole("button", {
      name: "Keep models in use",
    });
    expect(keepInUse).toBeEnabled();
    fireEvent.click(keepInUse);
    expect(onEnabledModelsChange).toHaveBeenCalledWith(["openai/gpt-5-mini"]);
  });

  it("filters the discovered list without losing the selection", () => {
    renderList();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "private" },
    });

    expect(
      screen.getByRole("checkbox", {
        name: "Enable company/private-chat-model",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Enable xai/grok-4.5" }),
    ).not.toBeInTheDocument();
  });
});
