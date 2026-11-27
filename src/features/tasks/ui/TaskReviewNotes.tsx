import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { Badge } from "../../../shared/ui/Badge";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { t, useLocale } from "../../../shared/i18n";
import type { TaskReviewNote } from "../model/hostTasks";
import { unreadReviewNotes } from "../model/taskReviewNotes";

type Props = {
  notes: readonly TaskReviewNote[];
  busy: boolean;
  stale?: boolean;
  onRead: (noteIds: string[]) => void;
  onResolve: (noteId: string, resolved: boolean) => void;
  onOpenReview: (sessionId: string) => void;
  isOpeningSession?: (sessionId: string) => boolean;
};

export function TaskReviewNotes({
  notes,
  busy,
  stale,
  onRead,
  onResolve,
  onOpenReview,
  isOpeningSession,
}: Props) {
  useLocale();
  const unread = unreadReviewNotes(notes);
  const open = notes.filter((note) => note.resolvedAt === undefined).length;
  if (notes.length === 0) return null;
  return (
    <section aria-label={t("Review notes")} className="grid min-w-0 gap-2">
      <SectionLabel
        as="h3"
        count={open}
        countLabel={t("{p0} open", { p0: open })}
        actions={
          <>
            <InfoPopover width={280}>
              {t(
                "Marking a note fixed does not complete this task. Its checks and review still apply.",
              )}
            </InfoPopover>
            {unread > 0 ? (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || stale}
                disabledReason={
                  stale
                    ? t("Reconnect this machine before changing its tasks.")
                    : busy
                      ? t("Wait for the current operation to finish")
                      : undefined
                }
                onClick={() =>
                  onRead(notes.filter((note) => note.readAt === undefined).map((note) => note.id))
                }
              >
                {t("Mark {p0} as read", { p0: unread })}
              </Button>
            ) : null}
          </>
        }
      >
        {t("Review notes")}
      </SectionLabel>
      <ul className="grid gap-2">
        {[...notes].reverse().map((note) => {
          const resolved = note.resolvedAt !== undefined;
          return (
            <Surface
              as="li"
              variant="card"
              padding="sm"
              key={note.id}
              data-review-note={note.id}
              className="space-y-1.5"
            >
              <Text
                as="div"
                size="caption"
                tone="inherit"
                className="flex flex-wrap items-center gap-2"
              >
                <Badge tone={resolved ? "success" : "warning"}>
                  {resolved ? t("Fixed") : t("Open")}
                </Badge>
                {note.readAt === undefined ? (
                  <Text tone="info" size="inherit">
                    {t("New")}
                  </Text>
                ) : null}
                {note.kind === "suggestion" ? (
                  <Text tone="secondary" size="inherit">
                    {t("Optional suggestion")}
                  </Text>
                ) : null}
                {note.category === "external" ? (
                  <Text tone="warning" size="inherit">
                    {t("External verification")}
                  </Text>
                ) : null}
                {note.occurrences > 1 ? (
                  <Text tone="secondary" size="inherit">
                    {t("Reported {p0} times", { p0: note.occurrences })}
                  </Text>
                ) : null}
                <Timestamp
                  value={note.createdAt}
                  format="datetime-seconds"
                  tooltip={false}
                  size="inherit"
                  tone="secondary"
                />
              </Text>
              <Text
                as="p"
                size="caption"
                tone="secondary"
                className="whitespace-pre-wrap break-words"
              >
                {note.finding}
              </Text>
              {note.suggestion ? (
                <Text
                  as="p"
                  size="caption"
                  tone="secondary"
                  className="whitespace-pre-wrap break-words"
                >
                  {t("Suggested correction: {p0}", { p0: note.suggestion })}
                </Text>
              ) : null}
              {note.details ? (
                <Disclosure size="sm" summary={t("Review details")}>
                  <Text
                    as="p"
                    size="caption"
                    tone="secondary"
                    className="whitespace-pre-wrap break-words"
                  >
                    {note.details}
                  </Text>
                </Disclosure>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy || stale}
                  disabledReason={
                    stale
                      ? t("Reconnect this machine before changing its tasks.")
                      : busy
                        ? t("Wait for the current operation to finish")
                        : undefined
                  }
                  onClick={() => onResolve(note.id, !resolved)}
                >
                  {resolved ? t("Reopen note") : t("Mark fixed")}
                </Button>
                {note.sessionId ? (
                  <Button
                    variant="ghost"
                    type="button"

                    onClick={() => onOpenReview(note.sessionId!)}
                    loading={isOpeningSession?.(note.sessionId)}
                  >
                    {t("Open review")}
                  </Button>
                ) : null}
              </div>
              {(note.sessionIds?.length ?? 0) > 1 ? (
                <Disclosure size="sm" summary={t("Review history")}>
                  <div className="flex flex-wrap gap-1">
                    {note.sessionIds!.map((sessionId, index) => (
                      <Button
                        variant="ghost"
                        key={sessionId}
                        type="button"

                        onClick={() => onOpenReview(sessionId)}
                        loading={isOpeningSession?.(sessionId)}
                      >
                        {t("Review {p0}", { p0: index + 1 })}
                      </Button>
                    ))}
                  </div>
                </Disclosure>
              ) : null}
            </Surface>
          );
        })}
      </ul>
    </section>
  );
}
