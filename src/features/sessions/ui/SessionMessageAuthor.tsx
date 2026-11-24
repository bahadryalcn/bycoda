import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Bot, Clock } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import type { SessionMessageAuthor as Author } from "../model/session";

export { DelegationNoticeRow } from "./DelegationNoticeRow";

/** A provenance label, not a permission badge. The Host supplies the identity. */
export function SessionMessageAuthor({ author, onOpen }: { author?: Author; onOpen?: () => void }) {
  const t = useT();
  if (!author) return null;
  const label =
    author.kind === "assistant" ||
    author.kind === "assistant-manual" ||
    author.kind === "assistant-room" ||
    author.kind === "conversation"
      ? t("{p0} wrote", { p0: author.name })
      : author.kind === "delegation"
        ? t("{p0} wrote", { p0: author.title })
        : author.kind === "task"
          ? t("Task wrote")
          : author.kind === "automation"
            ? t("Automation wrote")
            : t("Steward wrote");
  const reason =
    author.kind === "assistant" ||
    author.kind === "assistant-manual" ||
    author.kind === "assistant-room"
      ? {
          nudge: t("Nudge"),
          answer: t("Answer"),
          steer: t("Steer"),
          kickoff: t("Kickoff"),
          message: t("Message"),
        }[author.reason]
      : undefined; // Task, automation and steward reasons are free Host strings, never shown raw.
  const Icon = author.kind === "automation" ? Clock : Bot;
  const content = (
    <>
      <Icon className="icon-xs shrink-0" aria-hidden />
      <span>{label}</span>
      {reason && <span> · {reason}</span>}
    </>
  );
  return onOpen ? (
    <Button variant="chip" size="sm" onClick={onOpen}>
      {content}
    </Button>
  ) : (
    <Text
      as="span"
      size="caption"
      tone="inherit"
      className="mbe-1 inline-flex items-center gap-1.5 font-sans text-(--transcript-ink-faint)"
    >
      {content}
    </Text>
  );
}
