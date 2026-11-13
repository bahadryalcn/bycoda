import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";

export interface LinkableTask {
  id: string;
  title: string;
}

/**
 * Links a session to one existing task, or removes the link. A session has at most one task,
 * so while linked the dialog offers Unlink only; the task record itself is never changed.
 */
export function SessionTaskLinkDialog({
  sessionTitle,
  tasks,
  linkedTaskId,
  onClose,
  onLink,
  onUnlink,
}: {
  sessionTitle: string;
  tasks: readonly LinkableTask[];
  linkedTaskId?: string;
  onClose: () => void;
  onLink: (taskId: string) => Promise<void>;
  onUnlink: () => Promise<void>;
}) {
  const t = useT();
  const [taskId, setTaskId] = useState(linkedTaskId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronizes pending callback ownership with this mounted dialog, so an old completion cannot close a newer draft.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const linked = tasks.find((task) => task.id === linkedTaskId);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t("Could not update the task link."));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={linkedTaskId ? t("Linked task") : t("Link to a task")}
      context={sessionTitle}
      closeDisabled={busy}
      onClose={onClose}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          {linkedTaskId ? (
            <Button
              variant="primary"
              tone="danger"
              loading={busy}
              onClick={() => void run(onUnlink)}
            >
              {t("Unlink")}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={!taskId}
              onClick={() => void run(() => onLink(taskId))}
            >
              {t("Link")}
            </Button>
          )}
        </ModalActions>
      }
    >
      <div className="flex flex-col gap-3">
        {linkedTaskId ? (
          <p>{linked?.title ?? linkedTaskId}</p>
        ) : (
          <SearchableSelect
            disabled={busy}
            label={t("Task")}
            options={tasks.map((task) => ({
              value: task.id,
              label: task.title,
            }))}
            value={taskId}
            onChange={setTaskId}
            placeholder={t("Choose a task")}
            emptyLabel={t("No tasks")}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
