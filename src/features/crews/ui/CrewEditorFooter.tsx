import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import type { CrewAutosaveStatus } from "./useCrewAutosave";

/**
 * The editor's footer: what is saved (or what blocks saving) on the left, Create crew for a
 * crew that is not stored yet on the right. A stored crew has no Save, Discard, New work, copy
 * or delete here: it saves itself, and the Teams menu owns the rest.
 */
export function CrewEditorFooter({
  isNew,
  issue,
  status,
  error,
  onRetry,
  creating,
  pending,
  blocked,
  onCreate,
}: {
  isNew: boolean;
  /** Why the draft cannot be saved yet, when the owner has something to fix. */
  issue: string;
  status: CrewAutosaveStatus;
  error: string;
  onRetry: () => void;
  creating: boolean;
  pending: boolean;
  /** A revision conflict is open: nothing is sent until it is resolved. */
  blocked: boolean;
  onCreate: () => void;
}) {
  const state = blocked ? null : issue ? (
    <InlineError live="polite">{issue}</InlineError>
  ) : status === "error" ? (
    <InlineError details={error} retry={{ onRetry }}>
      {t("Could not save the crew.")}
    </InlineError>
  ) : status === "saving" ? (
    <LoadingText>{t("Saving…")}</LoadingText>
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
        ) : null}
      </div>
    </>
  );
}
