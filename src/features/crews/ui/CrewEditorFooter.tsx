import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import type { CrewAutosaveStatus } from "./useCrewAutosave";

/**
 * The editor's footer: what is saved (or what blocks saving) on the left; New work, or
 * Create crew for a crew that is not stored yet, on the right. There is no Save or Discard
 * for a stored crew: it saves itself.
 */
export function CrewEditorFooter({
  isNew,
  issue,
  status,
  error,
  onRetry,
  creating,
  starting,
  pending,
  blocked,
  canStart,
  onCreate,
  onStart,
}: {
  isNew: boolean;
  /** Why the draft cannot be saved yet, when the owner has something to fix. */
  issue: string;
  status: CrewAutosaveStatus;
  error: string;
  onRetry: () => void;
  creating: boolean;
  starting: boolean;
  pending: boolean;
  /** A revision conflict is open: nothing is sent until it is resolved. */
  blocked: boolean;
  canStart: boolean;
  onCreate: () => void;
  onStart: () => void;
}) {
  const state = issue ? (
    <InlineMessage tone="danger" live="polite">
      {issue}
    </InlineMessage>
  ) : status === "error" ? (
    <InlineMessage tone="danger" retry={{ onRetry }}>
      {error}
    </InlineMessage>
  ) : status === "saving" ? (
    <InlineMessage tone="neutral" icon={null}>
      {t("Saving…")}
    </InlineMessage>
  ) : status === "saved" || (status === "idle" && !isNew) ? (
    <InlineMessage tone="neutral" icon={null}>
      {t("All changes saved")}
    </InlineMessage>
  ) : null;
  return (
    <>
      <div className="min-w-0 break-words">{state}</div>
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        {isNew ? (
          <Button variant="primary" loading={creating} disabled={pending} onClick={onCreate}>
            {t("Create crew")}
          </Button>
        ) : canStart ? (
          <Button
            variant="primary"
            loading={starting}
            disabled={pending || blocked}
            onClick={onStart}
          >
            {t("New work")}
          </Button>
        ) : null}
      </div>
    </>
  );
}
