import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Modal } from "../../../shared/ui/Modal";
import type { RemoteMachine } from "../../connections";
import { HostModelSource } from "../../connections/public/HostModelSource";
import type { RecentProject } from "../../projects/public/recents";
import type { HostSettings } from "../model/hostSettings";
import type { MachineLimits } from "../model/settingsClient";
import { GoalForm } from "./GoalForm";
import { machineName } from "./TaskFormFields";
import type { TaskGoalsController } from "./TaskGoalsController";
import { resolveTaskMachineId } from "./useTaskTargetMachine";

/** The new-goal dialog, with the model options of the host that would run it. */
export function NewGoalDialog({
  goals,
  saving,
  error,
  recents,
  capable,
  currentSprintName,
  limits,
  onChangeLimits,
}: {
  goals: TaskGoalsController;
  saving: boolean;
  error: string | null;
  recents: RecentProject[];
  capable: RemoteMachine[];
  currentSprintName?: string;
  limits: readonly MachineLimits[];
  onChangeLimits: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  const draft = goals.draft;
  if (!draft) return null;
  return (
    <Modal
      padding="none"
      title={t("New epic")}
      context={currentSprintName ? `${t("Sprint")}: ${currentSprintName}` : undefined}
      size="lg"
      scroll="none"
      onClose={() => {
        if (!saving) goals.setDraft(null);
      }}
    >
      {error ? (
        <Alert tone="danger" className="mx-4 mt-3 shrink-0">
          {error}
        </Alert>
      ) : null}
      <HostModelSource
        machine={capable.find(
          (entry) =>
            entry.id === resolveTaskMachineId(capable, draft.cwds[0] ?? "", draft.machineId),
        )}
        cwd={draft.leadCwd || draft.cwds[0] || "~"}
        model={draft.model}
        values={draft.modelSettings}
      >
        <GoalForm
          draft={draft}
          recents={recents}
          machines={capable}
          machine={draft.cwds[0] ? machineName(capable, draft.cwds[0], draft.machineId) : undefined}
          saving={saving}
          onChange={(next) => {
            if (!saving) goals.setDraft(next);
          }}
          onCancel={() => {
            if (!saving) goals.setDraft(null);
          }}
          onSubmit={goals.create}
          limits={limits}
          onChangeLimits={onChangeLimits}
        />
      </HostModelSource>
    </Modal>
  );
}
