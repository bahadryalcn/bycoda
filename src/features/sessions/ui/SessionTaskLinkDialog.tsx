import { useState } from "react";
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
  const linked = tasks.find((task) => task.id === linkedTaskId);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    work().then(
      () => {
        setBusy(false);
        onClose();
      },
      (cause: unknown) => {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : t("Could not update the task link."));
      },
    );
  };
  return (
    <Modal
      size="sm"
      title={linkedTaskId ? t("Linked task") : t("Link to a task")}
      context={sessionTitle}
      onClose={onClose}
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          {linkedTaskId ? (
            <Button variant="primary" tone="danger" loading={busy} onClick={() => run(onUnlink)}>
              {t("Unlink")}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={!taskId}
              onClick={() => run(() => onLink(taskId))}
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
