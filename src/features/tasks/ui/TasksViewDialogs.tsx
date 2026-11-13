import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { formatDate, useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { LocalHostStartButton } from "../../connections/public/LocalHostDownNotice";
import type { BoardTask } from "../model/taskClient";
import type { TaskWorkspace } from "../model/taskWorkspace";
import type { RemoteMachine } from "../../connections";
import { TaskMetricsComparison } from "./TaskRunInsights";
import { TaskWorkspacePicker, type WorkspaceChecks } from "./TaskWorkspacePicker";

export function TaskMetricsDialog({
  tasks,
  onClose,
}: {
  tasks: readonly BoardTask[];
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal title={t("Compare accepted results")} size="lg" onClose={onClose}>
      <div className="min-w-0">
        <TaskMetricsComparison tasks={tasks.filter((task) => !task.stale)} />
      </div>
    </Modal>
  );
}

export function TaskBoardStatusDialog({
  missingNotice,
  error,
  updatedAt,
  hostStopped,
  onClose,
  onRetry,
  onStartError,
}: {
  missingNotice: string | null | undefined;
  /** The task action error, or the board's data error. */
  error: string | null | undefined;
  updatedAt: number | null | undefined;
  hostStopped: boolean;
  onClose: () => void;
  onRetry: () => void;
  onStartError: (message: string | undefined) => void;
}) {
  const t = useT();
  return (
    <Modal title={t("Task board status")} onClose={onClose}>
      <Text
        as="div"
        size="secondary"
        tone="inherit"
        leading="inherit"
        className="task-board-status-details"
      >
        {missingNotice ? <p>{missingNotice}</p> : null}
        {error ? <p>{error}</p> : <p>{t("Up to date")}</p>}
        {updatedAt ? (
          <Text
            as="p"
            size="caption"
            tone="secondary"
            leading="inherit"
            className="task-status-meta"
          >
            {t("Last verified {p0}", {
              p0: formatDate(updatedAt, { dateStyle: "medium", timeStyle: "short" }),
            })}
          </Text>
        ) : null}
        {hostStopped ? (
          <LocalHostStartButton onStarted={onRetry} onError={(message) => onStartError(message)} />
        ) : null}
      </Text>
    </Modal>
  );
}

export function TaskDeliveryDialog({
  task,
  machine,
  workspace,
  acting,
  busy,
  valid,
  error,
  onChange,
  onBusyChange,
  onChecksChange,
  onClose,
  onSave,
}: {
  task: BoardTask;
  machine: RemoteMachine | undefined;
  workspace: TaskWorkspace | undefined;
  acting: boolean;
  busy: boolean;
  valid: boolean;
  error: ReactNode;
  onChange: (workspace?: TaskWorkspace) => void;
  onBusyChange: (busy: boolean) => void;
  onChecksChange: (patch: Partial<WorkspaceChecks>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <Modal
      title={t("Choose delivery target")}
      size="lg"
      onClose={() => {
        if (!acting) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="ghost" type="button" disabled={acting} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="button"
            loading={acting}
            disabled={acting || busy || !valid}
            onClick={onSave}
          >
            {t("Save delivery target")}
          </Button>
        </ModalActions>
      }
    >
      <div className="task-delivery">
        <Text as="p" size="secondary" leading="inherit">
          {t(
            "The completed task stays on its branch. Pending tasks in this epic and project will use the selected integration worktree.",
          )}
        </Text>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <TaskWorkspacePicker
          machine={machine}
          cwd={task.cwd}
          value={workspace}
          onChange={onChange}
          disabled={acting}
          onBusyChange={onBusyChange}
          onChecksChange={onChecksChange}
        />
      </div>
    </Modal>
  );
}
