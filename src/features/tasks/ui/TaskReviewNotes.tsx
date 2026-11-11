import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { EmptyState } from "../../../shared/ui/EmptyState";
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
  return (
    <section aria-label={t("Review notes")} className="grid min-w-0 gap-2">
      <SectionLabel
        as="h3"
        actions={
          unread > 0 ? (
            <Button
              variant="ghost"
              type="button"

              disabled={busy || stale}
              onClick={() =>
                onRead(notes.filter((note) => note.readAt === undefined).map((note) => note.id))
              }
            >
              {t("Mark ")}
              {unread}
              {t(" as read")}
            </Button>
          ) : null
        }
      >
        {t("Review notes · ")}
        {open}
        {t(" open")}
      </SectionLabel>
      {notes.length === 0 ? (
        <EmptyState description={t("No review notes yet.")} />
      ) : (
        <ul className="grid gap-2">
          {[...notes].reverse().map((note) => {
            const resolved = note.resolvedAt !== undefined;
            return (
              <Surface
                as="li"
                variant="outline"
                padding="sm"
                key={note.id}
                data-review-note={note.id}
                className="space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-ui-caption">
                  <Badge tone={resolved ? "success" : "warning"}>
                    {resolved ? t("Fixed") : t("Open")}
                  </Badge>
                  {note.readAt === undefined ? (
                    <span className="text-(--ui-tone-info-fg)">{t("New")}</span>
                  ) : null}
                  {note.kind === "suggestion" ? (
                    <span className="text-(--ui-text-secondary)">{t("Optional suggestion")}</span>
                  ) : null}
                  {note.category === "external" ? (
                    <span className="text-(--ui-tone-warning-fg)">
                      {t("External verification")}
                    </span>
                  ) : null}
                  {note.occurrences > 1 ? (
                    <span className="text-(--ui-text-secondary)">
                      {t("Reported ")}
                      {note.occurrences}
                      {t(" times")}
                    </span>
                  ) : null}
                  <Timestamp
                    value={note.createdAt}
                    format="datetime-seconds"
                    tooltip={false}
                    className="text-(--ui-text-secondary)"
                  />
                </div>
                <p className="whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
                  {note.finding}
                </p>
                {note.suggestion ? (
                  <p className="whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
                    {t("Suggested correction: ")}
                    {note.suggestion}
                  </p>
                ) : null}
                {note.details ? (
                  <Disclosure size="sm" summary={t("Review details")}>
                    <p className="whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
                      {note.details}
                    </p>
                  </Disclosure>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    type="button"

                    disabled={busy || stale}
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
                          {t("Review ")}
                          {index + 1}
                        </Button>
                      ))}
                    </div>
                  </Disclosure>
                ) : null}
              </Surface>
            );
          })}
        </ul>
      )}
      <p className="text-ui-micro text-(--ui-text-muted)">
        {t("Marking a note fixed does not complete this task. Its checks and review still apply.")}
      </p>
    </section>
  );
}
