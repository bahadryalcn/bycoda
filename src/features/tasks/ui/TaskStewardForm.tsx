import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { TaskModelChoiceField, useTaskModelRouting } from "./TaskModelChoiceField";
import {
  defaultModelSettings,
  resolveModel as resolveTaskModel,
} from "../../sessions/public/models";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { FormEvent, ReactNode } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { TimePicker } from "../../../shared/ui/TimePicker";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useLocale } from "../../../shared/i18n";
import { AUTOMATION_WEEKDAYS, automationScheduleLabel } from "../../automations/public/automations";
import { projectDisplayName } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { MAX_OPEN_LIMIT, MAX_PROPOSALS_LIMIT } from "../model/hostStewards";
import type { StewardDraft } from "../model/stewardClient";
import { TASK_MACHINE_ERROR } from "../model/taskClient";
import { SettingFrame, SettingRow } from "./TaskLimitsRow";
import { AutoMergeField } from "./TaskFormFields";

function scheduleOf(draft: StewardDraft) {
  return {
    scheduleKind: draft.scheduleKind,
    minute: draft.minute,
    time: draft.time,
    dayOfWeek: draft.dayOfWeek,
  };
}

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="task-ops-section">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

/** The steward form: the project, what to look for, when to look, and the
 * agent that does it, in titled sections with one primary action. */
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
  let draft = inputDraft;
  const update = <K extends keyof StewardDraft>(key: K, value: StewardDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const { supported: routingSupported, choice } = useTaskModelRouting(
    target,
    !draft.id,
    draft.modelChoice,
  );
  if (choice !== draft.modelChoice) draft = { ...draft, modelChoice: choice };
  const valid = looksLikeProject(draft.cwd) && draft.model.length > 0 && machine != null;
  const number = (
    label: string,
    value: number,
    max: number,
    key: "maxProposals" | "maxOpen" | "minute",
    min = 1,
  ) => (
    <NumberField
      hideLabel
      label=""
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={(event) => {
        const next = Math.trunc(Number(event.target.value));
        if (Number.isFinite(next)) update(key, Math.min(max, Math.max(min, next)));
      }}
      fieldClassName="w-24 max-w-24"
    />
  );
  return (
    <form
      aria-label={draft.id ? t("Edit steward") : t("New steward")}
      aria-busy={saving}
      onSubmit={(event) => onSubmit(event, draft)}
      {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, "task-ops-form")}
    >
      <FieldGroup variant="bare" disabled={saving} inert={saving}>
        <div {...surfaceAttributes({ frame: "none" }, "task-ops-fields")}>
          <Section title={t("Project")}>
            <SettingFrame>
              <SettingRow title={t("Project")}>
                {draft.id ? (
                  // A steward stays with the project it was created for.
                  <Text
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    className="task-ops-caption"
                  >
                    {projectDisplayName(draft.cwd)}
                  </Text>
                ) : (
                  <SearchableProjectPicker
                    cwd={draft.cwd}
                    recents={recents}
                    onSelectProject={(cwd) =>
                      onChange({
                        ...draft,
                        cwd,
                        modelChoice: undefined,
                        providerAccountId: undefined,
                      })
                    }
                  />
                )}
              </SettingRow>
              <SettingRow title={t("Runs on ").trim()}>
                {machine ? (
                  <Text
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    className="task-ops-caption"
                  >
                    {machine}
                  </Text>
                ) : (
                  <InlineMessage tone="warning" live="assertive">
                    {TASK_MACHINE_ERROR}
                  </InlineMessage>
                )}
              </SettingRow>
            </SettingFrame>
          </Section>
          <Section title={t("Focus")}>
            <TextareaField
              hideLabel
              label=""
              aria-label={t("Focus")}
              value={draft.focus}
              onChange={(event) => update("focus", event.target.value)}
              placeholder={t(
                "What should it look for? e.g. follow docs/ROADMAP.md, or find bugs and missing tests",
              )}
              rows={2}
              fieldClassName="block w-full"
              className="resize-y"
            />
          </Section>
          <Section title={t("Schedule")}>
            <SettingFrame>
              <SettingRow
                title={t("Frequency")}
                description={automationScheduleLabel(scheduleOf(draft))}
              >
                <SearchableSelect
                  variant="pill"
                  searchable={false}
                  label={t("Schedule")}
                  value={draft.scheduleKind}
                  options={SCHEDULE_OPTIONS}
                  onChange={(value) =>
                    update("scheduleKind", value as StewardDraft["scheduleKind"])
                  }
                />
              </SettingRow>
              {draft.scheduleKind === "weekly" ? (
                <SettingRow title={t("Day of week")}>
                  <SearchableSelect
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
                </SettingRow>
              ) : null}
              <SettingRow title={draft.scheduleKind === "hourly" ? t("Minute") : t("Time")}>
                {draft.scheduleKind === "hourly" ? (
                  number(t("Minute"), draft.minute, 59, "minute", 0)
                ) : (
                  <TimePicker
                    hideLabel
                    description=""
                    label={t("Time")}
                    value={draft.time}
                    onChange={(value) => {
                      if (value) update("time", value);
                    }}
                  />
                )}
              </SettingRow>
            </SettingFrame>
          </Section>
          <Section title={t("Agent")}>
            <SettingFrame>
              <SettingRow title={t("Model")}>
                <TaskModelChoiceField
                  machine={target}
                  routingRole="steward"
                  value={draft.modelChoice}
                  supported={routingSupported}
                  onChange={(choice) => update("modelChoice", choice)}
                  fixed={
                    <ModelPicker
                      harness={draft.harness}
                      model={draft.model}
                      values={draft.modelSettings}
                      project={draft.cwd}
                      accountChoices={Boolean(target && isLocalSyncMachine(target))}
                      accountId={draft.providerAccountId}
                      onChange={(harness, model, providerAccountId) =>
                        onChange({
                          ...draft,
                          harness,
                          model,
                          providerAccountId:
                            target &&
                            isLocalSyncMachine(target) &&
                            supportsProviderAccounts(harness)
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
                              : defaultModelSettings(resolveTaskModel(harness, model)),
                        })
                      }
                      onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                    />
                  }
                />
              </SettingRow>
              {draft.harness !== "fx" ? (
                <SettingRow title={t("Access")}>
                  <AccessPicker
                    value={draft.runtimeMode}
                    onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
                  />
                </SettingRow>
              ) : null}
            </SettingFrame>
          </Section>
          <Section title={t("Suggestions")}>
            <SettingFrame>
              <SettingRow title={t("Max suggestions per run")}>
                {number(
                  t("Max suggestions per run"),
                  draft.maxProposals,
                  MAX_PROPOSALS_LIMIT,
                  "maxProposals",
                )}
              </SettingRow>
              <SettingRow title={t("Pause at open suggestions")}>
                {number(t("Pause at open suggestions"), draft.maxOpen, MAX_OPEN_LIMIT, "maxOpen")}
              </SettingRow>
              <Checkbox
                className="task-ops-setting cursor-pointer justify-start"
                size="body"
                label={t("Start suggestions automatically")}
                checked={draft.autoStart}
                onChange={(event) => update("autoStart", event.target.checked)}
              />
              <div className="task-ops-setting">
                <AutoMergeField
                  checked={draft.autoMerge}
                  onChange={(checked) => update("autoMerge", checked)}
                />
              </div>
            </SettingFrame>
            {draft.autoStart ? (
              <Text
                size="caption"
                tone="warning"
                leading="inherit"
                role="status"
                className="task-ops-caption"
                data-tone="warning"
              >
                {t("Suggestions will run without you reviewing the idea first.")}
                {t(" Each still waits for your review before it is merged.")}
              </Text>
            ) : null}
          </Section>
        </div>
      </FieldGroup>
      {error ? (
        <Alert tone="danger" className="mx-4 mb-3">
          {error}
        </Alert>
      ) : null}
      <div {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "task-ops-footer")}>
        <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid || saving}>
          {t("Save")}
        </Button>
      </div>
    </form>
  );
}
