import { t, useLocale } from "../../../shared/i18n/technical";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";

const iconButton =
  "grid size-6 place-items-center rounded text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35";

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
    <button
      type="button"
      title={t("Open the next conflicted file")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onNextFile}
      className="h-6 shrink-0 rounded-md px-2 text-[11px] text-content/70 hover:bg-content/10 hover:text-content"
    >
      {t("Next file")}
    </button>
  ) : null;
  if (count === 0 && !canMarkResolved) return null;
  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-stroke px-3 pr-1 text-[11px]"
      role="toolbar"
      aria-label={t("Merge conflicts")}
    >
      {count > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-warning" role="status">
            {count === 1 ? t("1 conflict") : t("{p0} conflicts", { p0: count })}
          </span>
          <div className="flex items-center gap-0.5">
            {fileNote ? (
              <span className="mr-1 truncate text-content/50" role="status" title={fileNote}>
                {fileNote}
              </span>
            ) : null}
            {nextFile}
            <button
              type="button"
              title={t("Previous conflict")}
              aria-label={t("Previous conflict")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onPrev}
              className={iconButton}
            >
              <ChevronUp className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t("Next conflict")}
              aria-label={t("Next conflict")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onNext}
              className={iconButton}
            >
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="min-w-0 truncate text-content/60" role="status">
            {error ? (
              <span className="text-danger" title={error}>
                {error}
              </span>
            ) : (
              t("All conflicts resolved")
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {fileNote ? (
              <span className="truncate text-content/50" role="status" title={fileNote}>
                {fileNote}
              </span>
            ) : null}
            {nextFile}
            <button
              type="button"
              disabled={marking}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onMarkResolved}
              title={t("Save the file and stage it")}
              className="mr-2 h-6 shrink-0 rounded-md bg-content/10 px-2 text-[11px] font-medium text-content hover:bg-content/15 disabled:opacity-50"
            >
              {marking ? t("Staging…") : t("Mark resolved")}
            </button>
          </div>
        </>
      )}
    </header>
  );
}
