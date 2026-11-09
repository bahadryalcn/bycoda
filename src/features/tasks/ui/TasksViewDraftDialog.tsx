import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Modal } from "../../../shared/ui/Modal";
import type { RemoteMachine } from "../../connections";
import { HostModelSource } from "../../connections/public/HostModelSource";
import type { RecentProject } from "../../projects/public/recents";
import { todoUnsupportedMessage, type TaskDraft } from "../model/taskClient";
import { TaskForm } from "./TaskForm";
import { machineName } from "./TaskFormFields";
import { resolveTaskMachineId } from "./useTaskTargetMachine";

/** The new/edit task dialog; the draft and its save stay owned by the board. */
export function TasksViewDraftDialog({
  draft,
  recents,
  machines,
  todoCapable,
  saving,
  error,
  sprintName,
  onChange,
  onClose,
  onSave,
}: {
  draft: TaskDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  todoCapable: RemoteMachine[];
  saving: boolean;
  error: string | null;
  sprintName: string | undefined;
  onChange: (draft: TaskDraft) => void;
  onClose: () => void;
  onSave: (mode: "todo" | "queued" | "save") => void;
}) {
  const t = useT();
  return (
    <Modal
      padding="none"
      title={draft.id ? t("Edit task") : t("New task")}
      context={!draft.id && sprintName ? `${t("Sprint")}: ${sprintName}` : undefined}
      size="lg"
      scroll="none"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      {error ? (
        <Alert tone="danger" className="mx-4 mt-3 shrink-0">
          {error}
        </Alert>
      ) : null}
      <HostModelSource
        machine={machines.find(
          (entry) => entry.id === resolveTaskMachineId(machines, draft.cwd, draft.machineId),
        )}
        cwd={draft.cwd}
        model={draft.model}
        values={draft.modelSettings}
      >
        <TaskForm
          key={draft.id ?? "new"}
          draft={draft}
          recents={recents}
          machines={machines}
          machine={machineName(machines, draft.cwd, draft.machineId)}
          todoUnsupported={todoUnsupportedMessage(machines, todoCapable, draft.cwd)}
          saving={saving}
          onChange={(next) => {
            if (!saving) onChange(next);
          }}
          onCancel={() => {
            if (!saving) onClose();
          }}
          onSubmit={onSave}
        />
      </HostModelSource>
    </Modal>
  );
}
