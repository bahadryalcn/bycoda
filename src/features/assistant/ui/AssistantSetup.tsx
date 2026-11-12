import { Text } from "../../../shared/ui/Text";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ASSISTANT_MIN_DAILY_TOKEN_BUDGET,
  type AssistantProfilePatch,
} from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Progress } from "../../../shared/ui/Progress";
import { Sparkles } from "../../../shared/ui/icons";
import { loadVoicePersona } from "../../voice/model/voicePersona";
import { VoiceSetupSteps } from "../../voice/ui/VoiceSetupSteps";
import { assistantRequest, useAssistantSnapshot } from "../model/assistantClient";
import { assistantSetupDefaults } from "../model/assistantSetupDefaults";
import { useModelSource } from "../../sessions/public/modelSource";
import {
  defaultModelSettings,
  getModelSnapshot,
  subscribeModels,
} from "../../sessions/public/models";
import { isRemoteProvider } from "../../connections/public/protocol";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { AlwaysOnChecklist } from "./settings/AlwaysOnChecklist";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { AssistantProfileFields } from "./AssistantProfileFields";
import { AssistantBuilderDialog } from "./builder/AssistantBuilderDialog";
import { RUNTIME_MODE_LABEL } from "../../sessions/public/session";
import { ASSISTANT_WORK_PRESET_TEXT, assistantWorkPreset } from "../model/assistantWorkPresets";
import styles from "./AssistantSetup.module.css";

const DRAFT_KEY = "bycoda.assistant.setup-draft";
const TONE_LABEL = {
  friendly: "Friendly",
  neutral: "Neutral",
  formal: "Formal",
  casual: "Casual",
  blunt: "Blunt",
} as const;
const FREQUENCY_LABEL = {
  always: "Always use my name",
  sometimes: "Sometimes use my name",
  never: "Never use my name",
} as const;
const labels = [
  "Identity",
  "Language",
  "Voice provider",
  "Voice",
  "Microphone test",
  "Conversation behavior",
  "Work mode",
  "Presence and hours",
  "First rules",
  "Review",
];
/** One short line per step, saying what the step decides and what it changes. Indexed by step. */
const intros = [
  "Name how the assistant appears and how it addresses you.",
  "The language for replies and spoken responses.",
  "Choose a speech provider and confirm it responds before you continue.",
  "Choose a voice and confirm it plays before you continue.",
  "The microphone opens only when you start this test.",
  "How the assistant sounds and how often it uses your name.",
  "Choose how freely it may work. Jobs use your default worker model; change models and permissions later in Settings.",
  "Choose when it may reach out and when it stays quiet.",
  "Each line is saved as a rule when setup finishes.",
  "Check these choices. Start saves them to the Host.",
];
type Draft = {
  step: number;
  patch: AssistantProfilePatch;
  rules: string;
  environmentId?: string;
};
function readDraft(): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    return value &&
      Number.isInteger(value.step) &&
      value.step >= 0 &&
      value.step <= 9 &&
      typeof value.rules === "string" &&
      value.patch &&
      typeof value.patch === "object"
      ? { ...value, patch: assistantSetupDefaults(value.patch) }
      : null;
  } catch {
    return null;
  }
}

/** Core-only setup needs identity and budget. Voice adds explicit provider,
 * playback and microphone checks; reopening the wizard never starts capture. */
export function AssistantSetup({
  onClose,
  voice = false,
}: {
  onClose: () => void;
  voice?: boolean;
}) {
  const { snapshot, environmentId, error: loadError, loading, refresh } = useAssistantSnapshot();
  const modelSource = useModelSource();
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const [draft, setDraft] = useState<Draft | null>(readDraft);
  const [pending, setPending] = useState(false);
  const busy = useRef(false),
    liveEnvironment = useRef(environmentId);
  liveEnvironment.current = environmentId;
  const [error, setError] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const checklistRequest = useMemo(
    (): typeof assistantRequest => (input) => assistantRequest(input, draft?.environmentId),
    [draft?.environmentId],
  );
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  // Quick setup is identity, work mode, review. Rules are added later in Memory; the voice path keeps its step.
  const steps = voice ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 6, 9];
  useEffect(() => {
    if (!draft && snapshot && environmentId) {
      const legacy = loadVoicePersona();
      setDraft({
        step: 0,
        environmentId,
        patch: assistantSetupDefaults({
          ...snapshot.profile,
          name: snapshot.profile.name || legacy.name,
          addressAs: snapshot.profile.addressAs || legacy.userName,
        }),
        rules: snapshot.profile.setupComplete ? "" : legacy.rules,
      });
    } else if (draft && !draft.environmentId && snapshot && environmentId) {
      setDraft({ ...draft, environmentId });
    }
  }, [snapshot, draft, environmentId]);
  useEffect(() => {
    if (draft)
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* Keep the in-memory draft when storage is full. */
      }
  }, [draft]);
  const index = draft ? Math.max(0, steps.indexOf(draft.step)) : 0;
  const step = steps[index];
  const patch = draft?.patch ?? {};
  const workPreset = assistantWorkPreset(patch);
  /** A first setup starts with nothing chosen; a custom mix the owner made or already saved is shown as Custom. */
  const workModeUnchosen =
    workPreset === "custom" &&
    !snapshot?.profile.setupComplete &&
    (patch.autonomy ?? "report") === "report";
  const displayedDefaultWorker = modelSource.resolve("codex", "");
  const proposedWorker =
    !snapshot?.profile.setupComplete &&
    !patch.setupComplete &&
    !patch.execution &&
    (patch.autonomy === "jobs" || patch.autonomy === "chief")
      ? displayedDefaultWorker
      : undefined;
  const defaultWorkerAvailable =
    proposedWorker &&
    isRemoteProvider(proposedWorker.harness) &&
    proposedWorker.id.trim() &&
    modelSource.available(proposedWorker.harness) &&
    modelSource
      .modelsFor(proposedWorker.harness)
      .some((model) => model.harness === proposedWorker.harness && model.id === proposedWorker.id);
  const workerModel = patch.execution
    ? (modelSource
        .modelsFor(patch.execution.harness)
        .find((model) => model.id === patch.execution?.model)?.name ?? patch.execution.model)
    : defaultWorkerAvailable
      ? proposedWorker.name
      : undefined;
  function assertSource() {
    if (!draft?.environmentId || liveEnvironment.current !== draft.environmentId)
      throw new Error(t("The original setup Host is unavailable. Your draft is kept."));
  }
  function reviewedExecution() {
    if (!proposedWorker) return patch.execution;
    if (!isRemoteProvider(proposedWorker.harness) || !defaultWorkerAvailable)
      throw new Error(t("Choose a provider and model"));
    return {
      harness: proposedWorker.harness,
      model: proposedWorker.id,
      modelSettings: defaultModelSettings(proposedWorker),
      runtimeMode: "supervised" as const,
      maxRunMinutes: 60,
    };
  }
  function next() {
    if (!draft) return;
    try {
      const execution = step === 6 ? (assertSource(), reviewedExecution()) : patch.execution;
      setError("");
      setDraft({ ...draft, patch: { ...draft.patch, execution }, step: steps[index + 1] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function update(next: AssistantProfilePatch) {
    if (next.language !== undefined) setVerified({});
    setDraft((current) =>
      current ? { ...current, patch: { ...current.patch, ...next } } : current,
    );
  }
  function valid() {
    if (step === 0) return Boolean(patch.name?.trim());
    if (step === 6 && workModeUnchosen) return false;
    if (
      (step === 6 || step === 9) &&
      (!patch.name?.trim() ||
        !Number.isInteger(patch.dailyTokenBudget) ||
        (patch.dailyTokenBudget ?? 0) < ASSISTANT_MIN_DAILY_TOKEN_BUDGET)
    )
      return false;
    if (step === 2 || step === 3 || step === 4) return verified[String(step)] === true;
    return true;
  }
  async function finish() {
    if (!snapshot || !draft || busy.current) return;
    const expectedEnvironmentId = draft.environmentId;
    let execution = patch.execution;
    try {
      assertSource();
      execution = reviewedExecution();
      if (execution !== patch.execution)
        setDraft({ ...draft, patch: { ...draft.patch, execution } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      for (const rule of draft.rules
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter(Boolean)) {
        assertSource();
        await assistantRequest(
          {
            op: "memory.save",
            kind: "rule",
            text: rule,
            scope: "all",
            source: "typed",
            quote: rule,
            active: true,
            forbiddenTerms: [],
          },
          expectedEnvironmentId,
        );
        assertSource();
      }
      const { profile } = await assistantRequest(
        {
          op: "profile.update",
          expectedVersion: snapshot.profile.version,
          patch: {
            name: patch.name,
            showTitle: patch.showTitle,
            avatar: patch.avatar,
            addressAs: patch.addressAs,
            language: patch.language,
            execution,
            chiefExecution: patch.chiefExecution,
            replyExecution: patch.replyExecution,
            planningExecution: patch.planningExecution,
            autonomy: patch.autonomy,
            allowRoutineQuestions: patch.allowRoutineQuestions,
            confirmJobs: patch.confirmJobs,
            addressFrequency: patch.addressFrequency,
            tone: patch.tone,
            allowProfanity: patch.allowProfanity,
            persona: patch.persona,
            planApproval: patch.planApproval,
            dailyTokenBudget: patch.dailyTokenBudget,
            workerSoftContext: patch.workerSoftContext,
            workerHardContext: patch.workerHardContext,
            workerCompactPercent: patch.workerCompactPercent,
            workerHandoffPercent: patch.workerHandoffPercent,
            proactiveSpeech: patch.proactiveSpeech,
            keepAwakeWhileWorking: patch.keepAwakeWhileWorking,
            quietStart: patch.quietStart,
            quietEnd: patch.quietEnd,
            stallMinutes: patch.stallMinutes,
            idleMinutes: patch.idleMinutes,
            awayMinutes: patch.awayMinutes,
            chiefWakeLimit: patch.chiefWakeLimit,
            nudgeLimit: patch.nudgeLimit,
            activeStart: patch.activeStart,
            activeEnd: patch.activeEnd,
            notificationPresent: patch.notificationPresent,
            notificationAway: patch.notificationAway,
            notificationDnd: patch.notificationDnd,
            observationTaskDone: patch.observationTaskDone,
            observationTaskNeedsInput: patch.observationTaskNeedsInput,
            setupComplete: true,
            ...(voice ? { voiceSetupComplete: true } : {}),
            enabled: true,
          },
        },
        expectedEnvironmentId,
      );
      assertSource();
      if (!profile?.setupComplete) throw new Error(t("Setup was not confirmed by the Host."));
      localStorage.removeItem(DRAFT_KEY);
      setFinished(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (finished && snapshot)
    return (
      <Modal
        title={t("Ready for 24/7")}
        size="md"
        fitViewport
        onClose={onClose}
        footer={
          <ModalActions>
            <Button variant="primary" onClick={onClose}>
              {t("Done")}
            </Button>
          </ModalActions>
        }
      >
        <Text as="div" size="inherit" tone="inherit" leading="normal" className={styles.setup}>
          <Text as="p" leading="normal" className={styles.muted}>
            {t(
              "Optional. Check what keeps the assistant working around the clock; you can skip this and find it later in Settings, Access.",
            )}
          </Text>
          <AlwaysOnChecklist request={checklistRequest} snapshot={snapshot} />
        </Text>
      </Modal>
    );
  return (
    <Modal
      title={draft ? t(labels[step]) : t("Set up")}
      context={
        draft ? (
          <span className={styles.context}>
            <span>{t("Set up")}</span>
            <span>{t("Step {p0} of {p1}", { p0: index + 1, p1: steps.length })}</span>
          </span>
        ) : undefined
      }
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      fitViewport
      footerStart={draft && error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        draft ? (
          <ModalActions>
            <Button
              variant="ghost"
              disabled={pending || index === 0}
              onClick={() => setDraft({ ...draft, step: steps[index - 1] })}
            >
              {t("Back")}
            </Button>
            {step === 9 ? (
              <Button
                variant="primary"
                loading={pending}
                disabled={
                  !valid() || (voice && ![2, 3, 4].every((value) => verified[String(value)]))
                }
                onClick={() => void finish()}
              >
                {t("Start")}
              </Button>
            ) : (
              <Button variant="primary" disabled={!valid()} onClick={next}>
                {t("Next")}
              </Button>
            )}
          </ModalActions>
        ) : undefined
      }
    >
      <Text as="div" size="inherit" tone="inherit" leading="normal" className={styles.setup}>
        {loadError && (
          <InlineError
            className={styles.feedback}
            retry={{ onRetry: () => void refresh(), pending: loading }}
          >
            {loadError}
          </InlineError>
        )}
        {/* Always mounted so the loading message is announced when it first appears. */}
        <LiveText
          className={styles.muted}
          size="caption"
          tone="secondary"
          leading="normal"
          text={draft ? "" : t("Loading...")}
        />
        {!draft ? null : (
          <>
            <Progress
              value={index + 1}
              max={steps.length}
              compact
              tone="neutral"
              aria-label={t("Step {p0} of {p1}", { p0: index + 1, p1: steps.length })}
            />
            <div className={styles.content}>
              <Text
                as="p"
                size="secondary"
                tone="secondary"
                leading="normal"
                className={styles.intro}
              >
                {t(intros[step])}
              </Text>
              {step === 0 && (
                <Button
                  type="button"
                  className={styles.aiStart}
                  startIcon={<Sparkles className="icon-sm" />}
                  onClick={() => setBuilderOpen(true)}
                >
                  {t("Set up with AI")}
                </Button>
              )}
              {step === 0 && (
                <div className={styles.grid}>
                  <AssistantProfileFields section="identity" value={patch} onChange={update} />
                </div>
              )}
              {step === 1 && (
                <AssistantProfileFields section="language" value={patch} onChange={update} />
              )}
              {(step === 2 || step === 3 || step === 4) && (
                <VoiceSetupSteps
                  key={step}
                  step={step === 2 ? "provider" : step === 3 ? "voice" : "microphone"}
                  language={patch.language}
                  name={patch.name}
                  onValidChange={(valid) =>
                    setVerified((current) =>
                      current[String(step)] === valid
                        ? current
                        : { ...current, [String(step)]: valid },
                    )
                  }
                />
              )}
              {step === 5 && (
                <div className={styles.grid}>
                  <AssistantProfileFields section="personality" value={patch} onChange={update} />
                  <AssistantProfileFields section="behavior" value={patch} onChange={update} />
                </div>
              )}
              {step === 6 && (
                <div className={styles.grid}>
                  <AssistantProfileFields
                    section="workmode"
                    value={patch}
                    onChange={update}
                    workModeUnchosen={workModeUnchosen}
                  />
                </div>
              )}
              {step === 7 && (
                <div className={styles.grid}>
                  <AssistantProfileFields
                    section="presence"
                    value={patch}
                    onChange={update}
                    observationTasksAvailable={snapshot?.capabilities.observationTasks === true}
                  />
                </div>
              )}
              {step === 7 && (
                <AssistantKeepAwakeStatus
                  state={snapshot?.keepAwake}
                  compact={Boolean(snapshot?.keepAwake)}
                />
              )}
              {step === 8 && (
                <TextareaField
                  label={t("Anything I should know?")}
                  value={draft.rules}
                  maxLength={4000}
                  minRows={4}
                  description={t("One rule per line. You can edit or remove rules in Memory.")}
                  onChange={(event) => setDraft({ ...draft, rules: event.currentTarget.value })}
                />
              )}
              {step === 9 && (
                <div className={styles.review}>
                  <DescriptionList>
                    <DescriptionItem term={t("Name")}>{patch.name}</DescriptionItem>
                    <DescriptionItem term={t("Work mode")}>
                      {workPreset === "custom"
                        ? t("Custom")
                        : t(ASSISTANT_WORK_PRESET_TEXT[workPreset].label)}
                    </DescriptionItem>
                    <DescriptionItem term={t("Daily token budget")}>
                      {patch.dailyTokenBudget?.toLocaleString()}
                    </DescriptionItem>
                    {(workerModel || proposedWorker) && (
                      <DescriptionItem term={t("Worker model")}>
                        {workerModel || t("Choose a provider and model")}
                      </DescriptionItem>
                    )}
                    {patch.execution && (
                      <DescriptionItem term={t("Execution permissions")}>
                        {t(RUNTIME_MODE_LABEL[patch.execution.runtimeMode])}
                      </DescriptionItem>
                    )}
                    <DescriptionItem term={t("Personality")}>
                      {[
                        t(TONE_LABEL[patch.tone ?? "friendly"]),
                        t(FREQUENCY_LABEL[patch.addressFrequency ?? "sometimes"]),
                        patch.allowProfanity ? t("Profanity allowed") : t("No profanity"),
                      ].join(" · ")}
                    </DescriptionItem>
                    {draft.rules.trim() && (
                      <DescriptionItem term={t("First rules")}>
                        <Text
                          as="span"
                          size="inherit"
                          tone="inherit"
                          leading="relaxed"
                          className={styles.rules}
                        >
                          {draft.rules}
                        </Text>
                      </DescriptionItem>
                    )}
                  </DescriptionList>
                  <Text as="p" leading="normal" className={styles.muted}>
                    {t("The microphone opens only when you choose to talk.")}
                  </Text>
                </div>
              )}
              {step === 9 && voice && ![2, 3, 4].every((value) => verified[String(value)]) && (
                <Button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      step: [2, 3, 4].find((value) => !verified[String(value)])!,
                    })
                  }
                >
                  {t("Set up voice")}
                </Button>
              )}
            </div>
          </>
        )}
      </Text>
      {builderOpen && (
        <AssistantBuilderDialog
          current={patch}
          onClose={() => setBuilderOpen(false)}
          onApply={update}
        />
      )}
    </Modal>
  );
}
