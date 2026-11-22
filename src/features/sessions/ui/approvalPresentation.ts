import type { useT } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { approvalDetail } from "../model/approvalDetail";
import { bycodaToolCall } from "../model/bycodaToolCall";
import type { Block } from "../model/session";

type Translate = ReturnType<typeof useT>;

/** What kind of action the approval asks about, as a short name; undefined when unknown. */
export function approvalToolName(block: Block, t: Translate): string | undefined {
  const bycoda = bycodaToolCall(block);
  if (bycoda) return t(bycoda.label);
  const kind = block.tool?.preview?.kind ?? block.tool?.kind?.toLowerCase();
  if (kind === "shell" || kind === "execute") return t("Shell command");
  if (kind === "write" || kind === "edit") return t("File edit");
  if (kind === "read") return t("File read");
  if (kind === "search") return t("Search");
  return undefined;
}

/** Approval heading that names the action instead of a generic "Needs approval". */
export function approvalTitle(block: Block | undefined, t: Translate): string {
  const name = block ? approvalToolName(block, t) : undefined;
  return name ? t("Allow {p0}?", { p0: name }) : t("Needs approval");
}

/** First line of the approval detail, shortened for tight spots such as the dock. */
export function approvalSummary(block: Block, limit = 40): string {
  return truncateGraphemes(approvalDetail(block).trim().split("\n", 1)[0], limit);
}
