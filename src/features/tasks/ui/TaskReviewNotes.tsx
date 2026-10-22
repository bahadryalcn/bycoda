import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import type { TaskReviewNote } from "../model/hostTasks";
import { unreadReviewNotes } from "../model/taskReviewNotes";

type Props = {
  notes: readonly TaskReviewNote[];
  busy: boolean;
  stale?: boolean;
  onRead: (noteIds: string[]) => void;
  onResolve: (noteId: string, resolved: boolean) => void;
  onOpenReview: (sessionId: string) => void;
};

export function TaskReviewNotes({ notes, busy, stale, onRead, onResolve, onOpenReview }: Props) {
  useLocale();
  const unread = unreadReviewNotes(notes);
  const open = notes.filter((note) => note.resolvedAt === undefined).length;
  return (
    <section
      aria-label={t("Review notes")}
      className="space-y-2 border-t border-(--ui-tone-neutral-border) pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h3 className="text-[12px] font-medium text-(--ui-text-secondary)">
          {t("Review notes · ")}
          {open}
          {t(" open")}
        </h3>
        {unread > 0 ? (
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
        ) : null}
      </div>
      {notes.length === 0 ? (
        <EmptyState description={t("No review notes yet.")} />
      ) : (
        <ul className="space-y-2">
          {[...notes].reverse().map((note) => {
            const resolved = note.resolvedAt !== undefined;
            return (
              <li
                key={note.id}
                data-review-note={note.id}
                className="space-y-1.5 rounded-md border border-(--ui-tone-neutral-border) p-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-(length:--ui-font-caption)">
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
                  <time
                    dateTime={new Date(note.createdAt).toISOString()}
                    className="text-(--ui-text-secondary)"
                  >
                    {new Date(note.createdAt).toLocaleString(getLocale())}
                  </time>
                </div>
                <p className="whitespace-pre-wrap break-words text-[12px] text-(--ui-text-secondary)">
                  {note.finding}
                </p>
                {note.suggestion ? (
                  <p className="whitespace-pre-wrap break-words text-[12px] text-(--ui-text-secondary)">
                    {t("Suggested correction: ")}
                    {note.suggestion}
                  </p>
                ) : null}
                {note.details ? (
                  <details className="text-[12px] text-(--ui-text-secondary)">
                    <summary className="cursor-pointer">{t("Review details")}</summary>
                    <p className="mt-1 whitespace-pre-wrap break-words">{note.details}</p>
                  </details>
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
                    >
                      {t("Open review")}
                    </Button>
                  ) : null}
                </div>
                {(note.sessionIds?.length ?? 0) > 1 ? (
                  <details className="text-[11px] text-(--ui-text-secondary)">
                    <summary className="cursor-pointer">{t("Review history")}</summary>
                    <div className="flex flex-wrap gap-1">
                      {note.sessionIds!.map((sessionId, index) => (
                        <Button
                          variant="ghost"
                          key={sessionId}
                          type="button"

                          onClick={() => onOpenReview(sessionId)}
                        >
                          {t("Review ")}
                          {index + 1}
                        </Button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-(--ui-text-secondary)">
        {t("Marking a note fixed does not complete this task. Its checks and review still apply.")}
      </p>
    </section>
  );
}
