import { bycodaToolCall } from "./bycodaToolCall";
import type { Block } from "./session";

/** The exact command or request a tool approval asks about. */
export function approvalDetail(block: Block): string {
  return (
    bycodaToolCall(block)?.command ??
    (block.tool?.preview?.kind === "shell" ? block.tool.preview.title : undefined) ??
    block.tool?.title ??
    block.text
  );
}
