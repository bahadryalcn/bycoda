import { describeRemoteError, type RemoteErrorView } from "../../connections/public/remoteFailure";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { Heading } from "../../../shared/ui/Heading";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { X, Mic, Volume2, Square, File, Check, Languages } from "../../../shared/ui/icons";
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
import { Spinner } from "../../../shared/ui/Spinner";

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
  const [problem, setProblem] = useState<RemoteErrorView | null>(null);
  const [audioProblem, setAudioProblem] = useState<RemoteErrorView | null>(null);
  const [approvals, setApprovals] = useState<AssistantApprovalTarget[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  useEffect(() => {
    epoch.current++;
    busyRef.current = false;
    setBusy("");
    setApprovals(null);
    setProblem(null);
    setAudioProblem(null);
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
    setAudioProblem(null);
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
        setAudioProblem(describeRemoteError(cause));
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
    setProblem(null);
    const current = () => {
      if (captured !== epoch.current) throw new Error(t("This briefing is no longer open."));
    };
    try {
      await action(current);
    } catch (cause) {
      if (captured === epoch.current) setProblem(describeRemoteError(cause));
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
      throw new Error(t("The approval's Host changed. Check again."));
    const current = await owner.snapshot();
    guard();
    if (!canSeeProject(target.projectId))
      throw new Error(t("The selected project is no longer visible."));
    if (!current) throw new Error(t("The current assistant state is unavailable."));
    await verifyAssistantApproval(
      target,
      current.jobs.filter((job) => assistantJobVisible(job, canSeeProject)),
      owner,
    );
    guard();
    if (!canSeeProject(target.projectId))
      throw new Error(t("The selected project is no longer visible."));
    const job = current.jobs.find((job) => job.id === target.jobId);
    if (job && !assistantJobVisible(job, canSeeProject))
      throw new Error(t("The selected project is no longer visible."));
    if (target.kind === "goal") {
      if (!onOpenGoal) throw new Error(t("Epic navigation is unavailable."));
      await onOpenGoal(target);
    } else {
      if (!onOpenSession) throw new Error(t("Session navigation is unavailable."));
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
    if (!current) throw new Error(t("The current assistant state is unavailable."));
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
    <section
      {...surfaceAttributes({ variant: "canvas" }, briefingStyles.briefing)}
      aria-label={t("While you were away")}
    >
      <div className={briefingStyles.header}>
        <Heading size="item" level={2}>
          {t("While you were away")}
        </Heading>
        <Button
          iconOnly
          variant="ghost"
          size="sm"
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
        <ClampText
          key={briefing.id}
          lines={3}
          size="secondary"
          tone="inherit"
          leading="normal"
          className={briefingStyles.copy}
        >
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
                  <ClampText
                    as="li"
                    expandable={false}
                    lines={2}
                    size="secondary"
                    tone="secondary"
                    leading="inherit"
                    key={index}
                    className={briefingStyles.item}
                  >
                    {item}
                  </ClampText>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {parts.notes.map((note) => (
        <Text as="p" tone="muted" leading="inherit" key={note} className={briefingStyles.muted}>
          {note}
        </Text>
      ))}
      <div className={briefingStyles.actions}>
        {!snapshot.profile.voiceSetupComplete ? (
          <Button variant="primary" startIcon={<Mic />} onClick={onSetupVoice}>
            {t("Set up voice")}
          </Button>
        ) : speaking === "idle" && unknownLanguage && !activeVoice ? (
          // Without a spoken language Listen cannot start; the one useful control is the choice.
          <Button variant="primary" startIcon={<Languages />} onClick={onChooseLanguage}>
            {t("Choose language")}
          </Button>
        ) : speaking === "idle" ? (
          <Button
            variant="primary"
            startIcon={<Volume2 />}
            disabled={activeVoice || unknownLanguage}
            disabledReason={
              activeVoice
                ? t("Finish the voice conversation before listening to the briefing.")
                : undefined
            }
            onClick={() => void listen()}
          >
            {audioProblem ? t("Retry listening") : t("Listen")}
          </Button>
        ) : (
          // Preparing stays cancellable, so the Stop action itself carries the pending state.
          // ui-drift-ignore: button-manual-pending -- Button loading blocks presses; this Stop must cancel while audio prepares
          <Button
            startIcon={speaking === "loading" ? <Spinner size="sm" /> : <Square />}
            onClick={() => {
              playback.current?.abort();
              playback.current = null;
              setSpeaking("idle");
            }}
          >
            {speaking === "loading" ? t("Preparing audio…") : t("Stop listening")}
          </Button>
        )}
        <Button variant="ghost" startIcon={<File />} onClick={onOpenNotes}>
          {t("Open notes")}
        </Button>
        <Button
          variant="ghost"
          startIcon={<Check />}
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
        size="caption"
        tone="muted"
        leading="inherit"
        text={speaking === "playing" ? t("Reading the briefing.") : ""}
      />
      {audioProblem && (
        <InlineError details={audioProblem.details}>{audioProblem.message}</InlineError>
      )}
      <LiveText
        className={briefingStyles.muted}
        size="caption"
        tone="muted"
        leading="inherit"
        text={approvals?.length === 0 && unavailable === 0 ? t("No pending approvals found.") : ""}
      />
      {unavailable > 0 && (
        <InlineError>{t("Some approval sources could not be checked. Try again.")}</InlineError>
      )}
      {approvals && approvals.length > 0 && (
        <div {...surfaceAttributes({ dividers: "pane" }, briefingStyles.approvals)}>
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
                <Text as="span" size="inherit" tone="inherit" leading="normal">
                  {target.title} ·{" "}
                  {target.kind === "goal" ? t("Plan approval") : t("Command approval")}
                </Text>
                <Button
                  disabled={!!busy || (target.kind === "goal" ? !onOpenGoal : !onOpenSession)}
                  disabledReason={
                    !busy && (target.kind === "goal" ? !onOpenGoal : !onOpenSession)
                      ? t("This approval cannot be opened here.")
                      : undefined
                  }
                  onClick={() => void run("opening", (guard) => open(target, guard))}
                >
                  {t("Review")}
                </Button>
              </div>
            ))}
        </div>
      )}
      {problem && <InlineError details={problem.details}>{problem.message}</InlineError>}
    </section>
  );
}
