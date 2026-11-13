import { useState } from "react";
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

/** The new/edit task dialog. The board hands over the draft to start from; the
 * text being typed lives here, so a keystroke re-renders only this dialog, and the
 * board receives the finished draft with the save. */
export function TasksViewDraftDialog({
  draft: seed,
  recents,
  machines,
  todoCapable,
  saving,
  error,
  sprintName,
  onClose,
  onSave,
}: {
  /** The draft to start from; a different one restarts the form. */
  draft: TaskDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  todoCapable: RemoteMachine[];
  saving: boolean;
  error: string | null;
  sprintName: string | undefined;
  onClose: () => void;
  onSave: (mode: "todo" | "queued" | "save", draft: TaskDraft) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(seed);
  const [seenSeed, setSeenSeed] = useState(seed);
  if (seenSeed !== seed) {
    setSeenSeed(seed);
    setDraft(seed);
  }
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
            if (!saving) setDraft(next);
          }}
          onCancel={() => {
            if (!saving) onClose();
          }}
          onSubmit={(mode, resolvedDraft) => onSave(mode, resolvedDraft)}
        />
      </HostModelSource>
    </Modal>
  );
}
