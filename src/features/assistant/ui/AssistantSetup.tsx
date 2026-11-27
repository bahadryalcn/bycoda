import { errorText } from "../../../shared/lib/errors";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text, textAttributes } from "../../../shared/ui/Text";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ASSISTANT_MIN_DAILY_TOKEN_BUDGET,
  type AssistantProfilePatch,
} from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Stepper } from "../../../shared/ui/Stepper";
import { loadVoicePersona } from "../../voice/model/voicePersona";
import { useVoiceSetupProviderKey, VoiceSetupSteps } from "../../voice/public/setup";
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
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { AssistantProfileFields } from "./AssistantProfileFields";
import { useLanguageChangeFlow } from "./settings/useLanguageChangeFlow";
import { AssistantBuilderDialog } from "./builder/AssistantBuilderDialog";
import { applyAssistantWorkPreset, assistantWorkPreset } from "../model/assistantWorkPresets";
import styles from "./AssistantSetup.module.css";

const DRAFT_KEY = "bycoda.assistant.setup-draft";
class SetupReadinessError extends Error {}
const STEP_IDS = [
  "identity",
  "voice",
  "speaker",
  "microphone",
  "workmode",
  "presence",
  "review",
] as const;
type StepId = (typeof STEP_IDS)[number];
/** The translated step name; call it while rendering. */
function stepLabel(id: StepId): string {
  switch (id) {
    case "identity":
      return t("Identity");
    case "voice":
      return t("Voice provider");
    case "speaker":
      return t("Speaker");
    case "microphone":
      return t("Microphone");
    case "workmode":
      return t("Work mode");
    case "presence":
      return t("Presence and hours");
    case "review":
      return t("Review");
  }
}
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
  if (typeof value === "string" && (STEP_IDS as readonly string[]).includes(value))
    return value as StepId;
  return undefined;
}
type Draft = {
  step: StepId;
  patch: AssistantProfilePatch;
  rules: string;
  environmentId?: string;
  detailedVoice?: boolean;
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

/** Core setup is one screen: the name and a work mode, then Start. Voice adds explicit provider,
 * playback and microphone checks as steps; reopening the wizard never starts capture. */
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
  const [legacyDetails] = useState(() => draft?.step === "workmode" || draft?.step === "presence");
  const [pending, setPending] = useState(false);
  const busy = useRef(false),
    liveEnvironment = useRef(environmentId);
  liveEnvironment.current = environmentId;
  const [error, setError] = useState<{ title: string; detail?: string }>();
  function showSetupError(cause: unknown, title: string) {
    setError(
      cause instanceof SetupReadinessError
        ? { title: cause.message }
        : { title, detail: errorText(cause) },
    );
  }
  const providerKey = useVoiceSetupProviderKey();
  const [verifiedProvider, setVerifiedProvider] = useState<string>();
  const providerVerified = verifiedProvider === providerKey;
  const voiceOnly = voice && snapshot?.profile.setupComplete === true;
  const steps: StepId[] = voice
    ? [
        ...(voiceOnly ? [] : ["identity" as const]),
        "voice",
        "speaker",
        "microphone",
        ...(!voiceOnly && (draft?.detailedVoice || legacyDetails)
          ? (["workmode", "presence"] as const)
          : []),
        "review",
      ]
    : ["identity"];
  useEffect(() => {
    if (!draft && snapshot && environmentId) {
      const legacy = loadVoicePersona();
      const defaults = assistantSetupDefaults({
        ...snapshot.profile,
        name: snapshot.profile.name || legacy.name,
        addressAs: snapshot.profile.addressAs || legacy.userName,
      });
      // A first core setup starts on the safe "Only watch" mode instead of asking for a choice.
      const untouched =
        !voice &&
        !snapshot.profile.setupComplete &&
        assistantWorkPreset(defaults) === "custom" &&
        (defaults.autonomy ?? "report") === "report";
      setDraft({
        step: voice && snapshot.profile.setupComplete ? "voice" : "identity",
        environmentId,
        patch: untouched
          ? { ...defaults, ...applyAssistantWorkPreset(defaults, "watch") }
          : defaults,
        rules: snapshot.profile.setupComplete ? "" : legacy.rules,
      });
    } else if (draft && !draft.environmentId && snapshot && environmentId) {
      setDraft({ ...draft, environmentId });
    }
  }, [snapshot, draft, environmentId, voice]);
  const [draftWriter] = useState(() => createLocalDraftWriter(DRAFT_KEY));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Attach the draft writer's page lifecycle listener and flush on unmount.
  useEffect(() => draftWriter.attach(), [draftWriter]);
  useEffect(() => {
    // Typing only records the draft; the shared debounce writes it, and close or pagehide flushes it.
    if (draft) draftWriter.schedule(() => JSON.stringify(draft));
  }, [draft, draftWriter]);
  const index = draft ? Math.max(0, steps.indexOf(draft.step)) : 0;
  const step = steps[index];
  const patch = draft?.patch ?? {};
  /** Typed answer the builder opens with (the language-change rewrite request). */
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderRequest, setBuilderRequest] = useState("");
  const languageFlow = useLanguageChangeFlow({
    draft: patch,
    lastSpoken: snapshot?.lastSpokenLanguage,
    applyLanguage: (language) => update({ language }),
    startBuilder: (request) => {
      setBuilderRequest(request);
      setBuilderOpen(true);
    },
  });
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
  function assertSource() {
    if (!draft?.environmentId || liveEnvironment.current !== draft.environmentId)
      throw new SetupReadinessError(
        t("The original setup Host is unavailable. Your draft is kept."),
      );
  }
  function reviewedExecution() {
    if (!proposedWorker) return patch.execution;
    if (!isRemoteProvider(proposedWorker.harness) || !defaultWorkerAvailable)
      throw new SetupReadinessError(t("Choose a provider and model"));
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
      setError(undefined);
      setDraft({ ...draft, patch: { ...draft.patch, execution }, step: steps[index + 1] });
    } catch (cause) {
      showSetupError(cause, t("Could not continue assistant setup."));
    }
  }
  function update(next: AssistantProfilePatch) {
    setDraft((current) =>
      current ? { ...current, patch: { ...current.patch, ...next } } : current,
    );
  }
  /** Why Start or Next cannot be used yet; undefined when the step is complete. */
  function invalidReason() {
    if (step === "voice" || (step === "review" && voiceOnly))
      return providerVerified ? undefined : t("Verify the voice provider first.");
    if (step === "identity" && voice)
      return patch.name?.trim() ? undefined : t("Enter a name first.");
    if (step === "identity" || step === "workmode" || step === "review") {
      if (!patch.name?.trim()) return t("Enter a name first.");
      if (
        !Number.isInteger(patch.dailyTokenBudget) ||
        (patch.dailyTokenBudget ?? 0) < ASSISTANT_MIN_DAILY_TOKEN_BUDGET
      )
        return t("Set a larger daily token budget first.");
    }
    return undefined;
  }
  function valid() {
    if (step === "voice") return providerVerified;
    if (step === "review" && voiceOnly) return providerVerified;
    if (step === "identity" && voice) return Boolean(patch.name?.trim());
    if (
      (step === "identity" || step === "workmode" || step === "review") &&
      (!patch.name?.trim() ||
        !Number.isInteger(patch.dailyTokenBudget) ||
        (patch.dailyTokenBudget ?? 0) < ASSISTANT_MIN_DAILY_TOKEN_BUDGET)
    )
      return false;
    return true;
  }
  async function finish() {
    if (!snapshot || !draft || busy.current || (voice && !providerVerified)) return;
    const expectedEnvironmentId = draft.environmentId;
    let execution = patch.execution;
    try {
      assertSource();
      if (!voiceOnly) execution = reviewedExecution();
      if (execution !== patch.execution)
        setDraft({ ...draft, patch: { ...draft.patch, execution } });
    } catch (cause) {
      showSetupError(cause, t("Could not continue assistant setup."));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      for (const rule of (voiceOnly ? "" : draft.rules)
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
          patch: voiceOnly
            ? { voiceSetupComplete: true }
            : {
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
      if (!profile?.setupComplete || (voice && !profile.voiceSetupComplete))
        throw new SetupReadinessError(t("Setup could not be confirmed by the Host."));
      draftWriter.clear();
      onClose();
    } catch (cause) {
      showSetupError(cause, t("Could not save assistant setup."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Modal
      title={voice ? t("Voice setup") : t("Set up")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size={voice ? "md" : "sm"}
      fitViewport
      footerStart={
        draft && error ? <InlineError details={error.detail}>{error.title}</InlineError> : undefined
      }
      footer={
        draft ? (
          <ModalActions>
            {voice && (
              <Button
                variant="ghost"
                disabled={pending || index === 0}
                disabledReason={index === 0 ? t("This is the first step.") : undefined}
                onClick={() => setDraft({ ...draft, step: steps[index - 1] })}
              >
                {t("Back")}
              </Button>
            )}
            {!voice || step === "review" ? (
              <Button
                variant="primary"
                loading={pending}
                disabled={!valid() || (voice && !providerVerified)}
                disabledReason={
                  invalidReason() ??
                  (voice && !providerVerified ? t("Verify the voice provider first.") : undefined)
                }
                onClick={() => void finish()}
              >
                {t("Start")}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!valid()}
                disabledReason={invalidReason()}
                onClick={next}
              >
                {t("Next")}
              </Button>
            )}
          </ModalActions>
        ) : undefined
      }
    >
      <div
        {...textAttributes({ size: "inherit", tone: "inherit", leading: "normal" }, styles.setup)}
      >
        {loadError && (
          <InlineError
            details={loadError}
            retry={{ onRetry: () => void refresh(), pending: loading }}
          >
            {t("Could not load the assistant setup.")}
          </InlineError>
        )}
        {!draft && !loadError ? (
          <LoadingText delay={false} className={styles.muted}>
            {t("Loading…")}
          </LoadingText>
        ) : null}
        {!draft ? null : (
          <>
            {voice && (
              <Stepper
                steps={steps.map((id) => ({
                  id,
                  label: stepLabel(id),
                  description: id === "speaker" || id === "microphone" ? t("Optional") : undefined,
                }))}
                current={index}
                details="current"
                label={t("Set up")}
              />
            )}
            <div className={styles.content} key={step}>
              {step === "identity" && (
                <AssistantProfileFields section="identity" value={patch} onChange={update} />
              )}
              {step === "identity" && !voice && (
                <AssistantProfileFields section="workmode" value={patch} onChange={update} />
              )}
              {step === "identity" && voice && (
                <AssistantProfileFields
                  section="language"
                  value={patch}
                  languageReview={languageFlow.review}
                  onChange={(change) => {
                    if (!languageFlow.intercept(change)) update(change);
                  }}
                />
              )}
              {(step === "voice" || step === "speaker" || step === "microphone") && (
                <VoiceSetupSteps
                  step={step === "voice" ? "provider" : step === "speaker" ? "voice" : "microphone"}
                  language={patch.language}
                  name={patch.name}
                  onValidChange={(valid) => {
                    if (step === "voice") setVerifiedProvider(valid ? providerKey : undefined);
                  }}
                />
              )}
              {step === "workmode" && (
                <div className={styles.grid}>
                  <AssistantProfileFields section="workmode" value={patch} onChange={update} />
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
                <Text tone="secondary">
                  {t("The microphone opens only when you choose to talk.")}
                </Text>
              )}
            </div>
          </>
        )}
      </div>
      {languageFlow.dialog}
      {builderOpen && (
        <AssistantBuilderDialog
          current={patch}
          initialAnswer={builderRequest}
          onClose={() => setBuilderOpen(false)}
          onApply={(changes) => {
            if (voice && draft && (changes.name ?? patch.name)?.trim()) {
              setDraft({ ...draft, patch: { ...patch, ...changes }, step: "voice" });
            } else update(changes);
          }}
        />
      )}
    </Modal>
  );
}
