import { t } from "../../../shared/i18n/core";
import type { Block } from "./session";

/** One transcript row follows a compaction from "Compacting…" to "Compacted". */
export const COMPACTION_STATUS_KEY = "compaction";
/** Translated when the row is emitted, so it follows the current language. */
export function compactingText(): string {
  return t("Compacting context…");
}
export function compactedText(): string {
  return t("Compacted context");
}

/** The in-progress compaction row; it settles or closes when the run ends. */
export function isRunningCompaction(block: Block): boolean {
  return block.statusKey === COMPACTION_STATUS_KEY && block.statusRunningSince != null;
}
