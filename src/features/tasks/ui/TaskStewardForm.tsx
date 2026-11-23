import { useId, type FormEvent } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TimePicker } from "../../../shared/ui/TimePicker";
import { AUTOMATION_WEEKDAYS } from "../../automations/public/automations";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import {
  DEFAULT_MAX_OPEN,
  DEFAULT_MAX_PROPOSALS,
  MAX_OPEN_LIMIT,
  MAX_PROPOSALS_LIMIT,
} from "../model/hostStewards";
import type { StewardDraft } from "../model/stewardClient";
import { taskClientErrors } from "../model/taskClientErrors";
import { TaskMoreOptions } from "./GoalFormParts";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { TaskFormRow, TaskFormSwitch } from "./TaskFormFields";
import { TaskModelChoiceField, useTaskModelRouting } from "./TaskModelChoiceField";
import { TaskTargetChips } from "./TaskTargetChips";

const SCHEDULE_OPTIONS = [
  {
    value: "hourly",
    get label() {
      return t("Hourly");
    },
  },
  {
    value: "daily",
    get label() {
      return t("Daily");
    },
  },
  {
    value: "weekdays",
    get label() {
      return t("Weekdays");
    },
  },
  {
    value: "weekly",
    get label() {
      return t("Weekly");
    },
  },
] as const;

/** Creates or edits a scheduled steward while keeping its project and save identity. */
export function StewardForm({
  draft: inputDraft,
  recents,
  machine,
  target,
  saving,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: StewardDraft;
  recents: RecentProject[];
  machine?: string;
  target?: RemoteMachine;
  saving: boolean;
  error: string | null;
  onChange: (draft: StewardDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent, draft: StewardDraft) => void;
}) {
  useLocale();
  const projectLabels = useProjectLabels();
  const format = useFormat();
  const formId = useId();
  const { supported: routingSupported, choice } = useTaskModelRouting(
    target,
    !inputDraft.id,
    inputDraft.modelChoice,
  );
  const draft =
    choice === inputDraft.modelChoice ? inputDraft : { ...inputDraft, modelChoice: choice };
  const update = <K extends keyof StewardDraft>(key: K, value: StewardDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const localAccounts = Boolean(target && isLocalSyncMachine(target));
  const title = draft.id ? t("Edit steward") : t("New steward");
  const reason = !looksLikeProject(draft.cwd)
    ? t("Choose project")
    : !machine
      ? taskClientErrors.machine()
      : !draft.model.length
        ? taskClientErrors.agent()
        : undefined;
  const number = (
    label: string,
    key: "maxProposals" | "maxOpen" | "minute",
    max: number,
    min = 1,
  ) => (
    <NumberField
      hideLabel
      label={label}
      fieldVariant="compact"
      fieldClassName="w-24"
      min={min}
      max={max}
      value={draft[key]}
      onChange={(event) => {
        const next = Math.trunc(Number(event.currentTarget.value));
        if (Number.isFinite(next)) update(key, Math.min(max, Math.max(min, next)));
      }}
    />
  );

  return (
    <form
      id={formId}
      aria-label={title}
      aria-busy={saving}
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason && !saving) onSubmit(event, draft);
      }}
    >
      <div className="task-form-body">
        <FieldGroup variant="bare" disabled={saving} inert={saving}>
          <div className="task-form-fields">
            <div className="task-target-chips">
              {!draft.id ? (
                <SearchableProjectPicker
                  appearance="filled"
                  disabled={saving}
                  cwd={draft.cwd}
                  recents={recents}
                  onSelectProject={(cwd) => {
                    if (cwd === draft.cwd) return;
                    onChange({
                      ...draft,
                      cwd,
                      // Another project is another create intent.
                      creationId: crypto.randomUUID(),
                      modelChoice: undefined,
                      providerAccountId: undefined,
                    });
                  }}
                />
              ) : null}
              <TaskTargetChips
                project={
                  draft.id
                    ? {
                        value: draft.cwd,
                        options: [],
                        currentLabel: projectDisplayNameFrom(draft.cwd, projectLabels),
                      }
                    : undefined
                }
                model={
                  <TaskModelChoiceField
                    machine={target}
                    routingRole="steward"
                    value={draft.modelChoice}
                    supported={routingSupported}
                    onChange={(choice) => update("modelChoice", choice)}
                    fixedLabel={<ModelLabel harness={draft.harness} model={draft.model} />}
                    fixed={
                      <ModelPicker
                        presentation="chip"
                        harness={draft.harness}
                        model={draft.model}
                        values={draft.modelSettings}
                        project={draft.cwd}
                        accountChoices={localAccounts}
                        accountId={draft.providerAccountId}
                        onChange={(harness, model, providerAccountId) =>
                          onChange({
                            ...draft,
                            harness,
                            model,
                            providerAccountId:
                              localAccounts && supportsProviderAccounts(harness)
                                ? (providerAccountId ?? defaultProviderAccountId(harness))
                                : harness === draft.harness
                                  ? draft.providerAccountId
                                  : undefined,
                            modelChoice: routingSupported
                              ? (draft.modelChoice ?? { kind: "fixed" })
                              : undefined,
                            modelSettings:
                              harness === draft.harness && model === draft.model
                                ? draft.modelSettings
                                : defaultModelSettings(resolveModel(harness, model)),
                          })
                        }
                        onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                      />
                    }
                  />
                }
                access={
                  draft.harness !== "fx" ? (
                    <AccessPicker
                      value={draft.runtimeMode}
                      onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
                    />
                  ) : null
                }
              />
            </div>
            {!routingSupported || !draft.modelChoice || draft.modelChoice.kind === "fixed" ? (
              <TaskAccountPicker
                harness={draft.harness}
                accountId={draft.providerAccountId}
                local={localAccounts}
              />
            ) : null}
            <TextareaField
              label={t("Focus")}
              value={draft.focus}
              onChange={(event) => update("focus", event.target.value)}
              placeholder={t(
                "What should it look for? e.g. follow docs/ROADMAP.md, or find bugs and missing tests",
              )}
              rows={2}
              fieldClassName="w-full"
            />

            <section className="task-ops-section">
              <SectionLabel>{t("Schedule")}</SectionLabel>
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormRow label={t("Frequency")}>
                  <SearchableSelect
                    hideLabel
                    variant="pill"
                    searchable={false}
                    label={t("Schedule")}
                    value={draft.scheduleKind}
                    options={SCHEDULE_OPTIONS}
                    onChange={(value) =>
                      update("scheduleKind", value as StewardDraft["scheduleKind"])
                    }
                  />
                </TaskFormRow>
                {draft.scheduleKind === "weekly" ? (
                  <TaskFormRow label={t("Day of week")}>
                    <SearchableSelect
                      hideLabel
                      variant="pill"
                      searchable={false}
                      label={t("Day of week")}
                      value={String(draft.dayOfWeek)}
                      options={AUTOMATION_WEEKDAYS.map((day, index) => ({
                        value: String(index),
                        label: day,
                      }))}
                      onChange={(value) => update("dayOfWeek", Number(value))}
                    />
                  </TaskFormRow>
                ) : null}
                {draft.scheduleKind === "hourly" ? (
                  <TaskFormRow label={t("Minute")}>
                    {number(t("Minute"), "minute", 59, 0)}
                  </TaskFormRow>
                ) : (
                  <TaskFormRow label={t("Time")}>
                    <TimePicker
                      hideLabel
                      label={t("Time")}
                      value={draft.time}
                      onChange={(value) => {
                        if (value) update("time", value);
                      }}
                    />
                  </TaskFormRow>
                )}
              </Surface>
            </section>

            <section className="task-ops-section">
              <SectionLabel>{t("Suggestions")}</SectionLabel>
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormSwitch
                  label={t("Start suggestions automatically")}
                  checked={draft.autoStart}
                  onChange={(checked) => update("autoStart", checked)}
                />
                {draft.autoStart ? (
                  <InlineMessage tone="warning">
                    {t(
                      "Suggestions will run without you reviewing the idea first. Each still waits for your review before it is merged.",
                    )}
                  </InlineMessage>
                ) : null}
              </Surface>
            </section>

            <TaskMoreOptions
              summary={[
                draft.maxProposals !== DEFAULT_MAX_PROPOSALS &&
                  t(
                    draft.maxProposals === 1
                      ? "{p0} suggestion per run"
                      : "{p0} suggestions per run",
                    {
                      p0: format.formatNumber(draft.maxProposals),
                    },
                  ),
                draft.maxOpen !== DEFAULT_MAX_OPEN &&
                  t(
                    draft.maxOpen === 1
                      ? "Pause at {p0} open suggestion"
                      : "Pause at {p0} open suggestions",
                    {
                      p0: format.formatNumber(draft.maxOpen),
                    },
                  ),
              ]}
            >
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormRow label={t("Max suggestions per run")}>
                  {number(t("Max suggestions per run"), "maxProposals", MAX_PROPOSALS_LIMIT)}
                </TaskFormRow>
                <TaskFormRow label={t("Pause at open suggestions")}>
                  {number(t("Pause at open suggestions"), "maxOpen", MAX_OPEN_LIMIT)}
                </TaskFormRow>
              </Surface>
            </TaskMoreOptions>
          </div>
        </FieldGroup>
        {error ? <InlineError className="mt-3">{error}</InlineError> : null}
      </div>
      <ModalFooter>
        <ModalActions reason={!saving && !error ? reason : undefined}>
          <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={saving}
            disabled={Boolean(reason) || saving}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      </ModalFooter>
    </form>
  );
}
