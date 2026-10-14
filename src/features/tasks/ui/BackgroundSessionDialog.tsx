import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle } from "../../../shared/ui/icons";
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

  useEffect(() => {
    let alive = true;
    setSummary(undefined);
    setError("");
    loadBackgroundSessionSummary(target).then(
      (loaded) => {
        if (alive) setSummary(loaded);
      },
      (reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
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
          <div role="alert" className="flex flex-wrap items-start gap-2 text-[12px] text-danger">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className="rounded px-2 py-1 text-content/70 active:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t("Retry")}
            </button>
          </div>
        ) : !summary ? (
          <div
            role="status"
            aria-label={t("Loading…")}
            className="grid h-20 place-items-center text-content/35"
          >
            <LoaderCircle className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-[12px] leading-snug text-content/55">
                {summary.status}
                {t(" · on this computer’s host")}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border border-content/10 bg-content/3 p-3 text-[12px] leading-relaxed text-content/80">
              {summary.reply || <span className="text-content/45">{t("No reply yet.")}</span>}
            </div>
            {summary.note ? (
              <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-content/55">
                {summary.note}
              </p>
            ) : null}
          </>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
