import { Button } from "../../../shared/ui/Button";
import { Progress } from "../../../shared/ui/Progress";
import { t, useLocale } from "../../../shared/i18n/technical";
import { formatFileSize } from "../model/filePreview";

/**
 * Byte progress for a file being copied from a connected machine, with Cancel.
 * Indeterminate until the size is known; omit `onCancel` for a read that has nothing to abort.
 * `label` is a whole translated message (for example the "Opening {p0}…" one); sizes are appended.
 */
export function FileTransferProgress({
  label,
  received,
  total,
  onCancel,
}: {
  label: string;
  received?: number;
  total?: number;
  onCancel?: () => void;
}) {
  useLocale();
  const sized = typeof total === "number" && Number.isSafeInteger(total) && total > 0;
  return (
    <div role="status" className="flex w-full max-w-sm flex-col items-center gap-2">
      <Progress
        compact
        className="w-full"
        value={sized ? (received ?? 0) : undefined}
        max={sized ? (total ?? 1) : 1}
        label={
          sized
            ? `${label} ${formatFileSize(received ?? 0)} / ${formatFileSize(total ?? 0)}`
            : label
        }
      />
      {onCancel ? (
        <Button size="sm" variant="ghost" motion="none" type="button" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      ) : null}
    </div>
  );
}
