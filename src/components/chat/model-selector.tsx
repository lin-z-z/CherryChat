"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { ModelIcon } from "@/components/chat/model-icon";

export interface ModelSelectorProps {
  models: string[];
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  id?: string;
  variant?: "toolbar" | "settings";
}

export function ModelSelector({
  models,
  value,
  disabled,
  onValueChange,
  ariaLabel,
  id,
  variant = "toolbar",
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const availableModels = useMemo(() => {
    const uniqueModels = Array.from(
      new Set(models.filter((model) => model.trim().length > 0)),
    );
    if (value && !uniqueModels.includes(value)) uniqueModels.unshift(value);
    return uniqueModels;
  }, [models, value]);

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return availableModels;
    return availableModels.filter((model) =>
      model.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [availableModels, query]);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (filteredModels.length === 0) return;

    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (index + 1) % filteredModels.length;
        break;
      case "ArrowUp":
        nextIndex = (index - 1 + filteredModels.length) % filteredModels.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = filteredModels.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    focusOption(nextIndex);
  };

  const selectModel = (model: string) => {
    onValueChange(model);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          aria-label={
            ariaLabel ?? t("selectedModel", { model: value || t("model") })
          }
          className={cn(
            "model-selector-trigger",
            variant === "settings" && "model-selector-trigger-settings",
          )}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span className="model-selector-trigger-main">
            <ModelIcon modelId={value} size={18} />
            <span className="model-selector-trigger-label">
              {value || t("model")}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="model-selector-trigger-icon"
            size={12}
            strokeWidth={2.5}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          className={cn(
            "model-selector-popover",
            variant === "settings" && "model-selector-popover-settings",
          )}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
          sideOffset={variant === "settings" ? 5 : 2}
        >
          <div className="model-selector-search-shell">
            <Search
              aria-hidden="true"
              className="model-selector-search-icon"
              size={16}
              strokeWidth={2.5}
            />
            <input
              aria-controls={listboxId}
              aria-label={t("searchModels")}
              autoComplete="off"
              className="model-selector-search-input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" || filteredModels.length === 0) {
                  return;
                }
                event.preventDefault();
                focusOption(0);
              }}
              placeholder={t("searchModels")}
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>

          <div
            aria-label={t("model")}
            className="model-selector-list"
            id={listboxId}
            role="listbox"
          >
            {filteredModels.length > 0 ? (
              filteredModels.map((model, index) => {
                const selected = model === value;
                return (
                  <button
                    aria-label={model}
                    aria-selected={selected}
                    className="model-selector-option"
                    key={model}
                    onClick={() => selectModel(model)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="model-selector-option-main">
                      <ModelIcon modelId={model} size={18} />
                      <span className="model-selector-option-label">
                        {model}
                      </span>
                    </span>
                    {selected ? (
                      <Check
                        aria-hidden="true"
                        className="model-selector-option-check"
                        size={12}
                      />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="model-selector-empty" role="status">
                {t("noModelsFound")}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
