import { Text } from "../../../shared/ui/Text";
import { useRef, useState, type ReactNode } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Popover } from "../../../shared/ui/Popover";
import { TriangleAlert } from "../../../shared/ui/icons";
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

export type TaskBoardProblemProps = {
  label: string;
  message: string;
  details?: string | null;
  updatedAt?: number | null;
  hostStopped: boolean;
  retrying: boolean;
  onRetry: () => void;
};

export function TaskBoardProblem({
  label,
  message,
  details,
  updatedAt,
  hostStopped,
  retrying,
  onRetry,
}: TaskBoardProblemProps) {
  const t = useT();
  const { formatDate } = useFormat();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [startError, setStartError] = useState<string>();
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="chip"
        tone="warning"
        size="sm"
        startIcon={<TriangleAlert className="icon-sm" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          kind="dialog"
          aria-label={label}
          width={320}
          variant="panel"
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="task-board-status-details"
        >
          <Text as="p" wrap="anywhere">
            {message}
          </Text>
          <Text as="p" size="caption" tone="secondary">
            {updatedAt
              ? t("Last verified {p0}", {
                  p0: formatDate(updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                })
              : t("No verified task data yet.")}
          </Text>
          <div className="task-status-actions">
            <Button variant="primary" size="sm" loading={retrying} onClick={onRetry}>
              {t("Retry")}
            </Button>
            {hostStopped ? (
              <LocalHostStartButton onStarted={onRetry} onError={setStartError} />
            ) : null}
          </div>
          {startError ? <Alert tone="danger">{startError}</Alert> : null}
          {details ? (
            <Disclosure variant="compact" summary={t("Technical details")}>
              <div className="task-board-status-details">
                <CopyButton size="sm" label={t("Copy")} text={details} resetKeys={[details]} />
                <OutputBlock aria-label={t("Error details")} frame="filled" size="caption">
                  {details}
                </OutputBlock>
              </div>
            </Disclosure>
          ) : null}
        </Popover>
      ) : null}
    </>
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
  const blockedReason = busy
    ? t("Wait for the checks to finish.")
    : !valid
      ? t("Check the delivery target.")
      : undefined;
  return (
    <Modal
      title={t("Choose delivery target")}
      size="lg"
      onClose={() => {
        if (!acting) onClose();
      }}
      footer={
        <ModalActions reason={blockedReason}>
          <Button variant="ghost" type="button" disabled={acting} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="button"
            loading={acting}
            disabled={acting || !!blockedReason}
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
