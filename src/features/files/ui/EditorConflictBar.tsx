import { Text } from "../../../shared/ui/Text";
import { LiveText } from "../../../shared/ui/LiveText";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";

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
          <LiveText
            size="inherit"
            tone="warning"
            weight="medium"
            className="tabular-nums"
            text={count === 1 ? t("1 conflict") : t("{p0} conflicts", { p0: count })}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {fileNote ? (
              <LiveText
                size="inherit"
                tone="secondary"
                className="min-w-0 me-1 wrap-anywhere"
                text={fileNote}
              />
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
          {error ? (
            <InlineError className="min-w-0 flex-1" details={error}>
              {t("Couldn’t mark the file as resolved")}
            </InlineError>
          ) : (
            <LiveText
              size="inherit"
              tone="secondary"
              className="min-w-0 flex-1 wrap-anywhere"
              text={t("All conflicts resolved")}
            />
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {fileNote ? (
              <LiveText
                size="inherit"
                tone="secondary"
                className="min-w-0 wrap-anywhere"
                text={fileNote}
              />
            ) : null}
            {nextFile}
            <Button
              size="sm"
              variant="ghost"
              loading={marking}
              loadingLabel={t("Staging…")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onMarkResolved}
            >
              {t("Mark resolved")}
            </Button>
          </div>
        </>
      )}
    </Text>
  );
}
