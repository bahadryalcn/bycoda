import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import type { SessionMessageAuthor as Author } from "../model/session";

/** A provenance label, not a permission badge. The Host supplies the identity. */
export function SessionMessageAuthor({ author, onOpen }: { author?: Author; onOpen?: () => void }) {
  const t = useT();
  if (!author) return null;
  const label =
    author.kind === "assistant" || author.kind === "assistant-manual"
      ? t("{p0} wrote", { p0: author.name })
      : author.kind === "task"
        ? t("Task wrote")
        : author.kind === "automation"
          ? t("Automation wrote")
          : t("Steward wrote");
  const reason =
    author.kind === "assistant" || author.kind === "assistant-manual"
      ? {
          nudge: t("Nudge"),
          answer: t("Answer"),
          steer: t("Steer"),
          kickoff: t("Kickoff"),
        }[author.reason]
      : author.reason;
  const content = (
    <>
      <span>{label}</span>
      {reason && <span aria-label={reason}> · {reason}</span>}
    </>
  );
  return onOpen ? (
    <Button variant="ghost" size="sm" onClick={onOpen} tooltip={t("Open related activity")}>
      {content}
    </Button>
  ) : (
    <Badge size="xs" tone="neutral">
      {content}
    </Badge>
  );
}
