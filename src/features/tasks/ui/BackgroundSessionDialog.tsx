import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal } from "../../../shared/ui/Modal";
import {
  loadBackgroundSessionSummary,
  type BackgroundSessionSummary,
  type BackgroundSessionTarget,
} from "../model/backgroundSession";

/** A read-only look at a session this computer's own host ran in the
 * background. The desktop has no transcript view for those, so this shows
 * where it stands and the agent's last reply. */
export function BackgroundSessionDialog({
  target,
  onClose,
}: {
  target: Pick<BackgroundSessionTarget, "machineId" | "sessionId">;
  onClose: () => void;
}) {
  useLocale();
  const [summary, setSummary] = useState<BackgroundSessionSummary>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const pending = useRef(false);
  // A new target or a retry starts over from the load; only another target
  // clears the error, so a retry keeps it visible while it runs.
  const [seen, setSeen] = useState({
    machineId: target.machineId,
    sessionId: target.sessionId,
    revision,
  });
  if (
    seen.machineId !== target.machineId ||
    seen.sessionId !== target.sessionId ||
    seen.revision !== revision
  ) {
    setSeen({ machineId: target.machineId, sessionId: target.sessionId, revision });
    setSummary(undefined);
    setLoading(true);
    if (seen.machineId !== target.machineId || seen.sessionId !== target.sessionId) setError("");
  }

  useEffect(() => {
    let alive = true;
    pending.current = true;
    loadBackgroundSessionSummary(target).then(
      (loaded) => {
        if (alive) {
          setSummary(loaded);
          setError("");
          setLoading(false);
          pending.current = false;
        }
      },
      (reason: unknown) => {
        if (alive) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
          pending.current = false;
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [target.machineId, target.sessionId, revision]);

  return (
    <Modal title={summary?.title ?? t("Background session")} onClose={onClose} size="md">
      <div className="flex min-h-0 flex-col gap-3 p-4">
        {error ? (
          <Alert tone="danger" role="alert" className="flex-wrap">
            <span>{error}</span>
            <Button
              variant="ghost"
              type="button"
              loading={loading}
              onClick={() => {
                if (pending.current) return;
                pending.current = true;
                setRevision((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          </Alert>
        ) : !summary ? (
          <LoadingText className="h-20 justify-center" />
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-ui-caption leading-snug text-(--ui-text-secondary)">
                {summary.status}
                {t(" · on this computer’s host")}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-3 text-ui-caption leading-relaxed text-(--ui-text-secondary)">
              {summary.reply || <EmptyState size="inline" description={t("No reply yet.")} />}
            </div>
            {summary.note ? (
              <p className="whitespace-pre-wrap break-words text-ui-caption leading-snug text-(--ui-text-secondary)">
                {summary.note}
              </p>
            ) : null}
          </>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
