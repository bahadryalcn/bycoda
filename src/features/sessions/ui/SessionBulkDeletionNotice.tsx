import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Check, Trash2, X } from "../../../shared/ui/icons";

export type SessionBulkDeletionFeedback = {
  progress: {
    completed: number;
    total: number;
    title: string;
    sessionIds: readonly string[];
  } | null;
  message: string | null;
  error: boolean;
  success: boolean;
  onDismiss: () => void;
};

export function SessionBulkDeletionNotice({
  feedback,
  title,
}: {
  feedback: SessionBulkDeletionFeedback;
  title?: string;
}) {
  const t = useT();
  const { progress, message, error, success, onDismiss } = feedback;
  if (!progress && !message) return null;
  const text = progress ? title || progress.title : message;
  return (
    <InlineMessage
      tone={error && !progress ? "danger" : "neutral"}
      icon={
        progress ? (
          <Spinner className="text-(--ui-tone-danger-fg)" />
        ) : success ? (
          <Check className="icon-sm" />
        ) : undefined
      }
      data-session-delete-status
      aria-label={
        progress
          ? t("Deleting conversations… {p0}/{p1} completed", {
              p0: progress.completed,
              p1: progress.total,
            })
          : undefined
      }
      className="shrink-0 border-b border-(--ui-pane-border) px-3 py-2"
    >
      <span className="flex min-w-0 items-center gap-2">
        <OverflowTooltip label={text}>
          <span className="min-w-0 flex-1 truncate">{text}</span>
        </OverflowTooltip>
        {progress ? (
          <span className="shrink-0 tabular-nums">
            {progress.completed}/{progress.total}
          </span>
        ) : null}
        <Trash2 className="icon-sm shrink-0 text-(--ui-tone-danger-fg)" aria-hidden />
        {!progress ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Dismiss notice")}
            onClick={onDismiss}
          >
            <X className="icon-xs" />
          </Button>
        ) : null}
      </span>
    </InlineMessage>
  );
}
