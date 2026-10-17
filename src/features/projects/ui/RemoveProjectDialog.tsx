import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { prettyCwd } from "../../../shared/lib/paths";
import { projectSessionCount } from "../model/projectData";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";

type Props = {
  name: string;
  path: string;
  paths?: string[];
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * Delete drops the project from the rail and its saved chats. The folder on
 * disk is left alone; opening it again brings the project back empty.
 */
export function RemoveProjectDialog({
  name,
  path,
  paths,
  confirmDisabled,
  onCancel,
  onConfirm,
}: Props) {
  useLocale();
  const [sessions, setSessions] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const deleting = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRoot = useRef<HTMLDivElement>(null);
  const close = () => {
    if (!deleting.current) onCancel();
  };
  const overlayId = useOverlay(dialogRoot, true, close);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setCountError(null);
    void Promise.all((paths ?? [path]).map(projectSessionCount)).then(
      (counts) => {
        if (!cancelled) setSessions(counts.reduce((sum, count) => sum + count, 0));
      },
      (reason: unknown) => {
        if (!cancelled) setCountError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, paths, revision]);

  const confirm = async () => {
    if (deleting.current || confirmDisabled || sessions == null || countError) return;
    deleting.current = true;
    setPending(true);
    setDeleteError(null);
    try {
      await onConfirm();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
      // A partial deletion may have removed some conversations. Re-read before
      // offering the same confirmed project snapshot for a retry.
      setRevision((value) => value + 1);
    } finally {
      deleting.current = false;
      setPending(false);
    }
  };

  return createPortal(
    <OverlayParent.Provider value={overlayId}>
      <div
        className="fixed inset-0"
        style={{ zIndex: LAYER.dialog }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-(--ui-overlay-backdrop)" />
        <div
          ref={dialogRoot}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-busy={pending}
          aria-label={t("Delete {p0}", { p0: name })}
          onMouseDown={(event) => event.stopPropagation()}
          className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-stroke bg-(--ui-surface) p-4 shadow-xl backdrop-blur-xl"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-[13px] font-medium leading-tight text-content">
              {t("Delete “")}
              {name}”?
            </h2>
            <p className="text-[12px] leading-snug text-(--ui-text-secondary)">
              {paths
                ? t(
                    "All conversations for the selected projects will be deleted. The projects leave the sidebar. Their folders on disk stay put.",
                  )
                : t(
                    "All conversations for this project will be deleted. It also leaves the sidebar. The folder on disk stays put, and opening it again brings the project back empty.",
                  )}
            </p>
            {sessions != null && sessions > 0 ? (
              <p className="text-[12px] leading-snug text-(--ui-text-secondary)">
                {sessions === 1
                  ? t("1 saved conversation will be removed.")
                  : t("{p0} saved conversations will be removed.", { p0: sessions })}
              </p>
            ) : null}
            {countError ? (
              <Alert tone="danger">
                <p>{countError}</p>
                <Button
                  type="button"
                  onClick={() => setRevision((value) => value + 1)}
                  variant="secondary"
                >
                  {t("Retry")}
                </Button>
              </Alert>
            ) : sessions == null ? (
              <p role="status" className="text-[12px] text-(--ui-text-secondary)">
                {t("Loading…")}
              </p>
            ) : null}
            {deleteError ? <Alert tone="danger">{deleteError}</Alert> : null}
            <div className="max-h-40 overflow-y-auto text-[11px] leading-tight text-(--ui-text-muted)">
              {(paths ?? [path]).map((entry) => (
                <p key={entry} className="break-all">
                  {prettyCwd(entry)}
                </p>
              ))}
            </div>
            {confirmDisabled ? (
              <Alert tone="danger">
                {t(
                  "Selection changed or a project is working. Close this dialog and review your selection.",
                )}
              </Alert>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              ref={cancelRef}
              type="button"
              onClick={close}
              disabled={pending}
              variant="secondary"
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={pending || confirmDisabled || sessions == null || countError != null}
              variant="primary"
              tone="danger"
              loading={pending}
              loadingLabel={t("Deleting…")}
              label={pending ? t("Deleting…") : t("Delete")}
            >
              {pending ? t("Deleting…") : t("Delete")}
            </Button>
          </div>
        </div>
      </div>
    </OverlayParent.Provider>,
    document.body,
  );
}
