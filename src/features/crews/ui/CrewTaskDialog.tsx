import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Modal } from "../../../shared/ui/Modal";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Button } from "../../../shared/ui/Button";
import { HostModelSource } from "../../connections/public/HostModelSource";
import type { BackgroundSessionTarget } from "../../tasks";
import { newTaskDraft, saveTask, startTask, type TaskDraft } from "../../tasks/public/taskCreation";
import { TaskForm } from "../../tasks/public/taskCreation";
import type { useProjectCrews } from "../model/crewClient";
import { useCrewMachineScope } from "./CrewMachineScope";

// Each exact host/project/team owns its draft and original creation receipt.
const drafts = new Map<string, TaskDraft>();

/** Every Crew entry point creates ordinary board work through the canonical form. */
export function CrewTaskDialog({
  cwd: homeCwd,
  state: homeState,
  definitionId,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  onOpen?: (target: BackgroundSessionTarget) => void | Promise<void>;
  onEdit?: (definitionId: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const scope = useCrewMachineScope(homeCwd, homeState);
  const data = scope.state.data;
  return data ? (
    <CrewTaskDraft
      key={JSON.stringify([data.machine.id, data.project.id, definitionId])}
      cwd={scope.cwd}
      state={scope.state}
      definitionId={definitionId}
      onClose={onClose}
    />
  ) : (
    <Modal title={t("New task")} onClose={onClose}>
      {scope.state.error ? (
        <Alert tone="danger">{scope.state.error.message}</Alert>
      ) : (
        <LoadingText>{t("Loading crews…")}</LoadingText>
      )}
    </Modal>
  );
}

function CrewTaskDraft({
  cwd,
  state,
  definitionId,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  onClose: () => void;
}) {
  const data = state.data!;
  const crew = data.definitions.find((entry) => entry.id === definitionId) ?? data.definitions[0];
  const key = JSON.stringify([data.machine.id, data.project.id, definitionId]);
  const [draft, setDraft] = useState<TaskDraft>(() => {
    const saved = drafts.get(key);
    if (saved) return saved;
    const candidate = crew?.agents.find((agent) => agent.role === "coordinator")?.candidates[0];
    const initial = {
      ...newTaskDraft(
        cwd,
        candidate?.harness ?? "codex",
        candidate?.model ?? "",
        data.modelPoolsSupported,
      ),
      machineId: data.machine.id,
      crewDefinitionId: definitionId ?? crew?.id,
      runtimeMode: crew?.policy.runtimeMode ?? "supervised",
    };
    drafts.set(key, initial);
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState(false);
  const gate = useRef(false);
  const save = async (mode: "todo" | "queued" | "save", next: TaskDraft) => {
    if (gate.current) return;
    gate.current = true;
    setSaving(true);
    setError(undefined);
    drafts.set(key, next);
    try {
      const saved = await saveTask([data.machine], next, mode === "todo" ? "todo" : "queued");
      // A confirmed creation retires the draft before a separate start can fail.
      drafts.delete(key);
      setCreated(true);
      if (mode === "queued" && saved.workspaceControlsSupported) await startTask(saved);
      await state.refetch();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      title={t("New task")}
      size="lg"
      padding="none"
      scroll="none"
      onClose={() => {
        if (!gate.current) onClose();
      }}
    >
      {error ? (
        <Alert tone="danger" className="mx-4 mt-3">
          {error}
        </Alert>
      ) : null}
      {created ? (
        <Alert
          tone="success"
          className="m-4"
          action={<Button onClick={onClose}>{t("Close")}</Button>}
        >
          {t("Task created")}
        </Alert>
      ) : (
        <HostModelSource
          machine={data.machine}
          cwd={cwd}
          model={draft.model}
          values={draft.modelSettings}
        >
          <TaskForm
            draft={draft}
            recents={[{ path: cwd, openedAt: 0 }]}
            machines={[data.machine]}
            machine={data.machine.name}
            saving={saving}
            onChange={(next) => {
              if (!gate.current) {
                drafts.set(key, next);
                setDraft(next);
              }
            }}
            onCancel={onClose}
            onSubmit={(mode, next) => {
              void save(mode, next);
            }}
          />
        </HostModelSource>
      )}
    </Modal>
  );
}
