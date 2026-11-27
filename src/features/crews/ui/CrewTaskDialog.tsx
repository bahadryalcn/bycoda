import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { HostModelSource } from "../../connections/public/HostModelSource";
import {
  newTaskDraft,
  saveTask,
  startTask,
  type BoardTask,
  type TaskDraft,
} from "../../tasks/public/taskCreation";
import { TaskForm } from "../../tasks/public/taskCreation";
import type { useProjectCrews } from "../model/crewClient";
import { presentRemoteError } from "../../connections/public/remoteFailure";

// Each exact host/project/team owns its draft and original creation receipt.
const drafts = new Map<string, TaskDraft>();

/** Every Crew entry point creates ordinary board work through the canonical form. */
export function CrewTaskDialog({
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
  useLocale();
  const data = state.data;
  return data ? (
    <CrewTaskDraft
      key={JSON.stringify([data.machine.id, data.project.id, definitionId])}
      cwd={cwd}
      state={state}
      definitionId={definitionId}
      onClose={onClose}
    />
  ) : (
    <Modal title={t("New task")} onClose={onClose}>
      {state.visibleError ? (
        <InlineError details={state.visibleError} />
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
      executor: { kind: "crew" as const, crewDefinitionId: (definitionId ?? crew?.id)! },
      // A crew reviews its own work and does not retry on its own; the form shows anything else.
      continueUntilDone: false,
      runtimeMode: crew?.policy.runtimeMode ?? "supervised",
    };
    drafts.set(key, initial);
    return initial;
  });
  const [saving, setSaving] = useState(false);
  // Creation failures keep the form and draft; a start failure never reopens creation.
  const [error, setError] = useState<string>();
  // The confirmed task. Start retries target this identity and never create it again.
  const [receipt, setReceipt] = useState<BoardTask>();
  const [startError, setStartError] = useState<string>();
  const gate = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await work();
    } finally {
      gate.current = false;
      setSaving(false);
    }
  };
  const startReceipt = async (task: BoardTask) => {
    try {
      setReceipt(await startTask(task));
      setStartError(undefined);
      return true;
    } catch (reason) {
      setStartError(presentRemoteError(reason, { explicit: true }));
      return false;
    }
  };
  const finish = async () => {
    // The created task is already on the board; a failed list refresh is not a creation
    // failure, and the crew list polls and shows its own error state.
    await state.refetch().catch(() => undefined);
    onClose();
  };
  const save = (mode: "todo" | "queued" | "save", next: TaskDraft) =>
    run(async () => {
      drafts.set(key, next);
      let task: BoardTask;
      try {
        task = await saveTask([data.machine], next, mode === "todo" ? "todo" : "queued");
      } catch (reason) {
        setError(presentRemoteError(reason, { explicit: true }));
        return;
      }
      // Creation is confirmed: retire the draft before the separate start request.
      drafts.delete(key);
      setReceipt(task);
      if (mode === "queued" && task.workspaceControlsSupported) {
        if (await startReceipt(task)) await finish();
        return;
      }
      await finish();
    });
  const retryStart = () => {
    if (!receipt) return;
    void run(async () => {
      if (await startReceipt(receipt)) await finish();
    });
  };
  return (
    <Modal
      title={t("New task")}
      // The form no longer repeats the crew row, so the title names the crew.
      context={crew?.name}
      size="lg"
      padding="none"
      scroll="none"
      onClose={() => {
        if (!gate.current) onClose();
      }}
    >
      {error ? <InlineError details={error} className="mx-4 mt-3" /> : null}
      {receipt && startError ? (
        <Alert
          tone="warning"
          className="m-4"
          action={{ label: t("Retry"), onClick: retryStart }}
          secondaryAction={{ label: t("Close"), onClick: onClose }}
        >
          {t("Task created, but it could not be started: {p0}", { p0: startError })}
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
            // The caller named the crew, or there is only one: the form need not ask again.
            crewPreselected={!!definitionId || data.definitions.length <= 1}
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
