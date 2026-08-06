import type { NormalizedToolCall } from "@/runtime/tools/tool-registry";

const TOOL_CALLS_OPEN = "<｜｜DSML｜｜tool_calls>";
const TOOL_CALLS_CLOSE = "</｜｜DSML｜｜tool_calls>";
const BUFFER_LIMIT = 64 * 1024;
const INVOKE_PATTERN =
  /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/gu;
const PARAMETER_PATTERN =
  /<｜｜DSML｜｜parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)<\/｜｜DSML｜｜parameter>/gu;

export interface DeepseekDsmlResult {
  text: string;
  toolCalls: NormalizedToolCall[];
}

export class DeepseekDsmlParser {
  private textBuffer = "";
  private dsmlBuffer = "";
  private inDsml = false;

  constructor(
    private readonly createCallId: () => string = createDeepseekToolCallId,
  ) {}

  push(delta: string): DeepseekDsmlResult {
    if (this.inDsml) this.dsmlBuffer += delta;
    else this.textBuffer += delta;
    return this.drain();
  }

  finish(): DeepseekDsmlResult {
    const drained = this.drain();
    const remainder = this.inDsml
      ? TOOL_CALLS_OPEN + this.dsmlBuffer
      : this.textBuffer;
    this.textBuffer = "";
    this.dsmlBuffer = "";
    this.inDsml = false;
    return {
      text: drained.text + remainder,
      toolCalls: drained.toolCalls,
    };
  }

  private drain(): DeepseekDsmlResult {
    let text = "";
    const toolCalls: NormalizedToolCall[] = [];

    while (true) {
      if (this.inDsml) {
        const closeIndex = this.dsmlBuffer.indexOf(TOOL_CALLS_CLOSE);
        if (closeIndex === -1) {
          if (this.dsmlBuffer.length > BUFFER_LIMIT) {
            text += TOOL_CALLS_OPEN + this.dsmlBuffer;
            this.dsmlBuffer = "";
            this.inDsml = false;
          }
          break;
        }

        const block = this.dsmlBuffer.slice(0, closeIndex);
        const remainder = this.dsmlBuffer.slice(
          closeIndex + TOOL_CALLS_CLOSE.length,
        );
        const parsedCalls = parseInvokeBlocks(block, () => this.nextCallId());
        if (parsedCalls.length > 0) toolCalls.push(...parsedCalls);
        else text += TOOL_CALLS_OPEN + block + TOOL_CALLS_CLOSE;
        this.dsmlBuffer = "";
        this.inDsml = false;
        this.textBuffer = remainder + this.textBuffer;
        continue;
      }

      const openIndex = this.textBuffer.indexOf(TOOL_CALLS_OPEN);
      if (openIndex >= 0) {
        text += this.textBuffer.slice(0, openIndex);
        this.dsmlBuffer = this.textBuffer.slice(
          openIndex + TOOL_CALLS_OPEN.length,
        );
        this.textBuffer = "";
        this.inDsml = true;
        continue;
      }

      const partialIndex = findPartialPrefix(this.textBuffer, TOOL_CALLS_OPEN);
      if (partialIndex >= 0) {
        text += this.textBuffer.slice(0, partialIndex);
        this.textBuffer = this.textBuffer.slice(partialIndex);
      } else {
        text += this.textBuffer;
        this.textBuffer = "";
      }
      break;
    }

    return { text, toolCalls };
  }

  private nextCallId(): string {
    return this.createCallId();
  }
}

export function isDeepseekModel(modelId: string): boolean {
  return modelId.normalize("NFKC").toLowerCase().includes("deepseek");
}

function createDeepseekToolCallId(): string {
  return `dsml_${globalThis.crypto.randomUUID()}`;
}

function parseInvokeBlocks(
  value: string,
  createId: () => string,
): NormalizedToolCall[] {
  const calls: NormalizedToolCall[] = [];
  INVOKE_PATTERN.lastIndex = 0;
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = INVOKE_PATTERN.exec(value)) !== null) {
    const name = invokeMatch[1];
    const body = invokeMatch[2];
    if (!name || body === undefined) continue;
    const parameters: Record<string, unknown> = {};
    PARAMETER_PATTERN.lastIndex = 0;
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = PARAMETER_PATTERN.exec(body)) !== null) {
      const parameterName = parameterMatch[1];
      const rawValue = parameterMatch[3];
      if (!parameterName || rawValue === undefined) continue;
      parameters[parameterName] =
        parameterMatch[2] === "false" ? parseJsonValue(rawValue) : rawValue;
    }
    calls.push({
      id: createId(),
      name,
      arguments: JSON.stringify(parameters),
    });
  }
  return calls;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function findPartialPrefix(value: string, target: string): number {
  const maximum = Math.min(value.length, target.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (target.startsWith(value.slice(value.length - length))) {
      return value.length - length;
    }
  }
  return -1;
}
