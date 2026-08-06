import {
  Bot,
  BookOpen,
  Code2,
  Lightbulb,
  PenLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { AssistantIcon as AssistantIconName } from "@/runtime/chat/types";

const ICONS = {
  sparkles: Sparkles,
  bot: Bot,
  code: Code2,
  pen: PenLine,
  book: BookOpen,
  lightbulb: Lightbulb,
} satisfies Record<AssistantIconName, LucideIcon>;

interface AssistantIconProps {
  icon: AssistantIconName;
  className?: string;
  size?: number;
}

export function AssistantIcon({
  icon,
  className,
  size = 16,
}: AssistantIconProps) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" className={className} size={size} />;
}
