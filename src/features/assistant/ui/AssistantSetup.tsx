import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Progress } from "../../../shared/ui/Progress";
import { loadVoicePersona } from "../../voice/model/voicePersona";
import { VoiceSetupSteps } from "../../voice/ui/VoiceSetupSteps";
import { assistantRequest, useAssistantSnapshot } from "../model/assistantClient";
import { assistantSetupDefaults } from "../model/assistantSetupDefaults";
import { useModelSource } from "../../sessions/ui/modelSource";
import {
  defaultModelSettings,
  getModelSnapshot,
  subscribeModels,
} from "../../sessions/model/models";
import { isRemoteProvider } from "../../connections/model/protocol";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { AssistantProfileFields } from "./AssistantProfileFields";
import styles from "./AssistantSetup.module.css";

const DRAFT_KEY = "bycoda.assistant.setup-draft";
const labels = [
  "Identity",
  "Language",
  "Voice provider",
  "Voice",
  "Microphone test",
  "Conversation behavior",
  "Autonomy",
  "Presence and hours",
  "First rules",
  "Review",
];
type Draft = { step: number; patch: AssistantProfilePatch; rules: string; environmentId?: string };
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
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const steps = voice ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 6, 8, 9];
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
    if (
      (step === 6 || step === 9) &&
      (!patch.name?.trim() ||
        !Number.isInteger(patch.dailyTokenBudget) ||
        (patch.dailyTokenBudget ?? 0) < 1)
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
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
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
      <div className={styles.setup}>
        {loadError && (
          <InlineError
            className={styles.feedback}
            retry={{ onRetry: () => void refresh(), pending: loading }}
          >
            {loadError}
          </InlineError>
        )}
        {/* Always mounted so the loading message is announced when it first appears. */}
        <LiveText className={styles.muted} text={draft ? "" : t("Loading...")} />
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
              {step === 0 && (
                <AssistantProfileFields section="identity" value={patch} onChange={update} />
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
                <AssistantProfileFields section="behavior" value={patch} onChange={update} />
              )}
              {step === 6 && (
                <AssistantProfileFields section="autonomy" value={patch} onChange={update} />
              )}
              {step === 7 && (
                <AssistantProfileFields
                  section="presence"
                  value={patch}
                  onChange={update}
                  observationTasksAvailable={snapshot?.capabilities.observationTasks === true}
                />
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
                  <dl className={styles.summary}>
                    <div>
                      <dt>{t("Name")}</dt>
                      <dd>{patch.name}</dd>
                    </div>
                    <div>
                      <dt>{t("Autonomy")}</dt>
                      <dd>
                        {t(
                          patch.autonomy === "report"
                            ? "Report only"
                            : patch.autonomy === "chief"
                              ? "Supervise assigned jobs"
                              : "Run jobs",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Daily token budget")}</dt>
                      <dd>{patch.dailyTokenBudget?.toLocaleString()}</dd>
                    </div>
                    {(workerModel || proposedWorker) && (
                      <div>
                        <dt>{t("Worker model")}</dt>
                        <dd>{workerModel || t("Choose a provider and model")}</dd>
                      </div>
                    )}
                    {draft.rules.trim() && (
                      <div className={styles.rules}>
                        <dt>{t("First rules")}</dt>
                        <dd>{draft.rules}</dd>
                      </div>
                    )}
                  </dl>
                  <p className={styles.muted}>
                    {t("The microphone opens only when you choose to talk.")}
                  </p>
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
      </div>
    </Modal>
  );
}
