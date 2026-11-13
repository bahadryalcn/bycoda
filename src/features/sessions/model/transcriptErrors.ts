import type { Block } from "./session";
import { sessionErrorPresentation } from "./sessionErrorPresentation";
import { isSessionErrorBlock } from "./sessionIssue";

/** Display projection only: retain stored diagnostics and each submitted attempt. */
export function collapseTranscriptErrors(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  let changed = false;
  const visible = blocks.filter((block) => {
    if (block.role === "user" || block.role === "handoff" || block.modelSwitch) seen.clear();
    if (!isSessionErrorBlock(block)) return true;
    const message = sessionErrorPresentation(block.text);
    const key = JSON.stringify([message.usageLimit ?? false, message.summary ?? block.text]);
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });
  return changed ? visible : blocks;
}
