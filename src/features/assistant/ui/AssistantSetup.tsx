import { errorText } from "../../../shared/lib/errors";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
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
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Stepper } from "../../../shared/ui/Stepper";
import { Sparkles } from "../../../shared/ui/icons";
import { loadVoicePersona } from "../../voice/model/voicePersona";
import { VoiceSetupSteps } from "../../voice/ui/VoiceSetupSteps";
import { assistantRequest, useAssistantSnapshot } from "../model/assistantClient";
import { assistantSetupDefaults } from "../model/assistantSetupDefaults";
import { createLocalDraftWriter } from "../model/assistantLocalDraft";
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
const labels = {
  identity: "Identity",
  voice: "Voice",
  workmode: "Work mode",
  presence: "Presence and hours",
  review: "Review",
} as const;
type StepId = keyof typeof labels;
const voiceChecks = ["provider", "voice", "microphone"] as const;
// Numeric drafts predate grouped setup. Preserve their content and resume in the owning step.
const legacySteps: StepId[] = [
  "identity",
  "identity",
  "voice",
  "voice",
  "voice",
  "identity",
  "workmode",
  "presence",
  "presence",
  "review",
];
function draftStep(value: unknown): StepId | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return legacySteps[value];
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value))
    return value as StepId;
  return undefined;
}
type Draft = {
  step: StepId;
  patch: AssistantProfilePatch;
  rules: string;
  environmentId?: string;
};
function readDraft(): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    return value &&
      draftStep(value.step) &&
      typeof value.rules === "string" &&
      value.patch &&
      typeof value.patch === "object"
      ? { ...value, step: draftStep(value.step)!, patch: assistantSetupDefaults(value.patch) }
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
  // Core setup stays short; voice setup groups every existing capability into five steps.
  const steps: StepId[] = voice
    ? ["identity", "voice", "workmode", "presence", "review"]
    : ["identity", "workmode", "review"];
  useEffect(() => {
    if (!draft && snapshot && environmentId) {
      const legacy = loadVoicePersona();
      setDraft({
        step: "identity",
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
  const [draftWriter] = useState(() => createLocalDraftWriter(DRAFT_KEY));
  useEffect(() => draftWriter.attach(), [draftWriter]);
  useEffect(() => {
    // Typing only records the draft; the shared debounce writes it, and close or pagehide flushes it.
    if (draft) draftWriter.schedule(() => JSON.stringify(draft));
  }, [draft, draftWriter]);
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
        .find((model) => model.id === patch.execution?.model)?.name ??
      modelDisplayName(patch.execution.model, patch.execution.harness))
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
      const execution =
        step === "workmode" ? (assertSource(), reviewedExecution()) : patch.execution;
      setError("");
      setDraft({ ...draft, patch: { ...draft.patch, execution }, step: steps[index + 1] });
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  function update(next: AssistantProfilePatch) {
    if (next.language !== undefined) setVerified({});
    setDraft((current) =>
      current ? { ...current, patch: { ...current.patch, ...next } } : current,
    );
  }
  function valid() {
    if (step === "identity") return Boolean(patch.name?.trim());
    if (step === "workmode" && workModeUnchosen) return false;
    if (
      (step === "workmode" || step === "review") &&
      (!patch.name?.trim() ||
        !Number.isInteger(patch.dailyTokenBudget) ||
        (patch.dailyTokenBudget ?? 0) < ASSISTANT_MIN_DAILY_TOKEN_BUDGET)
    )
      return false;
    if (step === "voice") return voiceChecks.every((check) => verified[check] === true);
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
      setError(errorText(cause));
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
            keepAwakeWhileAway: patch.keepAwakeWhileAway,
            urgentNotificationRepeats: patch.urgentNotificationRepeats,
            urgentNotificationIntervalMinutes: patch.urgentNotificationIntervalMinutes,
            notificationTelegram: patch.notificationTelegram,
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
      draftWriter.clear();
      setFinished(true);
    } catch (cause) {
      setError(presentRemoteError(cause, { explicit: true }));
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
      title={t("Set up")}
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
            {step === "review" ? (
              <Button
                variant="primary"
                loading={pending}
                disabled={!valid() || (voice && !voiceChecks.every((check) => verified[check]))}
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
        {!draft ? (
          <LoadingText delay={false} className={styles.muted}>
            {t("Loading…")}
          </LoadingText>
        ) : null}
        {!draft ? null : (
          <>
            <Stepper
              steps={steps.map((id) => ({ id, label: t(labels[id]) }))}
              current={index}
              label={t("Set up")}
            />
            <div className={styles.content}>
              {step === "identity" && (
                <Button
                  type="button"
                  className={styles.aiStart}
                  startIcon={<Sparkles className="icon-sm" />}
                  onClick={() => setBuilderOpen(true)}
                >
                  {t("Set up with AI")}
                </Button>
              )}
              {step === "identity" && (
                <div className={styles.grid}>
                  <AssistantProfileFields section="identity" value={patch} onChange={update} />
                </div>
              )}
              {step === "identity" && voice && (
                <AssistantProfileFields section="language" value={patch} onChange={update} />
              )}
              {step === "voice" &&
                voiceChecks.map((check) => (
                  <VoiceSetupSteps
                    key={check}
                    step={check}
                    language={patch.language}
                    name={patch.name}
                    onValidChange={(valid) =>
                      setVerified((current) =>
                        current[check] === valid ? current : { ...current, [check]: valid },
                      )
                    }
                  />
                ))}
              {step === "identity" && voice && (
                <div className={styles.grid}>
                  <AssistantProfileFields section="personality" value={patch} onChange={update} />
                  <AssistantProfileFields section="behavior" value={patch} onChange={update} />
                </div>
              )}
              {step === "workmode" && (
                <div className={styles.grid}>
                  <AssistantProfileFields
                    section="workmode"
                    value={patch}
                    onChange={update}
                    workModeUnchosen={workModeUnchosen}
                  />
                </div>
              )}
              {step === "presence" && (
                <div className={styles.grid}>
                  <AssistantProfileFields
                    section="presence"
                    value={patch}
                    onChange={update}
                    observationTasksAvailable={snapshot?.capabilities.observationTasks === true}
                  />
                </div>
              )}
              {step === "presence" && (
                <AssistantKeepAwakeStatus
                  state={snapshot?.keepAwake}
                  compact={Boolean(snapshot?.keepAwake)}
                />
              )}
              {step === "presence" && (
                <TextareaField
                  label={t("Anything I should know?")}
                  value={draft.rules}
                  maxLength={4000}
                  minRows={4}
                  description={t("One rule per line. You can edit or remove rules in Memory.")}
                  onChange={(event) => setDraft({ ...draft, rules: event.currentTarget.value })}
                />
              )}
              {step === "review" && (
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
              {step === "review" && voice && !voiceChecks.every((check) => verified[check]) && (
                <Button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      step: "voice",
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
