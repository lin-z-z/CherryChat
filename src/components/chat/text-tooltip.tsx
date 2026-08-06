"use client";

import { Tooltip } from "radix-ui";
import type { ReactElement } from "react";

interface TextTooltipProps {
  children: ReactElement;
  content: string;
}

export function TextTooltip({ children, content }: TextTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="text-tooltip-content"
            collisionPadding={8}
            sideOffset={7}
          >
            {content}
            <Tooltip.Arrow className="text-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
