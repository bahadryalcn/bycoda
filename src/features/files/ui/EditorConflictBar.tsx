import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";

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
      onMouseDown={(event) => event.preventDefault()}
      onClick={onNextFile}
    >
      {t("Next file")}
    </Button>
  ) : null;
  if (count === 0 && !canMarkResolved) return null;
  return (
    <Text
      as="header"
      tone="inherit"
      className="flex min-h-(--ui-control-height-compact) shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-1"
      role="toolbar"
      aria-label={t("Merge conflicts")}
    >
      {count > 0 ? (
        <>
          <Text
            size="inherit"
            tone="warning"
            weight="medium"
            className="tabular-nums"
            role="status"
          >
            {count === 1 ? t("1 conflict") : t("{p0} conflicts", { p0: count })}
          </Text>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {fileNote ? (
              <Text
                wrap="anywhere"
                size="inherit"
                tone="secondary"
                className="min-w-0 mr-1"
                role="status"
              >
                {fileNote}
              </Text>
            ) : null}
            {nextFile}
            <Button
              size="sm"
              iconOnly
              label={t("Previous conflict")}
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onPrev}
            >
              <ChevronUp className="icon-sm" strokeWidth={1.75} />
            </Button>
            <Button
              size="sm"
              iconOnly
              label={t("Next conflict")}
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onNext}
            >
              <ChevronDown className="icon-sm" strokeWidth={1.75} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Text
            size="inherit"
            tone="secondary"
            wrap="anywhere"
            className="min-w-0 flex-1"
            role="status"
          >
            {error ? (
              <Text size="inherit" tone="danger">
                {error}
              </Text>
            ) : (
              t("All conflicts resolved")
            )}
          </Text>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {fileNote ? (
              <Text
                wrap="anywhere"
                size="inherit"
                tone="secondary"
                className="min-w-0"
                role="status"
              >
                {fileNote}
              </Text>
            ) : null}
            {nextFile}
            <Button
              size="sm"
              variant="ghost"
              disabled={marking}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onMarkResolved}
            >
              {marking ? t("Staging…") : t("Mark resolved")}
            </Button>
          </div>
        </>
      )}
    </Text>
  );
}
