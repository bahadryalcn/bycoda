import { useId, useState } from "react";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { useModelSource } from "../../sessions/ui/modelSource";
import { AssistantHourRange, AssistantPresetNumber } from "./AssistantProfileControls";
import {
  ASSISTANT_ROLE_FIELDS,
  assistantRoleExecution,
  type AssistantExecutionRole,
} from "../../../shared/model/assistantRoles";
import type { AssistantExecution } from "../../../shared/model/host-contracts/assistant";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/model/models";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../connections/model/protocol";
import styles from "./AssistantView.module.css";
import roleStyles from "./AssistantProfileFields.module.css";
import { assistantPolicy, validAssistantPolicy } from "../../../shared/model/assistantPolicy";
import {
  workerContextSettings,
  validWorkerContextSettings,
} from "../../../shared/model/assistantContext";
import { InlineError } from "../../../shared/ui/InlineError";

export type ProfileSection =
  | "identity"
  | "language"
  | "behavior"
  | "autonomy"
  | "presence"
  | "cost";
export function AssistantProfileFields({
  section,
  value,
  onChange,
}: {
  section: ProfileSection;
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const [advancedRoles, setAdvancedRoles] = useState(false);
  const [advancedWorkerContext, setAdvancedWorkerContext] = useState(false);
  const [workerModelError, setWorkerModelError] = useState("");
  const rolesId = useId();
  const workerContextId = useId();
  const workerContext = workerContextSettings(value);
  const policy = assistantPolicy(value);
  const modelSource = useModelSource();
  function changeModel(
    existing: AssistantExecution | null | undefined,
    harness: AssistantExecution["harness"],
    model: string,
  ): AssistantExecution {
    return {
      harness,
      model,
      modelSettings:
        existing?.harness === harness && existing.model === model
          ? { ...existing.modelSettings }
          : defaultModelSettings(resolveModel(harness, model)),
      runtimeMode: existing?.runtimeMode ?? value.execution?.runtimeMode ?? "supervised",
      maxRunMinutes: existing?.maxRunMinutes ?? value.execution?.maxRunMinutes ?? 60,
    };
  }
  function settingsExecution(
    existing: AssistantExecution | null | undefined,
    modelSettings: Record<string, string>,
  ) {
    if (existing?.model.trim()) {
      setWorkerModelError("");
      return { ...existing, modelSettings: { ...existing.modelSettings, ...modelSettings } };
    }
    const harness = existing?.harness ?? "codex";
    const resolved = modelSource.resolve(harness, existing?.model ?? "");
    if (
      !isRemoteProvider(resolved.harness) ||
      resolved.harness !== harness ||
      !resolved.id.trim() ||
      !modelSource.available(resolved.harness) ||
      !modelSource
        .modelsFor(resolved.harness)
        .some((model) => model.harness === resolved.harness && model.id === resolved.id)
    ) {
      setWorkerModelError(t("Choose an available model before changing its settings."));
      return null;
    }
    setWorkerModelError("");
    return {
      ...changeModel(existing, resolved.harness, resolved.id),
      modelSettings: {
        ...defaultModelSettings(resolved),
        ...existing?.modelSettings,
        ...modelSettings,
      },
    };
  }
  function rolePicker(role: AssistantExecutionRole, label: string) {
    const field = ASSISTANT_ROLE_FIELDS[role],
      selected = value[field],
      effective = assistantRoleExecution(value, role);
    return (
      <fieldset className={styles.modelField} key={role}>
        <legend>{t(label)}</legend>
        <ModelPicker
          harness={effective?.harness ?? "codex"}
          model={effective?.model ?? ""}
          values={effective?.modelSettings ?? {}}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          inheritChoice={{
            label: t("Use worker model"),
            selected: !selected,
            onSelect: () => onChange({ [field]: null }),
          }}
          onChange={(harness, model) => {
            if (isRemoteProvider(harness)) {
              setWorkerModelError("");
              onChange({ [field]: changeModel(effective, harness, model) });
            }
          }}
          onSettingsChange={(modelSettings) => {
            const selected = settingsExecution(effective, modelSettings);
            if (selected) onChange({ [field]: selected });
          }}
        />
      </fieldset>
    );
  }
  const choice = (
    key: keyof AssistantProfilePatch,
    label: string,
    options: readonly (readonly [string, string])[],
    fallback = "",
  ) => (
    <Select
      visibleLabel
      label={t(label)}
      value={String(value[key] ?? fallback)}
      options={options.map(([value, label]) => ({ value, label: t(label) }))}
      onValueChange={(next) => {
        if (key === "autonomy") {
          if ((next === "jobs" || next === "chief") && !value.execution) {
            const resolved = modelSource.resolve("codex", "");
            if (
              resolved.harness !== "codex" ||
              !resolved.id.trim() ||
              !modelSource.available(resolved.harness) ||
              !modelSource
                .modelsFor(resolved.harness)
                .some((model) => model.harness === resolved.harness && model.id === resolved.id)
            ) {
              setWorkerModelError(t("Choose a worker model before enabling job execution."));
              return;
            }
            setWorkerModelError("");
            onChange({
              autonomy: next,
              execution: {
                harness: resolved.harness,
                model: resolved.id,
                modelSettings: defaultModelSettings(resolved),
                runtimeMode: "supervised",
                maxRunMinutes: 60,
              },
            });
            return;
          }
          setWorkerModelError("");
        }
        onChange({ [key]: next });
      }}
    />
  );
  const number = (
    key: keyof AssistantProfilePatch,
    label: string,
    min: number,
    max: number,
    fallback?: number,
  ) => (
    <NumericDraft
      label={t(label)}
      value={value[key] ?? fallback}
      min={min}
      max={max}
      onChange={(next) => onChange({ [key]: next })}
    />
  );
  return (
    <div className={`${styles.fields} ${roleStyles.fields}`}>
      {section === "identity" && (
        <>
          <TextField
            label={t("Name")}
            value={value.name ?? ""}
            maxLength={80}
            autoComplete="off"
            required
            onChange={(event) => onChange({ name: event.currentTarget.value })}
          />
          <TextField
            label={t("How should I address you?")}
            value={value.addressAs ?? ""}
            maxLength={100}
            onChange={(event) => onChange({ addressAs: event.currentTarget.value })}
          />
          <TextField
            label={t("Avatar")}
            value={value.avatar ?? ""}
            maxLength={200}
            placeholder={t("Emoji or initials")}
            onChange={(event) => onChange({ avatar: event.currentTarget.value })}
          />
          <div className={roleStyles.inlineControls}>
            <Switch
              label={t("Show title")}
              checked={value.showTitle ?? true}
              onCheckedChange={(showTitle) => onChange({ showTitle })}
            />
            {value.name?.trim() && (
              <InfoPopover label={t("Preview")}>
                {" "}
                <p className={styles.muted}>
                  {value.showTitle
                    ? t("Assistant {p0}", { p0: value.name.trim() })
                    : value.name.trim()}{" "}
                  · {t("Room · {p0}", { p0: value.name.trim() })} ·{" "}
                  {t("{p0} wrote", { p0: value.name.trim() })}
                </p>
              </InfoPopover>
            )}
          </div>
        </>
      )}
      {section === "language" && (
        <div className={roleStyles.inlineField}>
          {choice("language", "Language", [
            ["auto", "Auto"],
            ["tr-TR", "Türkçe"],
            ["en-US", "English"],
            ["de-DE", "Deutsch"],
            ["fr-FR", "Français"],
            ["es-ES", "Español"],
            ["pt-PT", "Português"],
            ["zh-CN", "简体中文"],
            ["ja-JP", "日本語"],
          ])}

          <InfoPopover label={t("About language")}>
            <p className={styles.muted}>
              {t("Auto follows the language you speak. A selected language overrides it.")}
            </p>
          </InfoPopover>
        </div>
      )}
      {section === "autonomy" && (
        <>
          {choice("autonomy", "Autonomy", [
            ["report", "Report only"],
            ["jobs", "Run jobs"],
            ["chief", "Supervise assigned jobs"],
          ])}
          {workerModelError && (
            <InlineError className={styles.error}>{workerModelError}</InlineError>
          )}

          {choice("planApproval", "Plan approval", [
            ["always", "Always"],
            ["large", "Big jobs only"],
            ["never", "Never"],
          ])}

          <Switch
            label={t("Answer routine worker questions")}
            checked={value.allowRoutineQuestions ?? false}
            onCheckedChange={(allowRoutineQuestions) => onChange({ allowRoutineQuestions })}
          />

          <AssistantPresetNumber
            label={t("Daily token budget")}
            value={value.dailyTokenBudget}
            min={1}
            max={1_000_000_000}
            unit={t("tokens/day")}
            presets={[
              { value: 100_000, label: `100k ${t("tokens/day")}` },
              { value: 500_000, label: `500k ${t("tokens/day")}` },
              { value: 1_000_000, label: `1m ${t("tokens/day")}` },
              { value: 5_000_000, label: `5m ${t("tokens/day")}` },
            ]}
            onChange={(dailyTokenBudget) => onChange({ dailyTokenBudget })}
          />
          <fieldset className={styles.modelField}>
            <legend>{t("Worker model")}</legend>
            <ModelPicker
              harness={value.execution?.harness ?? "codex"}
              model={value.execution?.model ?? ""}
              values={value.execution?.modelSettings ?? {}}
              allowedHarnesses={REMOTE_PROVIDERS}
              presentation="field"
              showExtras
              onChange={(harness, model) => {
                if (isRemoteProvider(harness)) {
                  setWorkerModelError("");
                  onChange({
                    execution: changeModel(value.execution, harness, model),
                  });
                }
              }}
              onSettingsChange={(modelSettings) => {
                const execution = settingsExecution(value.execution, modelSettings);
                if (execution) onChange({ execution });
              }}
            />
          </fieldset>
          {value.execution && (
            <Select
              label={t("Execution permissions")}
              visibleLabel
              value={value.execution.runtimeMode}
              options={[
                ["supervised", "Supervised"],
                ["auto-accept-edits", "Accept edits"],
                ["auto", "Automatic"],
                ["full-access", "Full access"],
              ].map(([value, label]) => ({ value, label: t(label) }))}
              onValueChange={(runtimeMode) =>
                onChange({
                  execution: {
                    ...value.execution!,
                    runtimeMode: runtimeMode as
                      | "supervised"
                      | "auto-accept-edits"
                      | "auto"
                      | "full-access",
                  },
                })
              }
            />
          )}
          <p className={styles.muted}>
            {t("Command approvals, publishing and credentials still require your authorization.")}
          </p>
          <div className={roleStyles.roleSection}>
            <div className={roleStyles.roleToggle}>
              <Button
                aria-expanded={advancedRoles}
                aria-controls={rolesId}
                onClick={() => setAdvancedRoles((current) => !current)}
              >
                {t("Advanced role models")}
              </Button>
              <InfoPopover label={t("About autonomy")}>
                <p className={styles.muted}>
                  {t(
                    "Run jobs starts and tracks assigned work. Supervision also reviews, replans and nudges its workers; manual conversations and independent reviews keep their existing owners.",
                  )}
                </p>
                <p className={styles.muted}>
                  {t(
                    "Big jobs need approval when the plan has four or more tasks or spans multiple projects.",
                  )}
                </p>
                <p className={styles.muted}>
                  {t(
                    "Allow Chief to answer clarifying questions from its assigned workers within the current task. Permissions, publication, credentials and destructive requests still require you.",
                  )}
                </p>
                <p className={styles.muted}>
                  {t(
                    "Optional roles use the worker model unless you choose another. Model changes apply to new turns and new jobs; running work keeps its original model.",
                  )}
                </p>
                <p className={styles.muted}>
                  {t(
                    "Supervisor and conversation turns stay read-only. The planning model writes the goal plan; workers and independent reviews keep their existing model and permissions. Heartbeats and briefings do not call a model.",
                  )}
                </p>
              </InfoPopover>
            </div>
            {advancedRoles && (
              <div id={rolesId} className={styles.fields}>
                {rolePicker("chief", "Supervisor model")}
                {rolePicker("reply", "Conversation model")}
                {rolePicker("planning", "Planning model")}
              </div>
            )}
          </div>
        </>
      )}
      {section === "behavior" && (
        <>
          {choice("proactiveSpeech", "Start a conversation", [
            ["never", "Never"],
            ["return", "Only when I return"],
            ["important", "Also for important events"],
          ])}
          <p className={styles.muted}>{t("The microphone opens only when you choose to talk.")}</p>
        </>
      )}
      {section === "presence" && (
        <>
          <AssistantPresetNumber
            label={t("Become idle after (minutes)")}
            value={value.idleMinutes ?? policy.idleMinutes}
            min={1}
            max={1440}
            unit={t("minutes")}
            presets={[5, 10, 15, 30, 60].map((value) => ({
              value,
              label: t("{p0} minutes", { p0: value }),
            }))}
            onChange={(idleMinutes) => onChange({ idleMinutes })}
          />
          <AssistantPresetNumber
            label={t("Become away after (minutes)")}
            value={value.awayMinutes ?? policy.awayMinutes}
            min={2}
            max={10080}
            unit={t("minutes")}
            presets={[15, 30, 60, 120, 240].map((value) => ({
              value,
              label: t("{p0} minutes", { p0: value }),
            }))}
            onChange={(awayMinutes) => onChange({ awayMinutes })}
          />
          {!validAssistantPolicy(value) && (
            <InlineError className={styles.error}>
              {t("Away must start later than idle.")}
            </InlineError>
          )}
          <div className={roleStyles.schedulePair}>
            <AssistantHourRange
              kind="work"
              start={policy.activeStart}
              end={policy.activeEnd}
              onChange={(activeStart, activeEnd) => onChange({ activeStart, activeEnd })}
            />
            <AssistantHourRange
              kind="quiet"
              start={value.quietStart ?? 22}
              end={value.quietEnd ?? 8}
              onChange={(quietStart, quietEnd) => onChange({ quietStart, quietEnd })}
            />
          </div>

          {choice(
            "notificationPresent",
            "Notifications when present",
            [
              ["all", "All updates"],
              ["urgent", "Urgent only"],
              ["none", "None"],
            ],
            policy.notificationPresent,
          )}
          {choice(
            "notificationAway",
            "Notifications when away",
            [
              ["all", "All updates"],
              ["urgent", "Urgent only"],
              ["none", "None"],
            ],
            policy.notificationAway,
          )}

          <div className={roleStyles.inlineControls}>
            <Switch
              label={t("Keep this computer awake while jobs are running")}
              checked={value.keepAwakeWhileWorking ?? false}
              onCheckedChange={(keepAwakeWhileWorking) => onChange({ keepAwakeWhileWorking })}
            />
            <InfoPopover label={t("About availability")}>
              <p className={styles.muted}>
                {t(
                  "Matching work hours allow work all day. Outside these hours, accepted turns can finish; new work waits.",
                )}
              </p>
              <p className={styles.muted}>
                {t("Do not disturb and quiet hours hold notifications for your next briefing.")}
              </p>
              <p className={styles.muted}>
                {t(
                  "Prevents sleep only while this Host is supervising active jobs. Locking the screen still protects your desktop.",
                )}
              </p>
              <p className={styles.muted}>{t("Work tracking continues while voice is off.")}</p>
            </InfoPopover>
          </div>

          <AssistantPresetNumber
            label={t("Stall timeout (minutes)")}
            value={value.stallMinutes ?? 15}
            min={5}
            max={1440}
            unit={t("minutes")}
            presets={[5, 15, 30, 60, 120].map((value) => ({
              value,
              label: t("{p0} minutes", { p0: value }),
            }))}
            onChange={(stallMinutes) => onChange({ stallMinutes })}
          />
        </>
      )}
      {section === "cost" && (
        <>
          <p className={styles.muted}>
            {t("Local scheduling limits, not a provider billing cap.")}
          </p>
          {number("chiefWakeLimit", "Supervisor reviews per hour", 1, 120, policy.chiefWakeLimit)}
          {number("nudgeLimit", "Follow-ups before worker recovery", 0, 2, policy.nudgeLimit)}
          {number(
            "summaryRefreshMessages",
            "Conversation summary interval (messages)",
            10,
            200,
            20,
          )}

          {number("perWakeTokenCap", "Token reservation per review", 1000, 1_000_000)}

          {number("chiefSoftContext", "Compact context at", 10_000, 1_000_000)}
          {number("chiefHardContext", "Renew context at", 20_000, 2_000_000)}

          <div className={roleStyles.actions}>
            <Button
              aria-expanded={advancedWorkerContext}
              aria-controls={workerContextId}
              onClick={() => setAdvancedWorkerContext((current) => !current)}
            >
              {t("Advanced worker context limits")}
            </Button>
            <InfoPopover label={t("About cost and context")}>
              <p className={styles.muted}>
                {t(
                  "Zero disables follow-ups and automatic recovery. Manual conversations always wait for you after their limit.",
                )}
              </p>
              <p className={styles.muted}>
                {t(
                  "Reservations guide local scheduling. Provider charges are not capped when usage or output limits are unavailable.",
                )}
              </p>
              <p className={styles.muted}>
                {t(
                  "Claude utility requests include an output token allowance. Codex uses a local text limit because its integration cannot set an output token limit. These are not total billing caps.",
                )}
              </p>
              <p className={styles.muted}>
                {t(
                  "These limits estimate retained text. Summaries, daily renewal, review reservations and a 1 MB safety limit can shorten it earlier. They do not guarantee the provider's context window or charges.",
                )}
              </p>
              <p className={styles.muted}>
                {t(
                  "Messages to workers also use the worker's context. Unknown usage is not counted as zero.",
                )}
              </p>
              <p className={styles.muted}>
                {t(
                  "Worker limits use the first threshold reached: token count or percentage of the provider context window.",
                )}
              </p>
            </InfoPopover>
          </div>
          {advancedWorkerContext && (
            <div id={workerContextId} className={`${styles.fields} ${roleStyles.roleSection}`}>
              {number(
                "workerSoftContext",
                "Compact worker context at (tokens)",
                10000,
                999999,
                workerContext.workerSoftContext,
              )}
              {number(
                "workerHardContext",
                "Continue workers in a fresh session at (tokens)",
                10001,
                1000000,
                workerContext.workerHardContext,
              )}
              {number(
                "workerCompactPercent",
                "Compact worker context at (%)",
                1,
                98,
                workerContext.workerCompactPercent,
              )}
              {number(
                "workerHandoffPercent",
                "Continue workers in a fresh session at (%)",
                2,
                99,
                workerContext.workerHandoffPercent,
              )}
            </div>
          )}
          {!validWorkerContextSettings(value) && (
            <InlineError>
              {t("Worker context limits must increase from compact to handoff.")}
            </InlineError>
          )}
        </>
      )}
    </div>
  );
}

function NumericDraft({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: unknown;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [raw, setRaw] = useState(String(value ?? ""));
  return (
    <NumberField
      label={label}
      value={raw}
      min={min}
      max={max}
      step={1}
      steppers={false}
      required
      onChange={(event) => {
        const text = event.currentTarget.value;
        setRaw(text);
        onChange(text.trim() ? Number(text) : Number.NaN);
      }}
    />
  );
}
