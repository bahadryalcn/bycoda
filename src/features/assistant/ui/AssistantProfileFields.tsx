import { useId, useState } from "react";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";
import {
  ASSISTANT_ROLE_FIELDS,
  assistantRoleExecution,
  type AssistantExecutionRole,
} from "../../../shared/model/assistantRoles";
import type { AssistantExecution } from "../../../shared/model/host-contracts/assistant";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import {
  defaultModelSettings,
  resolveModel,
} from "../../sessions/model/models";
import {
  isRemoteProvider,
  REMOTE_PROVIDERS,
} from "../../connections/model/protocol";
import styles from "./AssistantView.module.css";
import roleStyles from "./AssistantProfileFields.module.css";
import {assistantPolicy,validAssistantPolicy} from "../../../shared/model/assistantPolicy";
import {
  workerContextSettings,
  validWorkerContextSettings,
} from "../../../shared/model/assistantContext";

export type ProfileSection =
  "identity" | "language" | "behavior" | "autonomy" | "presence" | "cost";
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
  const rolesId = useId();
  const workerContextId = useId();
  const workerContext = workerContextSettings(value);
  const policy=assistantPolicy(value);
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
      runtimeMode:
        existing?.runtimeMode ?? value.execution?.runtimeMode ?? "supervised",
      maxRunMinutes:
        existing?.maxRunMinutes ?? value.execution?.maxRunMinutes ?? 60,
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
            if (isRemoteProvider(harness))
              onChange({ [field]: changeModel(effective, harness, model) });
          }}
          onSettingsChange={(modelSettings) => {
            if (effective)
              onChange({ [field]: { ...effective, modelSettings } });
          }}
        />
      </fieldset>
    );
  }
  const choice = (
    key: keyof AssistantProfilePatch,
    label: string,
    options: readonly (readonly [string, string])[],
    fallback="",
  ) => (
    <Select
      visibleLabel
      label={t(label)}
      value={String(value[key] ?? fallback)}
      options={options.map(([value, label]) => ({ value, label: t(label) }))}
      onValueChange={(next) => onChange({ [key]: next })}
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
    <div className={styles.fields}>
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
            onChange={(event) =>
              onChange({ addressAs: event.currentTarget.value })
            }
          />
          <TextField
            label={t("Avatar")}
            value={value.avatar ?? ""}
            maxLength={200}
            placeholder={t("Emoji or initials")}
            onChange={(event) =>
              onChange({ avatar: event.currentTarget.value })
            }
          />
          <Switch
            label={t("Show title")}
            checked={value.showTitle ?? true}
            onCheckedChange={(showTitle) => onChange({ showTitle })}
          />
          {value.name?.trim() && (
            <p className={styles.muted}>
              {value.showTitle
                ? t("Assistant {p0}", { p0: value.name.trim() })
                : value.name.trim()}{" "}
              · {t("Room · {p0}", { p0: value.name.trim() })} ·{" "}
              {t("{p0} wrote", { p0: value.name.trim() })}
            </p>
          )}
        </>
      )}
      {section === "language" && (
        <>
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
          <p className={styles.muted}>
            {t(
              "Auto follows the language you speak. A selected language overrides it.",
            )}
          </p>
        </>
      )}
      {section === "autonomy" && (
        <>
          {choice("autonomy", "Autonomy", [
            ["report", "Report only"],
            ["jobs", "Run jobs"],
            ["chief", "Supervise assigned jobs"],
          ])}
          <p className={styles.muted}>
            {t(
              "Run jobs starts and tracks assigned work. Supervision also reviews, replans and nudges its workers; manual conversations and independent reviews keep their existing owners.",
            )}
          </p>
          {choice("planApproval", "Plan approval", [
            ["always", "Always"],
            ["large", "Big jobs only"],
            ["never", "Never"],
          ])}
          <p className={styles.muted}>
            {t(
              "Big jobs need approval when the plan has four or more tasks or spans multiple projects.",
            )}
          </p>
          <Switch
            label={t("Answer routine worker questions")}
            checked={value.allowRoutineQuestions ?? false}
            onCheckedChange={(allowRoutineQuestions) =>
              onChange({ allowRoutineQuestions })
            }
          />
          <p className={styles.muted}>
            {t(
              "Allow Chief to answer clarifying questions from its assigned workers within the current task. Permissions, publication, credentials and destructive requests still require you.",
            )}
          </p>
          {number("dailyTokenBudget", "Daily token budget", 1, 1_000_000_000)}
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
                if (isRemoteProvider(harness))
                  onChange({
                    execution: changeModel(value.execution, harness, model),
                  });
              }}
              onSettingsChange={(modelSettings) => {
                if (value.execution)
                  onChange({
                    execution: { ...value.execution, modelSettings },
                  });
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
            {t(
              "Command approvals, publishing and credentials still require your authorization.",
            )}
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
            </div>
            {advancedRoles && (
              <div id={rolesId} className={styles.fields}>
                <p className={styles.muted}>
                  {t(
                    "Optional roles use the worker model unless you choose another. Model changes apply to new turns and new jobs; running work keeps its original model.",
                  )}
                </p>
                {rolePicker("chief", "Supervisor model")}
                {rolePicker("reply", "Conversation model")}
                {rolePicker("planning", "Planning model")}
                <p className={styles.muted}>
                  {t(
                    "Supervisor and conversation turns stay read-only. The planning model writes the goal plan; workers and independent reviews keep their existing model and permissions. Heartbeats and briefings do not call a model.",
                  )}
                </p>
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
          <p className={styles.muted}>
            {t("The microphone opens only when you choose to talk.")}
          </p>
        </>
      )}
      {section === "presence" && (
        <>
          {number("idleMinutes","Become idle after (minutes)",1,1440,policy.idleMinutes)}
          {number("awayMinutes","Become away after (minutes)",2,10080,policy.awayMinutes)}
          {!validAssistantPolicy(value)&&<p role="alert" className={styles.error}>{t("Away must start later than idle.")}</p>}
          {number("activeStart","Work hours start",0,23,policy.activeStart)}
          {number("activeEnd","Work hours end",0,23,policy.activeEnd)}
          <p className={styles.muted}>{t("Matching work hours allow work all day. Outside these hours, accepted turns can finish; new work waits.")}</p>
          {choice("notificationPresent","Notifications when present",[["all","All updates"],["urgent","Urgent only"],["none","None"]],policy.notificationPresent)}
          {choice("notificationAway","Notifications when away",[["all","All updates"],["urgent","Urgent only"],["none","None"]],policy.notificationAway)}
          <p className={styles.muted}>{t("Do not disturb and quiet hours hold notifications for your next briefing.")}</p>
          <Switch
            label={t("Keep this computer awake while jobs are running")}
            checked={value.keepAwakeWhileWorking ?? false}
            onCheckedChange={(keepAwakeWhileWorking) =>
              onChange({ keepAwakeWhileWorking })
            }
          />
          <p className={styles.muted}>
            {t(
              "Prevents sleep only while this Host is supervising active jobs. Locking the screen still protects your desktop.",
            )}
          </p>
          {number("quietStart", "Quiet hours start", 0, 23)}
          {number("quietEnd", "Quiet hours end", 0, 23)}
          {number("stallMinutes", "Stall timeout (minutes)", 5, 1440)}
          <p className={styles.muted}>
            {t("Work tracking continues while voice is off.")}
          </p>
        </>
      )}
      {section === "cost" && (
        <>
          {number("chiefWakeLimit","Supervisor reviews per hour",1,120,policy.chiefWakeLimit)}
          {number("nudgeLimit","Follow-ups before worker recovery",0,2,policy.nudgeLimit)}
          {number("summaryRefreshMessages","Conversation summary interval (messages)",10,200,20)}
          <p className={styles.muted}>{t("Zero disables follow-ups and automatic recovery. Manual conversations always wait for you after their limit.")}</p>
          {number(
            "perWakeTokenCap",
            "Token reservation per review",
            1000,
            1_000_000,
          )}
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
          {number("chiefSoftContext", "Compact context at", 10_000, 1_000_000)}
          {number("chiefHardContext", "Renew context at", 20_000, 2_000_000)}
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
          <Button
            aria-expanded={advancedWorkerContext}
            aria-controls={workerContextId}
            onClick={() => setAdvancedWorkerContext((current) => !current)}
          >
            {t("Advanced worker context limits")}
          </Button>
          {advancedWorkerContext && (
            <div
              id={workerContextId}
              className={`${styles.fields} ${roleStyles.roleSection}`}
            >
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
              <p className={styles.muted}>
                {t(
                  "Worker limits use the first threshold reached: token count or percentage of the provider context window.",
                )}
              </p>
            </div>
          )}
          {!validWorkerContextSettings(value) && (
            <p role="alert">
              {t(
                "Worker context limits must increase from compact to handoff.",
              )}
            </p>
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
      required
      onChange={(event) => {
        const text = event.currentTarget.value;
        setRaw(text);
        onChange(text.trim() ? Number(text) : Number.NaN);
      }}
    />
  );
}
