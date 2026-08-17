"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { ModelIcon } from "@/components/chat/model-icon";

export interface ModelSelectorProps {
  models: string[];
  items?: readonly ModelSelectorItem[];
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  listAriaLabel?: string;
  searchAriaLabel?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  id?: string;
  variant?: "toolbar" | "settings";
}

export interface ModelSelectorItem {
  value: string;
  label: string;
  modelId: string;
  description?: string;
  ariaLabel?: string;
}

export function ModelSelector({
  models,
  items,
  value,
  disabled,
  onValueChange,
  ariaLabel,
  listAriaLabel,
  searchAriaLabel,
  triggerLabel,
  triggerClassName,
  popoverClassName,
  id,
  variant = "toolbar",
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const availableItems = useMemo(() => {
    const sourceItems: readonly ModelSelectorItem[] =
      items ??
      models.map<ModelSelectorItem>((model) => ({
        value: model,
        label: model,
        modelId: model,
      }));
    const uniqueItems = Array.from(
      new Map(
        sourceItems
          .filter((item) => item.value.trim().length > 0)
          .map((item) => [item.value, item]),
      ).values(),
    );
    if (value && !uniqueItems.some((item) => item.value === value)) {
      uniqueItems.unshift({ value, label: value, modelId: value });
    }
    return uniqueItems;
  }, [items, models, value]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return availableItems;
    return availableItems.filter((item) =>
      [item.value, item.label, item.modelId, item.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [availableItems, query]);
  const selectedItem = availableItems.find((item) => item.value === value);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (filteredItems.length === 0) return;

    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (index + 1) % filteredItems.length;
        break;
      case "ArrowUp":
        nextIndex = (index - 1 + filteredItems.length) % filteredItems.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = filteredItems.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    focusOption(nextIndex);
  };

  const selectItem = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };
  const visibleTriggerLabel =
    triggerLabel ?? selectedItem?.label ?? value ?? t("model");

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
            ariaLabel ??
            t("selectedModel", { model: visibleTriggerLabel || t("model") })
          }
          className={cn(
            "model-selector-trigger",
            variant === "settings" && "model-selector-trigger-settings",
            triggerClassName,
          )}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span className="model-selector-trigger-main">
            <ModelIcon modelId={selectedItem?.modelId ?? value} size={18} />
            <span className="model-selector-trigger-label">
              {visibleTriggerLabel || t("model")}
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
            popoverClassName,
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
              aria-label={searchAriaLabel ?? t("searchModels")}
              autoComplete="off"
              className="model-selector-search-input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" || filteredItems.length === 0) {
                  return;
                }
                event.preventDefault();
                focusOption(0);
              }}
              placeholder={searchAriaLabel ?? t("searchModels")}
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>

          <div
            aria-label={listAriaLabel ?? t("model")}
            className="model-selector-list"
            id={listboxId}
            role="listbox"
          >
            {filteredItems.length > 0 ? (
              filteredItems.map((item, index) => {
                const selected = item.value === value;
                return (
                  <button
                    aria-label={item.ariaLabel ?? item.label}
                    aria-selected={selected}
                    className="model-selector-option"
                    key={item.value}
                    onClick={() => selectItem(item.value)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="model-selector-option-main">
                      <ModelIcon modelId={item.modelId} size={18} />
                      <span className="model-selector-option-copy">
                        <span className="model-selector-option-label">
                          {item.label}
                        </span>
                        {item.description ? (
                          <span className="model-selector-option-description">
                            {item.description}
                          </span>
                        ) : null}
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
