import type { Block } from "./session";

/** One transcript row follows a compaction from "Compacting…" to "Compacted". */
export const COMPACTION_STATUS_KEY = "compaction";
export const COMPACTING_TEXT = "Compacting context…";
export const COMPACTED_TEXT = "Compacted context";

/** The in-progress compaction row; it settles or closes when the run ends. */
export function isRunningCompaction(block: Block): boolean {
  return block.statusKey === COMPACTION_STATUS_KEY && block.statusRunningSince != null;
}
