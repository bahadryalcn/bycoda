import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { Heading } from "../../../shared/ui/Heading";
import { Surface } from "../../../shared/ui/Surface";
import { X } from "../../../shared/ui/icons";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import {
  findAssistantApprovals,
  verifyAssistantApproval,
  type AssistantApprovalTarget,
  type AssistantGoalApprovalTarget,
} from "../model/assistantBriefing";
import { listenAssistantBriefing } from "../model/assistantBriefingSpeech";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../../voice/model/voiceActivity";
import { requestTranscriptJump } from "../../sessions/model/transcriptJump";
import briefingStyles from "./AssistantBriefingCard.module.css";
import { assistantJobVisible } from "../model/assistantJobs";
import { captureAssistantHostRead, type AssistantHostRead } from "../model/assistantHostRead";
import { InlineError } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { briefingSections } from "./room/briefingSections";
import { LiveText } from "../../../shared/ui/LiveText";

/** Longer briefing text folds to this many characters until the owner expands it. */

export function AssistantBriefingCard({
  snapshot,
  onDismiss,
  onOpenNotes,
  onOpenSession,
  onOpenGoal,
  onSetupVoice,
  onChooseLanguage,
  privacyKey,
  environmentId,
  canSeeProject = () => true,
  canReadBriefing = () => true,
}: {
  snapshot: AssistantSnapshot;
  onDismiss: () => void | Promise<void>;
  onOpenNotes: () => void;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onOpenGoal?: (target: AssistantGoalApprovalTarget) => void | Promise<void>;
  onSetupVoice: () => void;
  onChooseLanguage: () => void;
  privacyKey?: string;
  canSeeProject?: (id: string) => boolean;
  canReadBriefing?: (snapshot?: AssistantSnapshot) => boolean;
  environmentId?: string;
}) {
  const briefing = snapshot.briefing;
  const unknownLanguage = snapshot.profile.language === "auto" && !snapshot.lastSpokenLanguage;
  const activeVoice = useSyncExternalStore(
    subscribeVoiceConversationActivity,
    isVoiceConversationActive,
    () => false,
  );
  const playback = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const [speaking, setSpeaking] = useState<"idle" | "loading" | "playing">("idle");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [audioError, setAudioError] = useState("");
  const [approvals, setApprovals] = useState<AssistantApprovalTarget[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  useEffect(() => {
    epoch.current++;
    busyRef.current = false;
    setBusy("");
    setApprovals(null);
    setError("");
    setAudioError("");
    setSpeaking("idle");
    return () => {
      epoch.current++;
      playback.current?.abort();
      playback.current = null;
    };
  }, [briefing?.id, privacyKey, environmentId]);
  if (!briefing) return null;
  const parts = briefingSections(briefing.text);
  async function listen() {
    if (playback.current) return;
    const controller = new AbortController();
    playback.current = controller;
    const captured = epoch.current;
    setAudioError("");
    setSpeaking("loading");
    try {
      await listenAssistantBriefing(
        briefing!.id,
        controller.signal,
        (playing) => {
          if (captured === epoch.current && !controller.signal.aborted)
            setSpeaking(playing ? "playing" : "loading");
        },
        canReadBriefing,
        environmentId,
      );
    } catch (cause) {
      if (!controller.signal.aborted && captured === epoch.current)
        setAudioError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (playback.current === controller) {
        playback.current = null;
        if (captured === epoch.current) setSpeaking("idle");
      }
    }
  }
  async function run(key: string, action: (current: () => void) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const captured = epoch.current;
    setBusy(key);
    setError("");
    const current = () => {
      if (captured !== epoch.current) throw new Error("This briefing is no longer open.");
    };
    try {
      await action(current);
    } catch (cause) {
      if (captured === epoch.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (captured === epoch.current) {
        busyRef.current = false;
        setBusy("");
      }
    }
  }
  async function open(
    target: AssistantApprovalTarget,
    guard: () => void,
    captured?: AssistantHostRead,
  ) {
    const owner = captured ?? (await captureAssistantHostRead(target.environmentId));
    if (owner.environmentId !== target.environmentId)
      throw new Error("The approval's Host changed. Check again.");
    const current = await owner.snapshot();
    guard();
    if (!canSeeProject(target.projectId))
      throw new Error("The selected project is no longer visible.");
    if (!current) throw new Error("The current assistant state is unavailable.");
    await verifyAssistantApproval(
      target,
      current.jobs.filter((job) => assistantJobVisible(job, canSeeProject)),
      owner,
    );
    guard();
    if (!canSeeProject(target.projectId))
      throw new Error("The selected project is no longer visible.");
    const job = current.jobs.find((job) => job.id === target.jobId);
    if (job && !assistantJobVisible(job, canSeeProject))
      throw new Error("The selected project is no longer visible.");
    if (target.kind === "goal") {
      if (!onOpenGoal) throw new Error("Goal navigation is unavailable.");
      await onOpenGoal(target);
    } else {
      if (!onOpenSession) throw new Error("Session navigation is unavailable.");
      await onOpenSession(target.sessionId, target.environmentId);
      requestTranscriptJump(target.sessionId, target.blockId);
    }
  }
  async function checkApprovals(guard: () => void) {
    setApprovals(null);
    setUnavailable(0);
    const owner = await captureAssistantHostRead(environmentId);
    const current = await owner.snapshot();
    guard();
    if (!current) throw new Error("The current assistant state is unavailable.");
    const result = await findAssistantApprovals(
      current.jobs.filter((job) => assistantJobVisible(job, canSeeProject)),
      owner,
    );
    guard();
    const targets = result.targets.filter((target) => canSeeProject(target.projectId));
    setApprovals(targets);
    setUnavailable(result.unavailable);
    if (targets.length === 1 && result.unavailable === 0) await open(targets[0], guard, owner);
  }
  return (
    <Surface
      as="section"
      variant="card"
      padding="md"
      className={briefingStyles.briefing}
      aria-label={t("While you were away")}
    >
      <div className={briefingStyles.header}>
        <Heading size="item" level={2}>
          {t("While you were away")}
        </Heading>
        <Button
          iconOnly
          label={t("Dismiss")}
          disabled={!!busy}
          onClick={() =>
            void run("dismiss", async () => {
              playback.current?.abort();
              await onDismiss();
            })
          }
        >
          <X className="icon-sm" />
        </Button>
      </div>
      {parts.lead && (
        <ClampText key={briefing.id} lines={3} className={briefingStyles.copy}>
          {parts.lead}
        </ClampText>
      )}
      {parts.sections.length > 0 && (
        <div className={briefingStyles.sections}>
          {parts.sections.map((section) => (
            <section key={section.label} className={briefingStyles.section}>
              <SectionLabel as="h3" count={section.items.length}>
                {section.label}
              </SectionLabel>
              <ul className={briefingStyles.items}>
                {section.items.map((item, index) => (
                  <li key={index} className={briefingStyles.item}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {parts.notes.map((note) => (
        <p key={note} className={briefingStyles.muted}>
          {note}
        </p>
      ))}
      <div className={briefingStyles.actions}>
        {!snapshot.profile.voiceSetupComplete ? (
          <Button onClick={onSetupVoice}>{t("Set up voice")}</Button>
        ) : speaking === "idle" ? (
          <Button
            disabled={activeVoice || unknownLanguage}
            disabledReason={
              activeVoice
                ? t("Finish the voice conversation before listening to the briefing.")
                : undefined
            }
            onClick={() => void listen()}
          >
            {t(audioError ? "Retry listening" : "Listen")}
          </Button>
        ) : (
          <Button
            onClick={() => {
              playback.current?.abort();
              playback.current = null;
              setSpeaking("idle");
            }}
          >
            {t("Stop listening")}
          </Button>
        )}
        <Button onClick={onOpenNotes}>{t("Open notes")}</Button>
        <Button
          loading={busy === "approvals"}
          disabled={!!busy}
          onClick={() => void run("approvals", checkApprovals)}
        >
          {t("Go to approvals")}
        </Button>
      </div>
      {/* Always mounted so the status is announced when it first appears. */}
      <LiveText
        className={briefingStyles.muted}
        text={
          speaking === "idle"
            ? ""
            : t(
                speaking === "loading"
                  ? "Preparing audio..."
                  : "Reading the briefing. This does not open the microphone.",
              )
        }
      />
      {snapshot.profile.voiceSetupComplete && unknownLanguage && (
        <div className={briefingStyles.languageHint}>
          <span className={briefingStyles.muted}>
            {t("Speak once or choose a language before listening.")}
          </span>
          <Button onClick={onChooseLanguage}>{t("Choose language")}</Button>
        </div>
      )}
      {audioError && <InlineError>{t(audioError)}</InlineError>}
      <LiveText
        className={briefingStyles.muted}
        text={approvals?.length === 0 && unavailable === 0 ? t("No pending approvals found.") : ""}
      />
      {unavailable > 0 && (
        <InlineError>{t("Some approval sources could not be checked. Try again.")}</InlineError>
      )}
      {approvals && approvals.length > 0 && (
        <div className={briefingStyles.approvals}>
          {approvals
            .filter((target) => canSeeProject(target.projectId))
            .map((target) => (
              <div
                className={briefingStyles.approval}
                key={
                  target.kind === "goal"
                    ? `goal:${target.goalId}`
                    : `session:${target.sessionId}:${target.blockId}`
                }
              >
                <span>
                  {target.title} ·{" "}
                  {t(target.kind === "goal" ? "Plan approval" : "Command approval")}
                </span>
                <Button
                  disabled={!!busy || (target.kind === "goal" ? !onOpenGoal : !onOpenSession)}
                  onClick={() => void run("opening", (guard) => open(target, guard))}
                >
                  {t("Review")}
                </Button>
              </div>
            ))}
        </div>
      )}
      {error && <InlineError>{t(error)}</InlineError>}
    </Surface>
  );
}
