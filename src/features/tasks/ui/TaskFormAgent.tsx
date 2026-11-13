import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { RemoteMachine } from "../../connections/public/protocol";
import { TaskModelChoiceField } from "./TaskModelChoiceField";
import {
  defaultModelSettings,
  resolveModel as resolveTaskModel,
} from "../../sessions/public/models";
import { Text } from "../../../shared/ui/Text";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import "./task-form.css";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t } from "../../../shared/i18n";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { resolveModel } from "../../sessions/public/models";
import type { HarnessId } from "../../sessions/public/session";
import { REMOTE_PROVIDERS, type RemoteProvider } from "../../connections/public/protocol";
import type { TaskDraft } from "../model/taskClient";
import { TaskAccountPicker } from "./TaskAccountPicker";
import {
  AutoMergeField,
  ContinueUntilDoneField,
  RUN_TIME_LIMIT_OPTIONS,
  TaskFormRow,
} from "./TaskFormFields";

/** Who does the work: model, access, time limit and review, behind one disclosure. */
export function TaskFormAgent({
  draft,
  update,
  onChange,
  open,
  onOpenChange,
  machine,
  target,
  routingSupported = false,
  projectName,
  hasProject,
  localAccounts,
  defaultAccountFor,
}: {
  draft: TaskDraft;
  update: <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => void;
  onChange: (draft: TaskDraft) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine?: string;
  target?: RemoteMachine;
  routingSupported?: boolean;
  projectName: string;
  hasProject: boolean;
  localAccounts: boolean;
  defaultAccountFor: (harness: HarnessId, machineId?: string) => string | undefined;
}) {
  return (
    <Disclosure
      variant="card"
      className="task-form-agent-disclosure"
      open={open}
      onOpenChange={onOpenChange}
      summary={
        <>
          {t("Agent settings")}
          {open ? null : (
            <Text
              truncate
              size="caption"
              tone="muted"
              leading="inherit"
              className="task-form-summary-hint"
            >
              <ModelLabel
                model={draft.model}
                harness={draft.harness}
                name={resolveModel(draft.harness, draft.model).name}
              />
            </Text>
          )}
        </>
      }
    >
      {open ? (
        <div className="task-form-agent">
          {machine && hasProject ? (
            <Text as="p" size="micro" tone="secondary" leading="inherit" className="task-form-hint">
              {t("Used when this task runs in {p0} on {p1}.", { p0: projectName, p1: machine })}
            </Text>
          ) : null}
          <div className="task-form-agent-picks">
            <TaskModelChoiceField
              machine={target}
              routingRole="task.worker"
              value={draft.modelChoice}
              supported={routingSupported}
              onChange={(choice) => update("modelChoice", choice)}
              fixed={
                <ModelPicker
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
                      modelChoice: routingSupported
                        ? (draft.modelChoice ?? { kind: "fixed" })
                        : undefined,
                      modelSettings:
                        harness === draft.harness && model === draft.model
                          ? draft.modelSettings
                          : defaultModelSettings(resolveTaskModel(harness, model)),
                      providerAccountId: localAccounts
                        ? (accountId ?? defaultAccountFor(harness))
                        : harness === draft.harness
                          ? draft.providerAccountId
                          : defaultAccountFor(harness),
                    })
                  }
                  onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                />
              }
            />
            {!routingSupported || !draft.modelChoice || draft.modelChoice.kind === "fixed" ? (
              <TaskAccountPicker
                harness={draft.harness}
                accountId={draft.providerAccountId}
                local={localAccounts}
              />
            ) : null}
            {draft.harness !== "fx" ? (
              <AccessPicker
                value={draft.runtimeMode}
                onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
              />
            ) : null}
          </div>
          <div {...surfaceAttributes({ dividers: "pane" }, "task-form-rows")}>
            <TaskFormRow label={t("Time limit")}>
              <SearchableSelect
                hideLabel
                variant="pill"
                searchable={false}
                align="end"
                label={t("Time limit")}
                value={String(draft.maxRunMinutes)}
                options={RUN_TIME_LIMIT_OPTIONS}
                onChange={(value) => update("maxRunMinutes", Number(value))}
              />
            </TaskFormRow>
            <Checkbox
              className="task-form-row task-form-check"
              size="secondary"
              tone="primary"
              leading="inherit"
              label={t("Review with a second agent")}
              checked={draft.review}
              onChange={(event) => update("review", event.target.checked)}
            />
            <AutoMergeField
              checked={draft.autoMerge && draft.isolate === true}
              disabled={!draft.isolate}
              onChange={(checked) => update("autoMerge", checked)}
            />
            <ContinueUntilDoneField
              checked={draft.continueUntilDone}
              onChange={(checked) => update("continueUntilDone", checked)}
            />
          </div>
          {draft.review ? (
            <Disclosure
              className="task-form-reviewer min-w-0"
              size="sm"
              summary={t("Reviewer profile")}
            >
              <div className="task-form-agent">
                <Checkbox
                  className="task-form-row task-form-check"
                  size="secondary"
                  tone="primary"
                  leading="inherit"
                  label={t("Use a separate reviewer profile")}
                  checked={Boolean(draft.reviewerConfig)}
                  onChange={(event) =>
                    update(
                      "reviewerConfig",
                      event.target.checked
                        ? {
                            harness: draft.harness as RemoteProvider,
                            model: draft.model,
                            modelSettings: { ...draft.modelSettings },
                            instructions: "",
                          }
                        : undefined,
                    )
                  }
                />
                {draft.reviewerConfig ? (
                  <div className="min-w-0 space-y-2">
                    <ModelPicker
                      presentation="field"
                      harness={draft.reviewerConfig.harness}
                      model={draft.reviewerConfig.model}
                      allowedHarnesses={REMOTE_PROVIDERS}
                      values={draft.reviewerConfig.modelSettings}
                      project={draft.cwd}
                      onChange={(harness, model) =>
                        update("reviewerConfig", {
                          ...draft.reviewerConfig!,
                          harness: harness as RemoteProvider,
                          model,
                          modelSettings: defaultModelSettings(resolveTaskModel(harness, model)),
                        })
                      }
                      onSettingsChange={(modelSettings) =>
                        update("reviewerConfig", { ...draft.reviewerConfig!, modelSettings })
                      }
                    />
                    <TextareaField
                      label={t("Reviewer instructions")}
                      rows={2}
                      maxLength={8000}
                      value={draft.reviewerConfig.instructions}
                      onChange={(event) =>
                        update("reviewerConfig", {
                          ...draft.reviewerConfig!,
                          instructions: event.target.value,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </Disclosure>
  );
}
