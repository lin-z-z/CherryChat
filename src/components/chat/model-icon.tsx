"use client";

import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import deepSeekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import doubaoIcon from "@lobehub/icons-static-svg/icons/doubao-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import ollamaIcon from "@lobehub/icons-static-svg/icons/ollama.svg";
import openAiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import { Bot } from "lucide-react";
import Image, { type StaticImageData } from "next/image";

import { cn } from "@/lib/cn";

type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "zhipu"
  | "qwen"
  | "mistral"
  | "ollama"
  | "moonshot"
  | "minimax"
  | "doubao"
  | "custom";

const providerIcons: Partial<
  Record<ModelProvider, { image: StaticImageData; monochrome?: boolean }>
> = {
  openai: { image: openAiIcon, monochrome: true },
  anthropic: { image: claudeIcon },
  google: { image: geminiIcon },
  xai: { image: grokIcon, monochrome: true },
  deepseek: { image: deepSeekIcon },
  zhipu: { image: zhipuIcon },
  qwen: { image: qwenIcon },
  mistral: { image: mistralIcon },
  ollama: { image: ollamaIcon, monochrome: true },
  moonshot: { image: kimiIcon },
  minimax: { image: minimaxIcon },
  doubao: { image: doubaoIcon },
};

export interface ModelIconProps {
  modelId: string;
  size?: number;
  className?: string;
}

export function ModelIcon({ modelId, size = 18, className }: ModelIconProps) {
  const icon = providerIcons[resolveModelProvider(modelId)];
  if (!icon) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "model-provider-icon model-provider-icon-fallback",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <Bot size={Math.max(12, size - 3)} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn("model-provider-icon", className)}
      style={{ width: size, height: size }}
    >
      <Image
        alt=""
        className={cn(
          "model-provider-icon-image",
          icon.monochrome && "is-monochrome",
        )}
        height={size}
        src={icon.image}
        width={size}
      />
    </span>
  );
}

export function resolveModelProvider(modelId: string): ModelProvider {
  const normalized = modelId.normalize("NFKC").trim().toLocaleLowerCase();
  const [provider = "", ...nameParts] = normalized.split("/");
  const name = nameParts.length > 0 ? nameParts.join("/") : provider;

  if (provider === "openai" || /^(?:gpt-|chatgpt-|o[134](?:-|$))/u.test(name)) {
    return "openai";
  }
  if (provider === "anthropic" || name.startsWith("claude-")) {
    return "anthropic";
  }
  if (
    provider === "google" ||
    name.startsWith("gemini-") ||
    name.startsWith("gemma-")
  ) {
    return "google";
  }
  if (provider === "xai" || name.startsWith("grok-")) return "xai";
  if (provider === "deepseek" || name.startsWith("deepseek-")) {
    return "deepseek";
  }
  if (
    provider === "zhipuai" ||
    provider === "zai" ||
    /^(?:glm-|chatglm)/u.test(name)
  ) {
    return "zhipu";
  }
  if (provider === "alibaba" || /^(?:qwen|qwq)/u.test(name)) {
    return "qwen";
  }
  if (provider === "mistral" || name.startsWith("mistral-")) {
    return "mistral";
  }
  if (provider === "ollama") return "ollama";
  if (
    provider === "moonshotai" ||
    provider === "moonshot" ||
    name.startsWith("kimi-")
  ) {
    return "moonshot";
  }
  if (provider === "minimax" || name.startsWith("minimax-")) return "minimax";
  if (
    provider === "bytedance" ||
    provider === "volcengine" ||
    name.startsWith("doubao-")
  ) {
    return "doubao";
  }
  return "custom";
}
