import { useT } from "../../../shared/i18n";
import { carryCrossDelegation } from "../../../shared/model/host-contracts/delegation";
import { TextareaField } from "../../../shared/ui/TextareaField";
import {
  isRemoteProvider,
  REMOTE_PROVIDERS,
  type RemoteMachine,
} from "../../connections/public/protocol";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import type { HarnessId } from "../../sessions/public/session";
import type { TaskDraft } from "../model/taskClient";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { TaskFormRow } from "./TaskFormFields";
import { TaskModelChoiceField } from "./TaskModelChoiceField";

type UpdateTask = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => void;

/** The worker model and its account settings, embedded in the target chip row. */
export function TaskFormAgent({
  draft,
  update,
  onChange,
  target,
  routingSupported,
  localAccounts,
  defaultAccountFor,
}: {
  draft: TaskDraft;
  update: UpdateTask;
  onChange: (draft: TaskDraft) => void;
  target?: RemoteMachine;
  routingSupported: boolean;
  localAccounts: boolean;
  defaultAccountFor: (harness: HarnessId) => string | undefined;
}) {
  return (
    <TaskModelChoiceField
      machine={target}
      routingRole="task.worker"
      value={draft.modelChoice}
      supported={routingSupported}
      onChange={(choice) => update("modelChoice", choice)}
      fixedLabel={<ModelLabel model={draft.model} harness={draft.harness} />}
      fixed={
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ModelPicker
            presentation="chip"
            harness={draft.harness}
            model={draft.model}
            values={draft.modelSettings}
            project={draft.cwd}
            accountChoices={localAccounts}
            accountId={draft.providerAccountId}
            onChange={(harness, model, accountId) =>
              onChange({
                ...draft,
                harness,
                model,
                modelChoice: routingSupported ? { kind: "fixed" } : undefined,
                modelSettings:
                  harness === draft.harness && model === draft.model
                    ? draft.modelSettings
                    : carryCrossDelegation(
                        draft.modelSettings,
                        defaultModelSettings(resolveModel(harness, model)),
                      ),
                providerAccountId: localAccounts
                  ? (accountId ?? defaultAccountFor(harness))
                  : harness === draft.harness
                    ? draft.providerAccountId
                    : defaultAccountFor(harness),
              })
            }
            onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
          />
          <TaskAccountPicker
            harness={draft.harness}
            accountId={draft.providerAccountId}
            local={localAccounts}
          />
        </div>
      }
    />
  );
}

export function TaskReviewerFields({ draft, update }: { draft: TaskDraft; update: UpdateTask }) {
  const t = useT();
  const reviewer = draft.reviewerConfig;
  const harness = reviewer?.harness ?? (isRemoteProvider(draft.harness) ? draft.harness : "codex");
  const model = reviewer?.model ?? draft.model;
  return (
    <>
      <TaskFormRow label={t("Reviewer")}>
        <ModelPicker
          presentation="chip"
          harness={harness}
          model={model}
          values={reviewer?.modelSettings ?? draft.modelSettings}
          project={draft.cwd}
          allowedHarnesses={REMOTE_PROVIDERS}
          inheritChoice={{
            label: t("Same as worker"),
            selected: !reviewer,
            onSelect: () => {
              if (reviewer) update("reviewerConfig", undefined);
            },
          }}
          onChange={(nextHarness, nextModel) => {
            if (!isRemoteProvider(nextHarness)) return;
            update("reviewerConfig", {
              harness: nextHarness,
              model: nextModel,
              modelSettings:
                reviewer?.harness === nextHarness && reviewer.model === nextModel
                  ? reviewer.modelSettings
                  : defaultModelSettings(resolveModel(nextHarness, nextModel)),
              instructions: reviewer?.instructions ?? "",
            });
          }}
          onSettingsChange={(modelSettings) => {
            if (reviewer) update("reviewerConfig", { ...reviewer, modelSettings });
          }}
        />
      </TaskFormRow>
      <TaskFormRow label={t("Reviewer instructions")}>
        <TextareaField
          label={t("Reviewer instructions")}
          hideLabel
          rows={2}
          maxLength={8000}
          disabled={!reviewer}
          placeholder={reviewer ? t("Optional") : t("Choose a reviewer model")}
          value={reviewer?.instructions ?? ""}
          onChange={(event) => {
            if (reviewer)
              update("reviewerConfig", { ...reviewer, instructions: event.target.value });
          }}
        />
      </TaskFormRow>
    </>
  );
}
