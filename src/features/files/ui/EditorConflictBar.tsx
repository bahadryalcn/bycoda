import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";

const iconButton = "shrink-0";

/**
 * The editor's merge-conflict strip: how many blocks are left and a way to
 * step between them, then, once the last one is gone, a way to stage the file.
 */
export function EditorConflictBar({
  count,
  canMarkResolved,
  marking,
  error,
  onPrev,
  onNext,
  onNextFile,
  fileNote,
  onMarkResolved,
}: {
  count: number;
  canMarkResolved: boolean;
  marking: boolean;
  error: string | null;
  onPrev: () => void;
  onNext: () => void;
  /** Opens the next file git lists as unmerged; absent when the editor cannot open files. */
  onNextFile?: () => void;
  /** Why the last "next file" did nothing. */
  fileNote?: string | null;
  onMarkResolved: () => void;
}) {
  useLocale();
  const nextFile = onNextFile ? (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      tooltip={t("Open the next conflicted file")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onNextFile}
      className="shrink-0"
    >
      {t("Next file")}
    </Button>
  ) : null;
  if (count === 0 && !canMarkResolved) return null;
  return (
    <header
      className="flex min-h-(--ui-control-height-compact) shrink-0 items-center justify-between gap-2 px-2 text-ui-caption"
      role="toolbar"
      aria-label={t("Merge conflicts")}
    >
      {count > 0 ? (
        <>
          <span className="font-medium tabular-nums text-(--ui-tone-warning-fg)" role="status">
            {count === 1 ? t("1 conflict") : t("{p0} conflicts", { p0: count })}
          </span>
          <div className="flex items-center gap-1">
            {fileNote ? (
              <span
                className="mr-1 truncate text-[var(--ui-text-secondary)]"
                role="status"
                title={fileNote}
              >
                {fileNote}
              </span>
            ) : null}
            {nextFile}
            <Button
              size="sm"
              iconOnly
              label={t("Previous conflict")}
              variant="ghost"
              motion="none"
              type="button"
              tooltip={t("Previous conflict")}
              aria-label={t("Previous conflict")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onPrev}
              className={iconButton}
            >
              <ChevronUp className="icon-sm" strokeWidth={1.75} />
            </Button>
            <Button
              size="sm"
              iconOnly
              label={t("Next conflict")}
              variant="ghost"
              motion="none"
              type="button"
              tooltip={t("Next conflict")}
              aria-label={t("Next conflict")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onNext}
              className={iconButton}
            >
              <ChevronDown className="icon-sm" strokeWidth={1.75} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className="min-w-0 truncate text-[var(--ui-text-secondary)]" role="status">
            {error ? (
              <span className="text-(--ui-tone-danger-fg)" title={error}>
                {error}
              </span>
            ) : (
              t("All conflicts resolved")
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {fileNote ? (
              <span
                className="truncate text-[var(--ui-text-secondary)]"
                role="status"
                title={fileNote}
              >
                {fileNote}
              </span>
            ) : null}
            {nextFile}
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              disabled={marking}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onMarkResolved}
              tooltip={t("Save the file and stage it")}
              className="shrink-0"
            >
              {marking ? t("Staging…") : t("Mark resolved")}
            </Button>
          </div>
        </>
      )}
    </header>
  );
}
