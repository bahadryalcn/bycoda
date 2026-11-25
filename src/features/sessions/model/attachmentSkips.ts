import { t } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { MAX_EMBED_BYTES, type SkippedAttachment } from "./attachments";
import type { AttachmentReadCapacity } from "./attachmentReadCapacity";

const NAMED_FILES = 3;
const NAME_GRAPHEMES = 48;

/**
 * One sentence per skipped file, so the reader learns which file was left out
 * and why; past three, the rest are counted. Null when nothing was skipped.
 */
export function skippedAttachmentNotice(skipped: readonly SkippedAttachment[]): string | null {
  if (skipped.length === 0) return null;
  const limit = Math.round(MAX_EMBED_BYTES / (1024 * 1024));
  const sentences = skipped.slice(0, NAMED_FILES).map(({ name, reason }) => {
    const shown = truncateGraphemes(name, NAME_GRAPHEMES);
    return reason === "too-large"
      ? t("{p0} is larger than {p1} MB and was not attached.", { p0: shown, p1: limit })
      : t("{p0} could not be read and was not attached.", { p0: shown });
  });
  const rest = skipped.length - sentences.length;
  if (rest > 0) sentences.push(t("{p0} more files were not attached.", { p0: rest }));
  return sentences.join(" ");
}

/** Collects the files an `attachmentsFromFiles` call skipped, for one notice afterwards. */
export function collectSkippedAttachments() {
  const skipped: SkippedAttachment[] = [];
  return {
    onSkipped: (more: SkippedAttachment[]) => {
      skipped.push(...more);
    },
    notice: (capacity?: AttachmentReadCapacity) =>
      [skippedAttachmentNotice(skipped), capacity?.notice()].filter(Boolean).join(" ") || null,
  };
}
