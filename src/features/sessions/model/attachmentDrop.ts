import { t } from "../../../shared/i18n";
import type { ExternalDropVerdict } from "../../../shared/lib/externalDrop";
import { MAX_ATTACHMENTS } from "./attachments";

/** Why a surface cannot take dropped files right now. */
export type AttachmentDropBlock = "unsupported" | "remote" | "unavailable" | "reading" | "full";

export function attachmentDropBlockReason(block: AttachmentDropBlock): string {
  switch (block) {
    case "unsupported":
      return t("This provider does not support attachments");
    case "remote":
      return t("Explorer files cannot be attached to a remote session");
    case "unavailable":
      return t("Attachments cannot be changed right now");
    case "reading":
      return t("Wait for the current attachments to finish loading");
    case "full":
      return t("Attachment limit reached ({p0})", { p0: MAX_ATTACHMENTS });
  }
}

/**
 * The sentence for releasing `count` files (0 = not known yet) onto a draft that already holds
 * `existing` attachments. A draft keeps at most MAX_ATTACHMENTS, so a larger drop says how many
 * will be kept; a full draft is blocked.
 */
export function attachmentDropVerdict(
  count: number,
  existing: number,
  block: AttachmentDropBlock | null,
): ExternalDropVerdict {
  if (block) return { kind: "blocked", reason: attachmentDropBlockReason(block) };
  const room = MAX_ATTACHMENTS - existing;
  if (room <= 0) return { kind: "blocked", reason: attachmentDropBlockReason("full") };
  if (count <= 0) return { kind: "accept", label: t("Attach files") };
  if (count > room)
    return { kind: "accept", label: t("Attach {p0} of {p1} files", { p0: room, p1: count }) };
  return {
    kind: "accept",
    label: count === 1 ? t("Attach 1 file") : t("Attach {p0} files", { p0: count }),
  };
}
