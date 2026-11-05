import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import {
  registerVoiceGenerationRetirement,
  recordVoiceGenerationClosure,
  beginVoiceRuntime,
  associateVoiceGeneration,
  bindVoiceGeneration,
  closeVoiceRuntimeEvidence,
} from "../model/voiceGenerationRetirement";
import { retireNarrationOutput } from "../model/voiceNarrationLifecycle";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Session } from "../../sessions/model/session";
import { sessionsRef as liveSessions, useSession } from "../../sessions/model/sessionsStore";
import { Button } from "../../../shared/ui/Button";
import { useOverlay } from "../../../shared/ui/overlay";
import {
  AppWindow,
  Globe,
  GripVertical,
  Minimize2,
  Maximize2,
  MessageSquare,
  MessageMultiple,
  Mic,
  MicOff,
  Square,
  VolumeX,
  Volume2,
  Pause,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { invalidateFeatureHosts } from "../../connections/model/hostFeatureClient";
import { useVoiceSessionProgress } from "../model/voiceSessionProgress";
import { VoiceToolActivity, type VoiceToolActivityEntry } from "../model/voiceToolActivity";
import { VoiceToolActivityPanel } from "./VoiceToolActivityPanel";
import { useVoicePushToTalk } from "./useVoicePushToTalk";
import {
  useAssistantControlSource,
  waitForAssistantControlSource,
} from "../../assistant/model/useAssistantControlSource";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { elapsedSince } from "../../../shared/lib/time/timestamps";
import { LocalVoice, type SpeechBinding } from "../model/localVoice";
import {
  useVoicePresence,
  readNativeVoicePresence,
  deriveCapturePresence,
} from "../model/voicePresence";
import { shouldSilentlyAcknowledgeVoice, shouldWaitForVoice } from "../model/voiceSpeechPolicy";
import { classifyVoiceFailure, VOICE_RECONNECT_DELAYS } from "../model/voiceReconnect";
import { RealtimeVoice } from "../model/realtimeVoice";
import { realtimeSecret, type RealtimeProvider } from "../model/realtimeVoiceClient";
import {
  converseWithSession,
  warmVoiceReply,
  immediateVoiceDecision,
} from "../model/voiceConversation";
import { clampVoicePosition, voiceContext, voiceTarget } from "../model/voiceSession";
import styles from "./VoiceCompanion.module.css";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
} from "../model/voiceSettings";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { VoiceOptionsMenu, VoiceSessionPicker } from "./VoicePanelChoices";
import { VoiceTurnControl } from "./VoiceTurnControl";
import { saveVoiceTurnEndChoice, VOICE_TURN_CHOICE_FAILED } from "../model/voiceTurnPolicy";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { createVoiceController } from "../model/voiceController";
import { converseWithAssistant } from "../model/voiceAssistant";
import { voiceTools } from "../model/realtimeVoice";
import type { VoiceWorkspaceProject } from "../model/voiceWorkspaceActions";
import type { useVoiceWorkspaceActions } from "../../../app/workspace/bridges/useVoiceWorkspaceActions";
import { voiceVisualState } from "../model/voiceVisualState";
import { voiceWorkText } from "../model/voiceWork";
import {
  closeVoiceOverlay,
  hasNativeWindows,
  openVoiceOverlay,
  pointerOutsideWindow,
  voiceSummaryLine,
  VOICE_OVERLAY_COMPACT_SIZE,
  VOICE_OVERLAY_EXPANDED_WIDTH,
  type VoiceOverlayCommand,
  type VoiceOverlayPlacement,
} from "../model/voiceOverlay";
import { useVoiceOverlayHost } from "./useVoiceOverlayHost";
import { voiceOwnerInstructions } from "../model/voiceOwner";
import {
  forgetHostVoiceMemory,
  rememberHostVoiceMemory,
  ownerAskedToForget,
} from "../model/voiceHostMemory";
import {
  assistantIdentity,
  assistantRequest,
  useAssistantSnapshot,
} from "../../assistant/model/assistantClient";
import { voiceLanguageCode } from "../model/voiceLanguage";
import { VoiceThreadTranscript, voiceThreadSeed, voiceThreadSummary } from "../model/voiceThreads";
import { VoiceCausalGeneration, VoiceContextScopeUnavailable } from "../model/voiceCausalContext";
import {
  VoiceHistoryBindings,
  type VoiceHistory,
  type VoiceHistoryBinding,
} from "../model/voiceHistory";
import {
  captureVoiceHistorySession,
  captureLocalVoiceHistory,
} from "../model/voiceHistoryTransport";
import { persistVoiceOwnerChoice, VoiceOwnerChoicePending } from "../model/voiceOwnerChoice";
import { ownerQuestionDraftScope } from "../../assistant/model/assistantOwnerQuestions";
import { resolveQuestionDraft } from "../../sessions/model/questionDrafts";
import {
  captureVoiceHistoryScope,
  projectVoiceHistory,
  voiceHistoryMessageVisible,
  type VoiceHistoryScope,
} from "../model/voiceHistoryPrivacy";
import { claimVoiceConversationActivity } from "../model/voiceActivity";
import { captureVoiceOwnerRule, VoiceOwnerRuleWrites } from "../model/voiceOwnerRules";
import {
  VoiceAssistantControls,
  VOICE_ASSISTANT_CONTROL_TOOLS,
  voiceOwnerRequestedStopAll,
  voiceOwnerPresenceIntent,
} from "../model/voiceAssistantControls";
import { VoiceSpokenLanguageWrites } from "../model/voiceSpokenLanguage";
import { loadVoiceMemory } from "../model/voiceMemory";
import {
  parseVoiceChoice,
  spokenVoiceChoice,
  validVoiceChoiceReply,
  type VoiceChoice,
} from "../model/voiceChoices";
import { VoiceChoiceCard } from "./VoiceChoiceCard";
import { VoiceJobReview } from "./VoiceJobReview";
import {
  VoiceJobBatch,
  VoiceJobDraftsSchema,
  resolveVoiceJobDraft,
  changeVoiceJobRows,
  type VoiceJobDraft,
  type VoiceJobReviewState,
} from "../model/voiceJobs";
import { captureAssistantHostRead } from "../../assistant/model/assistantHostRead";
import { voiceAssistantControlChoice } from "../model/voiceAssistantControlChoice";
import {
  assistantJobProjectIds,
  assistantJobVisible,
  assistantJobDraftVisible,
} from "../../assistant/model/assistantJobs";
import { pathKey } from "../../../shared/lib/paths";
import {
  isProjectLocked,
  subscribeGroupLock,
  getGroupLockView,
} from "../../group-lock/model/groupLock";
import { useVoiceBriefing } from "./useVoiceBriefing";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";

/** Cloud speech-to-speech providers, signed in through Grok Build or Codex. */
const REALTIME: Record<"grok" | "openai", { provider: RealtimeProvider; name: string }> = {
  grok: { provider: "xai", name: "Grok Voice" },
  openai: { provider: "openai", name: "OpenAI Realtime" },
};

type SpeechTarget = {
  sessionId?: string;
  projectPath: string;
  globalScope?: boolean;
  projectPaths?: readonly string[];
  historyBinding?: VoiceHistoryBinding;
  historySessionId?: string;
};
// LocalVoice copies bindings while recognition is pending; carry the immutable
// onset target with that copy without changing the accepted-turn owner yet.
const speechTarget = Symbol("voiceSpeechTarget");
type CapturedSpeechBinding = SpeechBinding & { [speechTarget]: SpeechTarget };

/** Host RPC rejections arrive as strings; keep their reason instead of a generic fallback. */
function voiceError(cause: unknown, fallback: string): string {
  const message = cause == null ? "" : errorText(cause).trim();
  return t(message && message !== "[object Object]" ? message : fallback);
}
export type VoiceCompanionProps = {
  activeId?: string;
  sessions: Session[];
  onSubmit: (sessionId: string, text: string) => boolean | Promise<boolean>;
  onStop: (sessionId: string) => void;
  workspace?: ReturnType<typeof useVoiceWorkspaceActions>;
  projects?: readonly VoiceWorkspaceProject[];
  projectPath?: string;
  ensureToolSession?: (projectPath: string) => Promise<string>;
  assistantSession?: Session;
};
export function VoiceCompanion(props: VoiceCompanionProps) {
  const locale = useLocale();
  useSyncExternalStore(subscribeGroupLock, getGroupLockView);
  const { snapshot: assistantSnapshot } = useAssistantSnapshot();
  const snapshotRef = useRef(assistantSnapshot);
  snapshotRef.current = assistantSnapshot;
  const identity = assistantIdentity(assistantSnapshot?.profile, locale);
  const ownerInstructions = () => voiceOwnerInstructions(snapshotRef.current);
  const languageLock = assistantSnapshot?.profile.language ?? "auto";
  const settings = useVoiceSettings();
  const [playback, setPlayback] = useState(false);
  // The visualizer reads this ref; audio frames never schedule React renders.
  const audioLevel = useRef(0);
  const latest = useRef(props);
  const [open, setOpen] = useState(false);
  // First launch offers persona setup until the owner saves or skips it.
  const [status, setStatus] = useState<
    "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready"
  >("idle");
  const conversationActive =
    status === "connecting" || status === "reconnecting" || status === "live" || playback;
  useEffect(
    () => (conversationActive ? claimVoiceConversationActivity() : undefined),
    [conversationActive],
  );
  const [phase, setPhase] = useState<"listening" | "speaking" | "transcribing" | "replying">(
    "listening",
  );
  const [pinned, setPinned] = useState<string | null>(null);
  const [globalScope, setGlobalScope] = useState(() => {
    try {
      const saved = localStorage.getItem("bycoda.voice.scope");
      if (saved === "global") return true;
      if (saved === "project" || saved === "session") return false;
      return Boolean(props.workspace);
    } catch {
      return Boolean(props.workspace);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("bycoda.voice.scope", globalScope ? "global" : "project");
    } catch {
      /* Keep the live selection. */
    }
  }, [globalScope]);
  const scopeRef = useRef(globalScope);
  scopeRef.current = globalScope;
  const turnSessionId = useRef<string | undefined>(undefined);
  const turnProjectPath = useRef("");
  const turnAllowedProjectPaths = useRef<readonly string[]>([]);
  const turnGlobalScope = useRef(globalScope);
  const turnCaptured = useRef(false);
  const turnRevision = useRef(0);
  const pinnedRef = useRef(pinned);
  useLayoutEffect(() => {
    latest.current = props;
    pinnedRef.current = pinned;
  }, [props, pinned]);
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [toolActivities, setToolActivities] = useState<readonly VoiceToolActivityEntry[]>([]);
  const toolActivity = useRef<VoiceToolActivity | null>(null);
  if (!toolActivity.current) toolActivity.current = new VoiceToolActivity(setToolActivities);
  const speakerMutedRef = useRef(false);
  const briefingAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pushToTalkHeld = useRef(false);
  const [hearingInput, setHearingInput] = useState(false);
  useEffect(() => {
    if (status !== "live" || muted) {
      setHearingInput(false);
      return;
    }
    const timer = setInterval(() => setHearingInput(audioLevel.current > 0.04), 120);
    return () => clearInterval(timer);
  }, [status, muted]);
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const ownerSpeech = useRef("");
  const spokenLanguage = useRef<VoiceSpokenLanguageWrites | null>(null);
  if (!spokenLanguage.current)
    spokenLanguage.current = new VoiceSpokenLanguageWrites(assistantRequest);
  const controlProjects = useRef(new Map<string, string>());
  const assistantControls = useRef<VoiceAssistantControls | null>(null);
  if (!assistantControls.current)
    assistantControls.current = new VoiceAssistantControls({
      request: assistantRequest,
      captureRequest: async () => {
        const owner = await captureAssistantHostRead();
        return (input) => assistantRequest(input, owner.environmentId);
      },
      allowedProjectIds: async () => {
        const capturedPaths = turnCaptured.current
          ? [...turnAllowedProjectPaths.current]
          : [...(currentSpeechTarget().projectPaths ?? [])];
        const global = turnCaptured.current
          ? turnGlobalScope.current && scopeRef.current
          : scopeRef.current;
        const path = turnCaptured.current
          ? turnProjectPath.current
          : currentSpeechTarget().projectPath;
        const response = await assistantRequest({ op: "projects.list" });
        const visible =
          latest.current.projects ??
          latest.current.sessions.map((session) => ({ path: session.cwd }));
        const projects = (response.projects ?? []).filter(
          (project) =>
            capturedPaths.some((path) => pathKey(path) === pathKey(project.path)) &&
            !isProjectLocked(project.path) &&
            visible.some((item) => pathKey(item.path) === pathKey(project.path)) &&
            (global || pathKey(project.path) === pathKey(path)),
        );
        controlProjects.current = new Map(projects.map((project) => [project.id, project.name]));
        return new Set(projects.map((project) => project.id));
      },
      confirm: async (target) => {
        const ids = target.projectIds ?? (target.projectId ? [target.projectId] : []),
          names = ids.map((id) => controlProjects.current.get(id));
        const input = voiceAssistantControlChoice(target, names);
        if (!input) return false;
        const result = (await realtimeTool(
          "present_choices",
          input,
          generation.current,
        )) as UserQuestionReply;
        return result?.kind === "answered" && result.answers.choice?.includes("confirm") === true;
      },
    });
  const ownerRuleWrites = useRef<VoiceOwnerRuleWrites | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseChoice();
    };
  }, []);
  if (!ownerRuleWrites.current)
    ownerRuleWrites.current = new VoiceOwnerRuleWrites(assistantRequest);
  const [ruleNotice, setRuleNotice] = useState(() =>
    ownerRuleWrites.current!.hasPending ? t("Rule save is pending. Retry.") : "",
  );
  const [savingRule, setSavingRule] = useState(false);
  async function saveOwnerRule(text?: string) {
    const epoch = generation.current;
    setSavingRule(true);
    try {
      const intent = text ? captureVoiceOwnerRule(text) : undefined;
      const result = await (intent
        ? ownerRuleWrites.current!.capture(intent)
        : ownerRuleWrites.current!.retry());
      if (!mounted.current) return;
      const message = result.saved
        ? t(
            result.manualTurnEnd
              ? "Your rule was saved. Choose Finish turn when you are done speaking."
              : "Your rule was saved.",
          )
        : t(result.error ?? "Memory could not be changed.");
      const canReply = generation.current === epoch && Boolean(client.current);
      setRuleNotice(result.saved && canReply ? "" : message);
      if (canReply) reply(message);
    } catch {
      if (mounted.current) setRuleNotice(t("Rule save is pending. Retry."));
    } finally {
      if (mounted.current) setSavingRule(false);
    }
  }
  function consumeOwnerRule(text: string) {
    const ownerName = snapshotRef.current?.profile.name ?? "",
      presenceIntent = voiceOwnerPresenceIntent(text, ownerName);
    if (presenceIntent) {
      const epoch = generation.current,
        revision = turnRevision.current;
      setTranscript(text);
      void causalGeneration.current?.invalidate("unverified-tool");
      void assistantControls
        .current!.call(
          "assistant_presence",
          {},
          { key: `${epoch}:${revision}`, utterance: text, assistantName: ownerName },
          () => generation.current === epoch && turnRevision.current === revision,
        )
        .then(() => {
          manualPresenceCapture.current = false;
          if (generation.current === epoch && turnRevision.current === revision)
            reply(
              t("Availability: {p0}", {
                p0: t(
                  presenceIntent === "away"
                    ? "Away"
                    : presenceIntent === "dnd"
                      ? "Do not disturb"
                      : "Here",
                ),
              }),
            );
        })
        .catch(() => {
          manualPresenceCapture.current = false;
          if (generation.current === epoch) setError(t("Availability change was not confirmed."));
        });
      return true;
    }
    if (voiceOwnerRequestedStopAll(text)) {
      void causalGeneration.current?.invalidate("unverified-tool");
      const epoch = generation.current,
        revision = turnRevision.current;
      cancelJobReview();
      releaseChoice();
      void assistantControls
        .current!.call(
          "assistant_stop_all",
          {},
          { key: `${epoch}:${revision}`, utterance: text },
          () => generation.current === epoch && turnRevision.current === revision,
        )
        .then(() => {
          if (generation.current === epoch && turnRevision.current === revision)
            reply(t("Stop requested. Assistant work is paused."));
        })
        .catch((cause) => {
          if (generation.current === epoch)
            setError(voiceError(cause, "The stop request could not be confirmed. Check the Room."));
        });
      return true;
    }
    if (!captureVoiceOwnerRule(text)) return false;
    setTranscript(text);
    void saveOwnerRule(text);
    return true;
  }
  async function forgetOwnerMemory(
    id: unknown,
    quote: string,
    epoch: number,
    active: () => boolean,
  ) {
    if (!loadVoiceMemory().enabled)
      return { forgotten: false, error: "Memory is turned off in Settings." };
    if (!ownerAskedToForget(quote))
      return { forgotten: false, error: "Choose the exact memory to forget and confirm it." };
    const found = await assistantRequest({ op: "memory.search", query: "", limit: 100 });
    const value = found.entries?.find((entry) => entry.id === id);
    const entry = value ? { ...value } : undefined;
    if (!entry || entry.text.length > 600)
      return { forgotten: false, error: "Review this memory in the Room before deleting it." };
    if (generation.current !== epoch || !active())
      return { forgotten: false, error: "The spoken request is no longer active." };
    const answer = (await realtimeTool(
      "present_choices",
      {
        question: t("Forget {p0}?", { p0: entry.text }),
        kind: "confirm",
        allowCustom: false,
        timeoutSec: 60,
        options: [
          { id: "confirm", label: t("Forget") },
          { id: "cancel", label: t("Cancel") },
        ],
      },
      epoch,
      active,
    )) as UserQuestionReply;
    if (answer?.kind !== "answered" || !answer.answers.choice?.includes("confirm"))
      return { forgotten: false, error: "The memory was kept." };
    if (generation.current !== epoch || !active())
      return { forgotten: false, error: "The spoken request is no longer active." };
    return forgetHostVoiceMemory(id, assistantRequest, quote, {
      version: entry.version,
      text: entry.text,
    });
  }
  const [historyNotice, setHistoryNotice] = useState("");
  const [choice, setChoice] = useState<VoiceChoice | null>(null);
  const [jobReview, setJobReview] = useState<VoiceJobReviewState | null>(null);
  const compact = settings.compact && !choice && !jobReview;
  const pendingJobs = useRef<{
    review: VoiceJobReviewState;
    environmentId: string;
    batch: VoiceJobBatch;
    resolve: (value: unknown) => void;
    released?: boolean;
  } | null>(null);
  function changeJobReview(rows: VoiceJobDraft[]) {
    const pending = pendingJobs.current;
    if (!pending || pending.review.busy || pending.review.accepted.length || pending.review.error)
      return false;
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row !== "object") ||
      rows.length !== pending.review.jobs.length ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      return false;
    const next = changeVoiceJobRows(
      pending.review.jobs,
      rows,
      pending.review.projects,
      pending.review.quickNotes === true,
      pending.review.quickAutomations === true,
    );
    if (!next) return false;
    pending.review = { ...pending.review, jobs: next };
    setJobReview(pending.review);
    return true;
  }
  function cancelJobReview() {
    const pending = pendingJobs.current;
    if (!pending || pending.review.busy) return;
    pending.resolve({
      status: "cancelled",
      jobs: pending.batch.accepted
        .filter((job) =>
          assistantJobVisible(job, (id) => {
            const project = pending.review.projects.find((project) => project.id === id);
            return (
              !!project &&
              !isProjectLocked(project.path) &&
              (
                latest.current.projects ?? [
                  { path: currentTarget()?.cwd ?? latest.current.projectPath ?? "" },
                ]
              ).some((visible) => pathKey(visible.path) === pathKey(project.path))
            );
          }),
        )
        .map((job) => ({ id: job.id, title: job.title, status: job.status })),
    });
    pendingJobs.current = null;
    setJobReview(null);
  }
  async function startReviewedJobs(rows: VoiceJobDraft[]) {
    const pending = pendingJobs.current;
    if (!pending || pending.review.busy) return;
    if (!pending.review.error && !pending.review.accepted.length) {
      if (!changeJobReview(rows)) return;
    } else if (JSON.stringify(rows) !== JSON.stringify(pending.review.jobs)) return;
    pending.review = { ...pending.review, busy: true, error: "" };
    setJobReview(pending.review);
    try {
      const verified = await assistantRequest({ op: "projects.list" }, pending.environmentId);
      if (pending.review.jobs.some((row) => row.kind === "quick")) {
        const current = await assistantRequest(
          { op: "snapshot", limit: 100 },
          pending.environmentId,
        );
        if (
          pending.review.jobs.some(
            (row) => row.kind === "quick" && row.quickAction?.kind === "note",
          ) &&
          current.snapshot?.capabilities.quickNotes !== true
        )
          throw new Error("Quick note jobs are unavailable on this Host.");
        if (
          pending.review.jobs.some(
            (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
          ) &&
          current.snapshot?.capabilities.quickAutomations !== true
        )
          throw new Error("Quick automation jobs are unavailable for this project.");
      }
      for (const row of pending.review.jobs)
        for (const id of assistantJobProjectIds(row)) {
          const project = verified.projects?.find((project) => project.id === id);
          if (
            !project ||
            !pending.review.projects.some(
              (captured) => captured.id === id && pathKey(captured.path) === pathKey(project.path),
            ) ||
            isProjectLocked(project.path) ||
            (!scopeRef.current &&
              pathKey(project.path) !==
                pathKey(currentTarget()?.cwd ?? latest.current.projectPath ?? "")) ||
            !(
              latest.current.projects ?? [
                { path: currentTarget()?.cwd ?? latest.current.projectPath ?? "" },
              ]
            ).some((visible) => pathKey(visible.path) === pathKey(project.path))
          )
            throw new Error("The project is hidden, locked or no longer available.");
        }
      const jobs = await pending.batch.start(pending.review.jobs);
      if (pendingJobs.current !== pending) return;
      if (
        !jobs.every((job) =>
          assistantJobVisible(job, (id) => {
            const project = pending.review.projects.find((project) => project.id === id);
            return (
              !!project &&
              !isProjectLocked(project.path) &&
              (
                latest.current.projects ?? [
                  { path: currentTarget()?.cwd ?? latest.current.projectPath ?? "" },
                ]
              ).some((visible) => pathKey(visible.path) === pathKey(project.path))
            );
          }),
        )
      )
        throw new Error("The project is hidden, locked or no longer available.");
      const receipt = {
        status: "accepted",
        jobs: jobs.map((job) => ({ id: job.id, title: job.title, status: job.status })),
      };
      pending.resolve(receipt);
      pendingJobs.current = null;
      setJobReview(null);
      if (pending.released)
        client.current?.speak(
          t("{p0} personal notes saved. {p1} automations created. {p2} project jobs accepted.", {
            p0: jobs.filter(
              (job) => job.kind === "quick" && job.status === "done" && job.quickResult?.noteId,
            ).length,
            p1: jobs.filter(
              (job) =>
                job.kind === "quick" && job.status === "done" && job.quickResult?.automationId,
            ).length,
            p2: jobs.filter((job) => job.kind !== "quick").length,
          }),
        );
    } catch (cause) {
      if (pendingJobs.current === pending) {
        pending.review = {
          ...pending.review,
          busy: false,
          error: voiceError(cause, "Job status is unknown. Check the Room before retrying."),
          accepted: pending.batch.accepted.map((job) => job.id),
        };
        setJobReview(pending.review);
      }
    }
  }
  const pendingChoice = useRef<{
    choice: VoiceChoice;
    resolve: (value: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    owner?: NonNullable<Awaited<ReturnType<typeof persistVoiceOwnerChoice>>>;
    presentation?: VoiceOwnerChoicePending;
    answering?: boolean;
  } | null>(null);
  const preparingChoice = useRef(false);
  const transcriptStore = useRef<VoiceThreadTranscript | null>(null);
  if (!transcriptStore.current)
    transcriptStore.current = new VoiceThreadTranscript(assistantRequest, () =>
      setError(t("Conversation was not saved. Retry.")),
    );
  function answerChoice(reply: UserQuestionReply) {
    const pending = pendingChoice.current;
    if (!pending || pending.presentation || !validVoiceChoiceReply(pending.choice, reply)) return;
    if (pending.owner) {
      if (pending.answering) return;
      pending.answering = true;
      clearTimeout(pending.timer);
      setChoice({ ...pending.choice, prompt: { ...pending.choice.prompt, delivery: "sending" } });
      void pending.owner
        .answer(reply)
        .then((result) => {
          if (pendingChoice.current !== pending) return;
          pendingChoice.current = null;
          setChoice(null);
          const source = pending.choice.ownerQuestion!;
          resolveQuestionDraft(
            ownerQuestionDraftScope(source.environmentId, source.question),
            pending.choice.prompt,
          );
          if (reply.kind === "answered" && client.current instanceof RealtimeVoice)
            client.current.resumeAfterOwnerAnswer();
          pending.resolve(result.reply);
        })
        .catch((cause) => {
          if (pendingChoice.current === pending) {
            pending.answering = false;
            setChoice({
              ...pending.choice,
              prompt: {
                ...pending.choice.prompt,
                delivery: "unknown",
                error: voiceError(
                  cause,
                  "The answer is unconfirmed. Your original choice is kept.",
                ),
              },
            });
          }
        });
      return;
    }
    clearTimeout(pending.timer);
    pendingChoice.current = null;
    setChoice(null);
    if (reply.kind === "answered") {
      const question = pending.choice.prompt.questions[0];
      const labels = (reply.answers.choice ?? [])
        .map((id) => question.options.find((option) => option.id === id)?.label ?? "")
        .filter(Boolean);
      if (reply.custom?.choice) labels.push(reply.custom.choice);
      transcriptStore.current?.record("user", `${question.prompt}\n${labels.join(", ")}`);
      transcriptStore.current?.finish();
      if (client.current instanceof RealtimeVoice) client.current.resumeAfterOwnerAnswer();
    }
    pending.resolve(reply);
  }
  async function retryChoice() {
    const pending = pendingChoice.current;
    if (!pending || pending.answering) return;
    pending.answering = true;
    clearTimeout(pending.timer);
    setChoice({ ...pending.choice, prompt: { ...pending.choice.prompt, delivery: "sending" } });
    try {
      if (pending.presentation) {
        const owner = await pending.presentation.retry();
        if (pendingChoice.current !== pending) return;
        if (owner.question.status === "answered") {
          pendingChoice.current = null;
          setChoice(null);
          pending.resolve(owner.answeredReply());
          return;
        }
        if (owner.question.status !== "open") {
          pendingChoice.current = null;
          setChoice(null);
          pending.resolve(owner.deferred());
          return;
        }
        pending.owner = owner;
        pending.presentation = undefined;
        pending.choice = owner.choice;
        pending.answering = false;
        pending.timer = setTimeout(releaseChoice, owner.choice.timeoutSec * 1000);
        setChoice(owner.choice);
        return;
      }
      if (pending.owner) {
        const result = await pending.owner.retryAnswer();
        if (pendingChoice.current !== pending) return;
        const source = pending.choice.ownerQuestion!;
        resolveQuestionDraft(
          ownerQuestionDraftScope(source.environmentId, source.question),
          pending.choice.prompt,
        );
        pendingChoice.current = null;
        setChoice(null);
        if (client.current instanceof RealtimeVoice) client.current.resumeAfterOwnerAnswer();
        pending.resolve(result.reply);
      }
    } catch (cause) {
      if (pendingChoice.current === pending) {
        pending.answering = false;
        if (cause instanceof VoiceOwnerChoicePending) pending.presentation = cause;
        setChoice({
          ...pending.choice,
          prompt: {
            ...pending.choice.prompt,
            delivery: "unknown",
            error: t(
              pending.presentation
                ? "Saving this question is unconfirmed. Retry to verify the original card."
                : "The answer is unconfirmed. Your original choice is kept.",
            ),
          },
        });
      }
    }
  }
  function releaseChoice() {
    const pending = pendingChoice.current;
    if (!pending) return;
    if (pending.presentation) {
      clearTimeout(pending.timer);
      pendingChoice.current = null;
      setChoice(null);
      pending.resolve(pending.presentation.deferred());
      return;
    }
    if (!pending.owner) {
      answerChoice({ kind: "skipped" });
      return;
    }
    clearTimeout(pending.timer);
    pendingChoice.current = null;
    setChoice(null);
    pending.resolve(pending.owner.deferred());
  }
  function consumeChoice(text: string) {
    if (pendingJobs.current) {
      const input = text
        .trim()
        .toLocaleLowerCase()
        .replace(/[.!?]+$/g, "");
      if (/^(start jobs|start them|başlat|işleri başlat|başla)$/.test(input)) {
        rememberTurn("user", text);
        void startReviewedJobs(pendingJobs.current.review.jobs);
        return true;
      }
      if (/^(cancel review|cancel|iptal)$/.test(input)) {
        rememberTurn("user", text);
        cancelJobReview();
        return true;
      }
      pendingJobs.current.released = true;
      pendingJobs.current.resolve({
        status: "awaiting_review",
        reviewId: pendingJobs.current.review.id,
      });
    }
    const pending = pendingChoice.current;
    if (!pending) return false;
    if (pending.presentation) {
      releaseChoice();
      return false;
    }
    const answer = spokenVoiceChoice(pending.choice, text);
    if (!answer) {
      releaseChoice();
      return false;
    }
    rememberTurn("user", text);
    answerChoice(answer);
    return true;
  }
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  // The session stays here; `detached` only moves its controls to a native
  // always-on-top window that can float over other applications.
  const [detached, setDetached] = useState(false);
  const [detaching, setDetachingState] = useState(false);
  const detachingRef = useRef(false);
  function setDetaching(value: boolean) {
    if (detachingRef.current === value) return;
    detachingRef.current = value;
    setDetachingState(value);
  }
  const canDetach = hasNativeWindows();
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const compactToggle = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open && panel.current?.contains(document.activeElement)) compactToggle.current?.focus();
  }, [compact]);
  const returnFocus = useRef(false);
  const client = useRef<LocalVoice | RealtimeVoice | null>(null);
  const ownerKey = JSON.stringify({
    profile: assistantSnapshot?.profile,
    memory: assistantSnapshot?.memory,
  });
  useEffect(() => {
    if (client.current instanceof RealtimeVoice)
      client.current.updateOwnerInstructions?.(ownerInstructions());
  }, [ownerKey]);
  useEffect(() => {
    const options = {
      turnEndSilence: settings.turnEndSilence,
      allowBargeIn: settings.allowBargeIn,
      manualTurnEnd: settings.manualTurnEnd,
    };
    if (client.current instanceof RealtimeVoice) {
      const configured = client.current.configureConversation({
        ...options,
        experimentalSemanticVad:
          settings.mode === "openai" &&
          settings.manualTurnEnd !== true &&
          settings.experimentalSemanticVad === true,
      });
      if (configured === false) {
        close();
        setError(t("Voice settings changed. Reconnect voice to apply."));
      }
    } else client.current?.configureConversation(options);
  }, [
    settings.turnEndSilence,
    settings.allowBargeIn,
    settings.manualTurnEnd,
    settings.mode,
    settings.experimentalSemanticVad,
  ]);
  const detectedPresence = useVoicePresence(open, settings.idleSleepMinutes);
  const [lastAdmittedSpeechAt, setLastAdmittedSpeechAt] = useState<number | null>(null);
  const markAdmittedSpeech = useCallback(() => {
    setLastAdmittedSpeechAt(Date.now());
  }, []);
  const lastDeliveredAssistant = useRef("");
  const playbackRef = useRef(playback);
  useLayoutEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  useEffect(() => {
    if (lastAdmittedSpeechAt === null) return;
    const remaining = lastAdmittedSpeechAt + settings.idleSleepMinutes * 60_000 - Date.now();
    const timer = setTimeout(() => setLastAdmittedSpeechAt(null), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [lastAdmittedSpeechAt, settings.idleSleepMinutes]);
  const manualPresenceCapture = useRef(false),
    checkingTalkPresence = useRef(false);
  const presence =
    assistantSnapshot?.presence?.state === "away" || assistantSnapshot?.presence?.state === "dnd"
      ? "away"
      : detectedPresence;
  const capturePresence = deriveCapturePresence(
    detectedPresence,
    manualPresenceCapture.current && detectedPresence === "active"
      ? undefined
      : assistantSnapshot?.presence?.state,
    lastAdmittedSpeechAt,
    settings.idleSleepMinutes,
  );
  const presenceRef = useRef(capturePresence);
  presenceRef.current = capturePresence;
  const briefingRetry = useVoiceBriefing({ snapshot: assistantSnapshot, owner: ownerKey,
    session: JSON.stringify([props.activeId, props.assistantSession?.id]), presence, status, phase, muted, speakerMuted,
    hold: settings.holdAnnouncements === true, playback: playbackRef, pendingChoice, pendingJobs,
    abort: briefingAbort, generation, setPlayback, setMessage, setError,
    formatError: (cause) => voiceError(cause, "Voice could not connect.") });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryCount = useRef(0);
  const stableTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recentTurns = useRef<
    { role: "user" | "assistant"; text: string; projectIds?: readonly string[] }[]
  >([]);
  const causalGeneration = useRef<VoiceCausalGeneration | undefined>(undefined);
  const narrationAbort = useRef<AbortController | null>(null);
  const narrationPlayback = useRef<Promise<unknown> | null>(null);
  const narrationClosure = useRef<Promise<void>>(Promise.resolve());
  const retirementKeys = useRef(new Map<RealtimeVoice | LocalVoice, Set<string>>());
  function closeVoiceRuntime() {
    const runtime = client.current;
    narrationAbort.current?.abort();
    const narration = narrationPlayback.current;
    runtime?.close();
    client.current = null;
    if (runtime) {
      const keys = retirementKeys.current.get(runtime);
      const closure = retireNarrationOutput(narrationAbort.current, narration, () =>
        runtime.retire(),
      );
      narrationClosure.current = closure;
      closeVoiceRuntimeEvidence(runtime, closure);
      void closure.catch(() => {
        /* Unconfirmed closure remains held. */
      });
      if (keys?.size) {
        for (const key of keys) recordVoiceGenerationClosure(key, closure);
        retirementKeys.current.delete(runtime);
      }
    }
  }
  function retainCausalGeneration(value: VoiceCausalGeneration) {
    const runtime = client.current;
    if (!runtime) throw new Error("The voice provider generation is unavailable.");
    registerVoiceGenerationRetirement(
      value.generationKey,
      () => value.retirementIdentity(),
      async () => {
        if (client.current === runtime) {
          close();
          await narrationClosure.current;
        } else {
          runtime.close();
          await runtime.retire();
        }
      },
      () => client.current === runtime && runtime.isOutputReady(),
    );
    associateVoiceGeneration(runtime, value.generationKey);
    const keys = retirementKeys.current.get(runtime) ?? new Set<string>();
    keys.add(value.generationKey);
    retirementKeys.current.set(runtime, keys);
    causalGeneration.current = value;
  }
  const activeHistoryBinding = useRef<VoiceHistoryBinding | undefined>(undefined);
  const [managementBinding, setManagementBinding] = useState<VoiceHistoryBinding>();
  const [managementSource, setManagementSource] = useState<{
    threadId: string;
    environmentId: string;
  }>();
  const [narrationGeneration, setNarrationGeneration] = useState<{
    runtime: RealtimeVoice | LocalVoice;
    generationKey: string;
    threadId: string;
    environmentId: string;
  }>();
  useEffect(() => {
    let active = true;
    setManagementSource(undefined);
    if (!managementBinding || managementBinding.remote || status === "idle") return;
    void Promise.all([managementBinding.open(), managementBinding.environmentId?.()])
      .then(([history, environmentId]) => {
        if (active && environmentId && managementBinding.current?.() !== false)
          setManagementSource({ threadId: history.thread.id, environmentId });
      })
      .catch(() => {
        // History/operation feedback owns unavailable-source recovery.
      });
    return () => {
      active = false;
    };
  }, [managementBinding, status === "idle"]);
  const managementCurrent = status !== "idle" && managementBinding?.current?.() !== false;
  useAssistantControlSource(
    managementCurrent ? managementSource?.threadId : undefined,
    managementCurrent ? managementSource?.environmentId : undefined,
  );
  const threadSummary = useRef("");
  const turnHistory = useRef<Promise<VoiceHistory | null> | undefined>(undefined);
  const historyBindings = useRef<VoiceHistoryBindings | null>(null);
  if (!historyBindings.current)
    historyBindings.current = new VoiceHistoryBindings(
      assistantRequest,
      undefined,
      captureLocalVoiceHistory,
    );
  function rememberTurn(role: "user" | "assistant", text: string, append = false) {
    if (role === "user") markAdmittedSpeech();
    transcriptStore.current?.record(
      role,
      text,
      append,
      role === "assistant" ? causalGeneration.current?.proof() : undefined,
    );
    if (role === "user") transcriptStore.current?.finish();
    const turns = recentTurns.current;
    if (append && turns[turns.length - 1]?.role === role) turns[turns.length - 1].text += text;
    else {
      const entry: { role: "user" | "assistant"; text: string; projectIds?: readonly string[] } = {
        role,
        text,
      };
      turns.push(entry);
      void activeHistoryBinding.current
        ?.scope?.()
        .then((scope) => {
          if (scope.complete) entry.projectIds = scope.projectIds;
        })
        .catch(() => {});
    }
    recentTurns.current = turns.slice(-6);
    for (const turn of recentTurns.current) turn.text = turn.text.slice(-4000);
  }
  const realtime = settings.mode === "local" ? undefined : REALTIME[settings.mode];
  useEffect(() => {
    setNarrationGeneration(undefined);
    const runtime = client.current;
    const source = managementSource;
    const history = activeHistoryBinding.current;
    if (status !== "live" || !runtime || !source || !history || history.remote) return;
    let active = true;
    const generationKey = crypto.randomUUID();
    const current = () =>
      client.current === runtime &&
      activeHistoryBinding.current === history &&
      history.current?.() !== false;
    // Narration belongs to the real connection. It does not invent an owner utterance
    // or open conversational/tool provenance before the owner has spoken.
    registerVoiceGenerationRetirement(
      generationKey,
      () => source,
      async () => {
        if (client.current === runtime) {
          close();
          await narrationClosure.current;
        } else {
          runtime.close();
          await runtime.retire();
        }
      },
      () => current() && runtime.isOutputReady(),
    );
    associateVoiceGeneration(runtime, generationKey);
    const keys = retirementKeys.current.get(runtime) ?? new Set<string>();
    keys.add(generationKey);
    retirementKeys.current.set(runtime, keys);
    void bindVoiceGeneration(generationKey, source)
      .then(() => {
        if (active && current()) setNarrationGeneration({ runtime, generationKey, ...source });
      })
      .catch((cause) => {
        if (active && current()) reportContextFailure(cause);
      });
    return () => {
      active = false;
    };
  }, [managementSource, status]);
  useEffect(() => {
    const source = managementSource;
    const narration = narrationGeneration;
    const runtime = client.current;
    if (
      !source ||
      !narration ||
      !runtime ||
      narration.runtime !== runtime ||
      narration.threadId !== source.threadId ||
      narration.environmentId !== source.environmentId ||
      status !== "live" ||
      !assistantSnapshot?.profile.voiceNarration ||
      presence !== "active" ||
      muted ||
      speakerMuted ||
      settings.holdAnnouncements ||
      phase !== "listening"
    )
      return;
    const abort = new AbortController();
    narrationAbort.current = abort;
    const epoch = generation.current;
    let running = false;
    const current = () =>
      !abort.signal.aborted &&
      generation.current === epoch &&
      client.current === runtime &&
      narration.runtime === runtime &&
      (activeHistoryBinding.current?.current?.() ?? true);
    const pump = async () => {
      if (running || !current() || playbackRef.current) return;
      running = true;
      try {
        const request = (input: Parameters<typeof assistantRequest>[0]) =>
          assistantRequest(input, source.environmentId);
        const pending = await request({
          op: "narration.pending",
          threadId: source.threadId,
          generation: narration.generationKey,
        });
        if (!current()) return;
        const candidate = pending.narrationEvents?.[0];
        if (!candidate) return;
        const claimed = await request({
          op: "narration.claim",
          threadId: source.threadId,
          generation: narration.generationKey,
          eventId: candidate.eventId,
        });
        const event = claimed.narrationEvents?.[0];
        if (!claimed.narrationClaimed || !event) return;
        let played = false;
        if (current()) {
          if (runtime instanceof RealtimeVoice) {
            const output = runtime.speakWithReceipt(event.text, event.eventId, abort.signal);
            narrationPlayback.current = output;
            const receipt = await output;
            if (narrationPlayback.current === output) narrationPlayback.current = null;
            played = receipt.status === "played" && current();
          } else {
            const output = new Promise<boolean>((resolve) => {
              const finish = (result: boolean) => {
                clearTimeout(timer);
                abort.signal.removeEventListener("abort", cancel);
                resolve(result);
              };
              const cancel = () => {
                runtime.silence();
                finish(false);
              };
              const timer = setTimeout(() => finish(false), 60000);
              abort.signal.addEventListener("abort", cancel, { once: true });
              if (!runtime.speak(event.text, false, () => finish(true))) finish(false);
            });
            narrationPlayback.current = output;
            played = await output;
            if (narrationPlayback.current === output) narrationPlayback.current = null;
            played = played && current();
          }
        }
        await request({
          op: "narration.settle",
          threadId: source.threadId,
          generation: narration.generationKey,
          eventId: event.eventId,
          state: played ? "delivered" : "unknown",
        });
      } catch {
        // Pending receipts remain durable and are never replayed after an unknown outcome.
      } finally {
        running = false;
      }
    };
    void pump().catch(() => {});
    const timer = setInterval(() => void pump().catch(() => {}), 15000);
    return () => {
      abort.abort();
      if (narrationAbort.current === abort) narrationAbort.current = null;
      clearInterval(timer);
    };
  }, [
    managementSource,
    narrationGeneration,
    status,
    assistantSnapshot?.profile.voiceNarration,
    presence,
    muted,
    speakerMuted,
    settings.holdAnnouncements,
    phase,
  ]);
  const sequence = useRef(0);
  const consumedSequence = useRef(0);
  const sideRequest = useRef<AbortController | null>(null);
  const history = useRef(
    new Map<string, { role: string; text: string; projectIds?: readonly string[] }[]>(),
  );
  const jobs = useRef(new Map<string, { sawBusy: boolean; assistantId?: string }>());
  const workAttempt = useRef<{
    sessionId: string;
    text: string;
    result: Promise<{ accepted: boolean }>;
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    position?: { x: number; y: number };
  } | null>(null);
  const shellTarget = voiceTarget(props.activeId, pinned, props.sessions);
  const target = useSession(open ? shellTarget?.id : undefined) ?? shellTarget;
  const findSession = (id: string | undefined) =>
    liveSessions.current.find((item) => item.id === id) ??
    latest.current.sessions.find((item) => item.id === id);
  const currentTarget = () => findSession(pinnedRef.current ?? latest.current.activeId);
  const controller = useRef<ReturnType<typeof createVoiceController> | null>(null);
  if (!controller.current)
    controller.current = createVoiceController(() => ({
      getScope: () =>
        (turnCaptured.current ? turnGlobalScope.current && scopeRef.current : scopeRef.current)
          ? "global"
          : "project",
      getProjects: () =>
        (latest.current.projects ?? []).filter(
          (project) =>
            !isProjectLocked(project.path) &&
            (!turnCaptured.current ||
              turnAllowedProjectPaths.current.some(
                (path) => pathKey(path) === pathKey(project.path),
              )) &&
            ((turnCaptured.current
              ? turnGlobalScope.current && scopeRef.current
              : scopeRef.current) ||
              project.path ===
                (turnCaptured.current
                  ? turnProjectPath.current
                  : (currentTarget()?.cwd ?? latest.current.projectPath))),
        ),
      getSessions: () => [
        ...latest.current.sessions.filter(
          (item) => !liveSessions.current.some((live) => live.id === item.id),
        ),
        ...liveSessions.current,
      ],
      getProjectPath: () =>
        turnCaptured.current
          ? turnProjectPath.current
          : (latest.current.projectPath ?? currentTarget()?.cwd ?? ""),
      getTargetId: () => (turnCaptured.current ? turnSessionId.current : currentTarget()?.id),
      getThreadId: () =>
        turnHistory.current?.then((value) => value?.thread.id).catch(() => undefined),
      causalContext: () => causalGeneration.current?.tool() ?? Promise.resolve(undefined),
      invalidateCausalContext: async () => {
        await causalGeneration.current?.invalidate("unverified-tool");
      },
      workspace: latest.current.workspace ?? {
        tools: [],
        execute: async () => {
          throw new Error("Workspace actions are unavailable.");
        },
      },
      ensureToolSession: latest.current.ensureToolSession,
      image: (dataUrl) =>
        client.current instanceof RealtimeVoice
          ? client.current.addImage(dataUrl)
          : { accepted: false, error: "This voice provider cannot inspect images." },
    }));
  function currentSpeechTarget(): SpeechTarget {
    const session = currentTarget();
    const projectPath = session?.cwd ?? latest.current.projectPath ?? "";
    const projectPaths = (
      scopeRef.current
        ? (latest.current.projects?.map((project) => project.path) ?? [projectPath])
        : [projectPath]
    ).filter((path) => path && !isProjectLocked(path));
    return {
      sessionId: session?.id,
      projectPath,
      projectPaths: Object.freeze([...new Set(projectPaths)]),
      globalScope: scopeRef.current,
      historyBinding: captureHistoryBinding(scopeRef.current, projectPath, projectPaths),
      historySessionId: captureVoiceHistorySession(session, projectPath, scopeRef.current),
    };
  }
  function captureHistoryBinding(
    global: boolean,
    path: string,
    paths: readonly string[] = [path],
  ): VoiceHistoryBinding {
    const captured = historyBindings.current!.capture(global, path);
    const frozenPaths = Object.freeze([...new Set(paths)]);
    const visible = () =>
      (latest.current.projects?.map((project) => project.path) ?? frozenPaths).filter(
        (path) => !isProjectLocked(path),
      );
    const allowed = () =>
      frozenPaths.every((path) => visible().some((current) => pathKey(current) === pathKey(path)));
    const assert = () => {
      if (!allowed()) throw new Error("The project is hidden, locked or no longer available.");
    };
    let capturedScope: Promise<VoiceHistoryScope> | undefined;
    const scope = () =>
      (capturedScope ??= captured
        .request({ op: "projects.list" })
        .then((result) => captureVoiceHistoryScope(frozenPaths, result.projects ?? [], visible))
        .catch((error) => {
          capturedScope = undefined;
          throw error;
        }));
    const request: VoiceHistoryBinding["request"] = async (input) => {
      assert();
      const result = await captured.request(input);
      assert();
      if (result.messages) {
        const bound = await scope();
        assert();
        return {
          ...result,
          messages: result.messages.filter((message) => voiceHistoryMessageVisible(message, bound)),
        };
      }
      return result;
    };
    return {
      ...captured,
      request,
      scope,
      current: allowed,
      global,
      open: async () => {
        assert();
        const bound = await scope();
        assert();
        const result = await captured.open();
        assert();
        return { ...projectVoiceHistory(result, global, bound), request, scope: bound };
      },
    };
  }
  function captureTurn(snapshot: SpeechTarget) {
    turnRevision.current++;
    const revision = turnRevision.current;
    const global = snapshot.globalScope ?? scopeRef.current;
    const binding =
      snapshot.historyBinding ??
      captureHistoryBinding(global, snapshot.projectPath, snapshot.projectPaths);
    activeHistoryBinding.current = binding;
    setManagementBinding(binding);
    const selected = binding.open();
    turnHistory.current = selected;
    transcriptStore.current?.bindPending(
      async () => (await binding.open()).thread,
      snapshot.historySessionId,
      binding.request,
    );
    void selected
      .then((value) => {
        if (revision !== turnRevision.current || !value) return;
        setHistoryNotice("");
        threadSummary.current = value.thread.summary;
        const key = global ? "global" : snapshot.projectPath;
        if (!history.current.has(key))
          history.current.set(key, voiceThreadSeed(value.thread, value.messages));
      })
      .catch(() => {
        if (revision === turnRevision.current)
          setHistoryNotice(t("Conversation was not saved. Retry."));
      });
    workAttempt.current = null;
    turnCaptured.current = true;
    turnSessionId.current = snapshot.sessionId;
    turnProjectPath.current = snapshot.projectPath;
    turnAllowedProjectPaths.current = Object.freeze([
      ...(snapshot.projectPaths ?? [snapshot.projectPath]),
    ]);
    turnGlobalScope.current = global;
    if (latest.current.workspace) controller.current!.captureTurn(global ? "global" : "project");
  }
  function submitWork(session: Session, text: string, epoch: number, active: () => boolean) {
    const previous = workAttempt.current;
    if (previous) {
      if (previous.sessionId === session.id && previous.text === text) return previous.result;
      return Promise.resolve({
        accepted: false,
        error:
          "Work was already attempted for this spoken turn. Check the session before retrying.",
      });
    }
    // Store before invoking the callback, including ambiguous failures. Rephrasing
    // or retrying a tool call is not a second user authorization.
    const result = Promise.resolve().then(async () => {
      if (generation.current !== epoch || !active()) return { accepted: false };
      const accepted = await latest.current.onSubmit(session.id, text);
      if (generation.current === epoch && accepted)
        jobs.current.set(session.id, {
          sawBusy: Boolean(session.busy),
          assistantId: session.blocks.filter((block) => block.role === "assistant").slice(-1)[0]
            ?.id,
        });
      return { accepted };
    });
    workAttempt.current = { sessionId: session.id, text, result };
    return result;
  }
  function stopCapture(next: typeof status, preserveDrafts = false) {
    setLastAdmittedSpeechAt(null);
    lastDeliveredAssistant.current = "";
    manualPresenceCapture.current = false;
    checkingTalkPresence.current = false;
    if (!preserveDrafts) {
      cancelJobReview();
      releaseChoice();
    }
    transcriptStore.current?.finish();
    clearTimeout(stableTimer.current);
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    generation.current++;
    turnCaptured.current = false;
    sequence.current++;
    sideRequest.current?.abort();
    sideRequest.current = null;
    closeVoiceRuntime();
    audioLevel.current = 0;
    setPlayback(false);
    setStatus(next);
    setPhase("listening");
  }
  function close() {
    invalidateFeatureHosts();
    setLastAdmittedSpeechAt(null);
    lastDeliveredAssistant.current = "";
    manualPresenceCapture.current = false;
    checkingTalkPresence.current = false;
    cancelJobReview();
    releaseChoice();
    transcriptStore.current?.finish();
    clearTimeout(stableTimer.current);
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    retryCount.current = 0;
    recentTurns.current = [];
    generation.current++;
    turnCaptured.current = false;
    sequence.current++;
    sideRequest.current?.abort();
    sideRequest.current = null;
    closeVoiceRuntime();
    jobs.current.clear();
    history.current.clear();
    setPlayback(false);
    setStatus("idle");
    setMuted(false);
    setMessage("");
    setTranscript("");
    setPhase("listening");
  }
  // Audio configuration owns the connection. Workspace navigation and scope only
  // change the target of future speech; an in-progress utterance retains its capture.
  const connection = JSON.stringify({
    ...(settings.mode === "local" ? voiceRuntimeSettings(settings) : {}),
    mode: settings.mode,
    speaker: settings.mode === "local" ? undefined : settings.speakers[settings.mode],
    language: languageLock,
    microphoneId: settings.microphoneId,
  });
  const connected = useRef(connection);
  useEffect(() => {
    if (connected.current === connection) return;
    connected.current = connection;
    close();
  }, [connection]);
  function dismiss() {
    close();
    returnFocus.current = true;
    setOpen(false);
  }
  useOverlay(panel, false, undefined, open && !detached, undefined, false, true);
  useLayoutEffect(() => {
    // The first-run persona dialog owns focus while it is open.
    if (open)
      (compact
        ? compactToggle.current
        : panel.current?.querySelector<HTMLButtonElement>("[data-voice-start]")
      )?.focus();
    else if (returnFocus.current) {
      launcher.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);
  useEffect(() => {
    // A reloaded page lost the session a floating window was mirroring.
    if (canDetach) void closeVoiceOverlay().catch(() => undefined);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(stableTimer.current);
      clearTimeout(retryTimer.current);
      generation.current++;
      sideRequest.current?.abort();
      transcriptStore.current?.finish();
      closeVoiceRuntime();
    },
    [],
  );
  /** `append` continues a streamed reply after the sentences already shown and queued. */
  function voiceDisclosureCurrent() {
    return activeHistoryBinding.current?.current?.() ?? true;
  }
  function reportContextFailure(cause: unknown) {
    // An incomplete directory limits causal provenance; it is not a failed
    // transcript write. Real source/receipt errors and retry failures stay visible.
    if (cause instanceof VoiceContextScopeUnavailable) return;
    setHistoryNotice(
      voiceError(cause, "The voice question context could not be verified for saving."),
    );
  }
  function interceptSpeech(text: string) {
    if (!voiceDisclosureCurrent()) return true;
    if (shouldWaitForVoice(text)) {
      markAdmittedSpeech();
      if (!pendingChoice.current && !pendingJobs.current) {
        sequence.current++;
        sideRequest.current?.abort();
        sideRequest.current = null;
      }
      if (client.current instanceof RealtimeVoice) client.current.pause();
      else client.current?.silence();
      setPhase("listening");
      setTranscript(text);
      return true;
    }
    if (
      shouldSilentlyAcknowledgeVoice({
        transcript: text,
        lastDeliveredAssistant: lastDeliveredAssistant.current,
        pendingChoice: !!pendingChoice.current || !!pendingJobs.current,
        pendingQuestion: /[?？]\s*$/.test(lastDeliveredAssistant.current),
        speaking: playbackRef.current,
      })
    ) {
      markAdmittedSpeech();
      setTranscript(text);
      return true;
    }
    return false;
  }
  function reply(text: string, session?: Session, append = false, played?: () => void) {
    if (!voiceDisclosureCurrent()) return;
    const epoch = generation.current,
      turn = sequence.current,
      binding = activeHistoryBinding.current;
    const spoken =
      !append && session && currentTarget()?.id !== session.id ? `${session.title}: ${text}` : text;
    setMessage((current) => (append && current ? `${current} ${spoken}` : spoken));
    const delivered = () => {
      if (
        generation.current !== epoch ||
        sequence.current !== turn ||
        activeHistoryBinding.current !== binding ||
        !voiceDisclosureCurrent()
      )
        return;
      lastDeliveredAssistant.current = append ? `${lastDeliveredAssistant.current} ${text}` : text;
      rememberTurn("assistant", text, append);
      transcriptStore.current?.finish();
      played?.();
    };
    const accepted =
      client.current instanceof LocalVoice
        ? client.current.speak(spoken, append, delivered)
        : client.current?.speak(spoken, append);
    if (!accepted && !append)
      setError(t("No local voice is available for this language. The reply is shown here."));
  }
  useEffect(() => {
    for (const [id, job] of jobs.current) {
      if (settings.holdAnnouncements) continue;
      const session = findSession(id);
      if (!session) {
        jobs.current.delete(id);
        continue;
      }
      if (session.busy) job.sawBusy = true;
      const assistant = session.blocks.filter((block) => block.role === "assistant").slice(-1)[0];
      if (
        job.sawBusy &&
        !session.busy &&
        !session.historyLoading &&
        assistant &&
        assistant.id !== job.assistantId &&
        !assistant.streaming
      ) {
        const context = voiceContext(session);
        const last = context.messages
          .filter((block) => block.role === "assistant")
          .slice(-1)[0]?.text;
        // Do not interrupt the user's newer question; results remain in their original session.
        if (phase === "listening" && !sideRequest.current) {
          jobs.current.delete(id);
          reply(`${context.title}: ${t("Agent turn ended.")} ${last?.slice(0, 400) ?? ""}`);
        }
      }
    }
  }, [props.sessions, target, phase]);
  useEffect(() => {
    if (!open) return;
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect();
      if (rect)
        setPosition(
          clampVoicePosition(
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            window.innerWidth,
            window.innerHeight,
          ),
        );
    };
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    const observer = new ResizeObserver(clamp);
    if (panel.current) observer.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [open, detached]);
  async function onSpeech(text: string, binding: SpeechBinding, epoch: number) {
    if (generation.current === epoch) {
      const heldReview = pendingJobs.current;
      if (consumeChoice(text)) return;
      if (heldReview?.released) {
        sequence.current++;
        binding = { ...binding, sequence: sequence.current };
        sideRequest.current?.abort();
        captureTurn((binding as CapturedSpeechBinding)[speechTarget] ?? currentSpeechTarget());
      }
    }
    if (
      generation.current !== epoch ||
      binding.sequence !== sequence.current ||
      binding.sequence <= consumedSequence.current
    )
      return;
    consumedSequence.current = binding.sequence;
    rememberTurn("user", text);
    ownerSpeech.current = text;
    let acceptedScope: VoiceHistoryScope | undefined;
    try {
      acceptedScope = (await turnHistory.current)?.scope;
    } catch {
      setHistoryNotice(t("Conversation was not saved. Retry."));
    }
    if (generation.current !== epoch || binding.sequence !== sequence.current) return;
    if (activeHistoryBinding.current?.current && !activeHistoryBinding.current.current()) return;
    if (consumeOwnerRule(text)) return;
    const session =
      findSession(binding.sessionId) ??
      (latest.current.workspace ? latest.current.assistantSession : undefined);
    if (!session) {
      setError(t("Select a session and speak again."));
      return;
    }
    setTranscript(text);
    setError("");
    setPhase("replying");
    const controller = new AbortController();
    sideRequest.current?.abort();
    sideRequest.current = controller;
    const acceptedTarget = (binding as CapturedSpeechBinding)[speechTarget];
    const historyKey = latest.current.workspace
      ? (acceptedTarget?.globalScope ?? scopeRef.current)
        ? "global"
        : (acceptedTarget?.projectPath ?? session.cwd)
      : session.id;
    const exchanges = acceptedScope
      ? (history.current.get(historyKey) ?? []).filter((entry) =>
          voiceHistoryMessageVisible(entry, acceptedScope!),
        )
      : [];
    let promptExchanges = exchanges.map(({ role, text }) => ({ role, text }));
    let verifiedContext: unknown;
    if (latest.current.workspace && !activeHistoryBinding.current?.remote) {
      retainCausalGeneration(
        new VoiceCausalGeneration(
          [],
          false,
          () =>
            generation.current === epoch &&
            binding.sequence === sequence.current &&
            !controller.signal.aborted &&
            voiceDisclosureCurrent(),
          reportContextFailure,
        ),
      );
      void causalGeneration.current?.invalidate("unverified-seed");
      promptExchanges = [];
      verifiedContext = {
        scope: acceptedTarget?.globalScope ? "global" : "project",
        historyAvailable: false,
      };
      const captured = activeHistoryBinding.current;
      try {
        if (!captured || !transcriptStore.current)
          throw new Error("Conversation history is unavailable.");
        const owner = await transcriptStore.current.ownerReceipt();
        const stored = await captured.request({
          op: "threads.messages",
          threadId: owner.message.threadId,
          limit: 6,
        });
        if (
          controller.signal.aborted ||
          generation.current !== epoch ||
          binding.sequence !== sequence.current
        )
          return;
        const seed = (stored.messages ?? []).filter(
          (message) =>
            message.id !== owner.message.id &&
            acceptedScope &&
            voiceHistoryMessageVisible(message, acceptedScope),
        );
        const summary =
          acceptedScope && stored.thread?.id === owner.message.threadId
            ? voiceThreadSummary(stored.thread, acceptedScope)
            : undefined;
        const causal = new VoiceCausalGeneration(
          seed.map((message) => message.id),
          !!summary,
          () =>
            generation.current === epoch &&
            binding.sequence === sequence.current &&
            !controller.signal.aborted &&
            voiceDisclosureCurrent(),
          reportContextFailure,
          undefined,
          summary?.proofId,
        );
        retainCausalGeneration(causal);
        await causal.accept(captured, Promise.resolve(owner), text);
        const context = await causal.context();
        verifiedContext =
          context?.status === "known"
            ? {
                scope: acceptedTarget?.globalScope ? "global" : "project",
                threadId: context.threadId,
                projectIds: context.projectIds,
              }
            : {
                scope: acceptedTarget?.globalScope ? "global" : "project",
                historyAvailable: false,
              };
        // These are the exact canonical records actually sent to this isolated call.
        promptExchanges = voiceThreadSeed(
          summary && stored.thread ? stored.thread : { summary: "" },
          seed,
        ).map(({ role, text }) => ({ role, text }));
      } catch (cause) {
        reportContextFailure(cause);
      }
    }
    if (
      controller.signal.aborted ||
      generation.current !== epoch ||
      binding.sequence !== sequence.current
    )
      return;
    if (!voiceDisclosureCurrent() || (acceptedScope && !acceptedScope.current())) {
      stopCapture("ready", true);
      return;
    }
    // Accepted speech is context even if a correction supersedes its pending
    // model reply. Keep the current utterance out of its own previous exchanges.
    const contributorIds = acceptedScope?.complete ? acceptedScope.projectIds : undefined;
    history.current.set(
      historyKey,
      [...exchanges, { role: "user", text, projectIds: contributorIds }].slice(-12),
    );
    const recordResponse = (entry: {
      role: string;
      text: string;
      projectIds?: readonly string[];
    }) => {
      entry.projectIds = contributorIds;
      history.current.set(
        historyKey,
        [...(history.current.get(historyKey) ?? []), entry].slice(-12),
      );
    };
    try {
      if (latest.current.workspace) {
        const immediate = immediateVoiceDecision(text, session);
        if (immediate?.action === "silence") {
          client.current?.silence();
          return;
        }
        if (immediate?.action === "stop" && binding.sessionId) {
          latest.current.onStop(binding.sessionId);
          reply(immediate.reply, session);
          return;
        }
        const decision = await converseWithAssistant({
          session,
          transcript: text,
          context: verifiedContext ?? thisController().context(),
          history: promptExchanges,
          signal: controller.signal,
          tools: voiceTools,
          persona: ownerInstructions(),
          execute: async (name, args, _signal, wait) => {
            if (
              controller.signal.aborted ||
              generation.current !== epoch ||
              binding.sequence !== sequence.current
            )
              throw new Error("The spoken request is no longer active.");
            return realtimeTool(
              name,
              args,
              epoch,
              () => !controller.signal.aborted && binding.sequence === sequence.current,
              wait,
            );
          },
        });
        if (
          controller.signal.aborted ||
          generation.current !== epoch ||
          binding.sequence !== sequence.current ||
          !voiceDisclosureCurrent()
        )
          return;
        if (decision.action === "no_reply") return;
        reply(decision.reply, undefined, false, () =>
          recordResponse({ role: "assistant", text: decision.reply }),
        );
        return;
      }
      let streamed = false;
      const decision = await converseWithSession(
        session,
        text,
        promptExchanges,
        controller.signal,
        (sentence) => {
          // Speak from the first finished sentence; a newer utterance aborts the rest.
          if (generation.current !== epoch || binding.sequence !== sequence.current) return;
          reply(sentence, session, streamed, () =>
            recordResponse({ role: "assistant", text: sentence }),
          );
          streamed = true;
        },
        ownerInstructions(),
      );
      if (
        controller.signal.aborted ||
        generation.current !== epoch ||
        binding.sequence !== sequence.current ||
        !voiceDisclosureCurrent()
      )
        return;
      if (decision.action === "no_reply") return;
      if (decision.action === "silence") {
        client.current?.silence();
        return;
      }
      if (decision.action === "stop") {
        latest.current.onStop(session.id);
        reply(decision.reply, session);
        return;
      }
      if (decision.action === "remember" || decision.action === "forget") {
        // Confirm only what actually changed on this device.
        const result =
          decision.action === "remember"
            ? await rememberHostVoiceMemory(decision.text, "fact", assistantRequest, text)
            : await forgetOwnerMemory(
                decision.id,
                text,
                epoch,
                () => !controller.signal.aborted && binding.sequence === sequence.current,
              );
        const done = "saved" in result ? result.saved : result.forgotten;
        const spoken = done
          ? decision.reply ||
            t(decision.action === "remember" ? "I'll remember that." : "Forgotten.")
          : t(("error" in result && result.error) || "Memory could not be changed.");
        reply(spoken, session, false, () => recordResponse({ role: "assistant", text: spoken }));
        return;
      }
      if (decision.action === "submit") {
        const fresh = findSession(session.id);
        if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
          throw new Error(t("The session is not ready for work."));
        const brief = voiceWorkText(decision.text ?? text);
        const receipt = {
          role: "assistant",
          text: JSON.stringify({ handoff: brief, status: "submitting" }),
        };
        recordResponse(receipt);
        const recordReceipt = (outcome: object) => {
          if (generation.current !== epoch) return;
          // Update only this receipt. A newer discussion/correction owns its
          // own history, even when the original submission resolves later.
          history.current.set(
            session.id,
            (history.current.get(session.id) ?? []).map((entry) =>
              entry === receipt
                ? {
                    ...entry,
                    role: "assistant",
                    text: JSON.stringify({ handoff: brief, ...outcome }),
                  }
                : entry,
            ),
          );
        };
        let accepted: boolean;
        try {
          ({ accepted } = await submitWork(
            session,
            brief,
            epoch,
            () => !controller.signal.aborted && binding.sequence === sequence.current,
          ));
          recordReceipt({ accepted });
        } catch (cause) {
          recordReceipt({ status: "uncertain" });
          throw cause;
        }
        if (generation.current !== epoch) return;
        if (binding.sequence === sequence.current)
          reply(
            t(
              accepted
                ? "Accepted. You can keep talking while the agent works."
                : "The request was not accepted. Check the session.",
            ),
            session,
          );
      } else {
        // A streamed reply is already shown and queued for speech.
        if (!streamed)
          reply(decision.reply, session, false, () =>
            recordResponse({ role: "assistant", text: decision.reply }),
          );
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === epoch)
        setError(voiceError(cause, "The voice request failed."));
    } finally {
      transcriptStore.current?.finish();
      if (sideRequest.current === controller) {
        sideRequest.current = null;
        if (generation.current === epoch) setPhase("listening");
      }
      // A reply consumes the warm provider process; prepare the next one now.
      if (generation.current === epoch) void warmVoiceReply(session);
    }
  }
  function thisController() {
    return controller.current!;
  }
  /** Tools of the cloud companion, with the same readiness checks as local voice. */
  async function realtimeTool(
    name: string,
    args: Record<string, unknown>,
    epoch: number,
    active: () => boolean = () => true,
    wait?: { waitForOwner(): void },
  ) {
    if (generation.current !== epoch || !active() || !voiceDisclosureCurrent())
      return { error: "The voice connection is no longer active." };
    const capturedRevision = turnRevision.current;
    return toolActivity.current!.run(
      {
        name: truncateGraphemes(typeof args.action === "string" ? args.action : name, 100),
        target:
          latest.current.sessions.find((session) => session.id === turnSessionId.current)?.title ||
          t("Global"),
        projectPath: turnProjectPath.current || currentTarget()?.cwd || props.projectPath || "",
        requestId:
          typeof args.requestId === "string" && args.requestId.length <= 300
            ? args.requestId
            : undefined,
      },
      (observing, waitForOwner) =>
        performRealtimeTool(
          name,
          args,
          epoch,
          () => active() && observing() && turnRevision.current === capturedRevision,
          {
            waitForOwner: () => {
              waitForOwner();
              wait?.waitForOwner();
            },
          },
        ),
    );
  }
  async function performRealtimeTool(
    name: string,
    args: Record<string, unknown>,
    epoch: number,
    active: () => boolean = () => true,
    wait?: { waitForOwner(): void },
  ) {
    const revision = turnRevision.current;
    const isActive = () => active() && turnRevision.current === revision;
    if (generation.current !== epoch || !isActive() || !voiceDisclosureCurrent())
      return { error: "The voice connection is no longer active." };
    if (
      ![
        "present_choices",
        "app_tools_list",
        "app_tool_call",
        "app_context",
        "composer_context",
        "composer_attachment",
      ].includes(name)
    ) {
      const invalidation = causalGeneration.current?.invalidate("unverified-tool");
      if (name === "assistant_stop_all" || name === "stop_work") void invalidation;
      else await invalidation;
    }
    if (generation.current !== epoch || !isActive() || !voiceDisclosureCurrent())
      return name === "submit_work"
        ? { accepted: false }
        : { error: "The voice connection is no longer active." };
    if (VOICE_ASSISTANT_CONTROL_TOOLS.some((tool) => tool.name === name))
      return assistantControls.current!.call(
        name,
        args,
        {
          key: `${epoch}:${revision}`,
          utterance: ownerSpeech.current,
          assistantName: snapshotRef.current?.profile.name,
        },
        () => generation.current === epoch && isActive(),
      );
    if (name === "give_jobs") {
      if (pendingJobs.current)
        return { status: "awaiting_review", reviewId: pendingJobs.current.review.id };
      const input = VoiceJobDraftsSchema.parse(args.jobs);
      const capturedHistory = activeHistoryBinding.current;
      const capturedOwner = transcriptStore.current
        ?.ownerReceipt()
        .then(async (source) => ({
          source,
          environmentId: await capturedHistory?.environmentId?.(),
        }))
        .catch(() => undefined);
      const owner = await captureAssistantHostRead();
      const result = await assistantRequest({ op: "projects.list" }, owner.environmentId);
      if (generation.current !== epoch || !isActive()) return { status: "cancelled" };
      const visible = latest.current.projects ?? [
        {
          path: turnProjectPath.current || currentTarget()?.cwd || latest.current.projectPath || "",
        },
      ];
      const allowed = turnCaptured.current ? turnAllowedProjectPaths.current : [];
      const projects = (result.projects ?? []).filter(
        (project) =>
          allowed.some((path) => pathKey(path) === pathKey(project.path)) &&
          !isProjectLocked(project.path) &&
          visible.some((item) => pathKey(item.path) === pathKey(project.path)) &&
          ((turnGlobalScope.current && scopeRef.current) ||
            pathKey(project.path) === pathKey(turnProjectPath.current)),
      );
      const defaultPath =
        turnProjectPath.current || latest.current.projectPath || currentTarget()?.cwd;
      const capabilities = (
        await assistantRequest({ op: "snapshot", limit: 100 }, owner.environmentId)
      ).snapshot?.capabilities;
      if (generation.current !== epoch || !isActive()) return { status: "cancelled" };
      if (
        input.some((item) => item.kind === "quick" && item.quickAction.kind === "note") &&
        capabilities?.quickNotes !== true
      )
        throw new Error("Quick note jobs are unavailable on this Host.");
      if (
        input.some((item) => item.kind === "quick" && item.quickAction.kind === "automation") &&
        capabilities?.quickAutomations !== true
      )
        throw new Error("Quick automation jobs are unavailable for this project.");
      const jobs = input.map((item) => ({
        ...resolveVoiceJobDraft(item, projects, allowed, defaultPath ?? ""),
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      }));
      const review: VoiceJobReviewState = {
        id: crypto.randomUUID(),
        jobs,
        projects,
        quickNotes: capabilities?.quickNotes === true,
        quickAutomations: capabilities?.quickAutomations === true,
        busy: false,
        error: "",
        accepted: [],
      };
      setJobReview(review);
      wait?.waitForOwner();
      return new Promise<unknown>((resolve) => {
        pendingJobs.current = {
          review,
          environmentId: owner.environmentId,
          batch: new VoiceJobBatch(
            async (request) => {
              if (request.op === "jobs.create") {
                const source =
                  request.kind === "quick" && request.quickAction.kind === "automation"
                    ? {
                        ...request,
                        projectId: request.quickAction.projectId,
                        projectIds: [request.quickAction.projectId],
                      }
                    : request;
                if (
                  (request.kind !== "quick" || request.quickAction.kind === "automation") &&
                  !assistantJobVisible(source, (id) => {
                    const project = review.projects.find((project) => project.id === id);
                    return (
                      !!project &&
                      !isProjectLocked(project.path) &&
                      (scopeRef.current ||
                        pathKey(project.path) ===
                          pathKey(currentTarget()?.cwd ?? latest.current.projectPath ?? "")) &&
                      (
                        latest.current.projects ?? [
                          { path: currentTarget()?.cwd ?? latest.current.projectPath ?? "" },
                        ]
                      ).some((visible) => pathKey(visible.path) === pathKey(project.path))
                    );
                  })
                )
                  throw new Error("The project is hidden, locked or no longer available.");
              }
              return assistantRequest(request, owner.environmentId);
            },
            async (accepted) => {
              const original = await capturedOwner;
              if (
                !original ||
                !capturedHistory ||
                original.environmentId !== owner.environmentId ||
                original.source.request !== capturedHistory.request
              ) {
                setHistoryNotice(
                  t("The job was accepted, but its conversation link is unavailable."),
                );
                return;
              }
              const result = await capturedHistory.request({
                op: "messages.linkJob",
                id: original.source.message.id,
                jobId: accepted.id,
                jobKey: accepted.idempotencyKey,
              });
              if (
                !result.message ||
                result.message.id !== original.source.message.id ||
                result.message.threadId !== original.source.message.threadId ||
                !result.message.jobIds.includes(accepted.id)
              )
                throw new Error(
                  "The job was accepted, but its conversation link is unconfirmed. Retry to verify it.",
                );
            },
          ),
          resolve,
        };
      });
    }
    if (name === "present_choices") {
      if (pendingChoice.current || preparingChoice.current)
        return { error: "A choice is already waiting for the owner." };
      const next = parseVoiceChoice(args);
      preparingChoice.current = true;
      let owner: Awaited<ReturnType<typeof persistVoiceOwnerChoice>>;
      let presentation: VoiceOwnerChoicePending | undefined;
      try {
        if (next.kind !== "confirm") {
          if (!activeHistoryBinding.current)
            throw new Error("Conversation history is unavailable.");
          owner = await persistVoiceOwnerChoice(
            next,
            activeHistoryBinding.current,
            transcriptStore.current!,
            () => generation.current === epoch && isActive() && voiceDisclosureCurrent(),
            causalGeneration.current?.proof(),
          );
        }
      } catch (cause) {
        if (cause instanceof VoiceOwnerChoicePending) presentation = cause;
        if (generation.current === epoch)
          setHistoryNotice(
            t(
              presentation
                ? "Saving this question is unconfirmed. Retry to verify the original card."
                : "This choice could not be saved in the Room. Keep voice open to answer.",
            ),
          );
      } finally {
        preparingChoice.current = false;
      }
      if (generation.current !== epoch || !isActive())
        return { error: "The voice question source changed before it could be saved." };
      if (owner?.question.status === "answered") return owner.answeredReply();
      if (owner && owner.question.status !== "open") return owner.deferred();
      const shown = presentation
        ? {
            ...next,
            presentationPending: true,
            prompt: {
              ...next.prompt,
              delivery: "unknown" as const,
              error: t("Saving this question is unconfirmed. Retry to verify the original card."),
            },
          }
        : (owner?.choice ?? next);
      setChoice(shown);
      wait?.waitForOwner();
      return new Promise<unknown>((resolve) => {
        const timer = setTimeout(releaseChoice, next.timeoutSec * 1000);
        pendingChoice.current = { choice: shown, resolve, timer, owner, presentation };
      });
    }
    // Memory belongs to this device, not to a session or project.
    if (name === "memory_save")
      return rememberHostVoiceMemory(args.text, args.kind, assistantRequest, ownerSpeech.current);
    if (name === "memory_forget")
      return forgetOwnerMemory(args.id, ownerSpeech.current, epoch, isActive);
    if (
      latest.current.workspace &&
      [
        "app_context",
        "app_tools_list",
        "app_tool_call",
        "composer_context",
        "composer_attachment",
      ].includes(name)
    )
      return thisController().execute(name, args, () => generation.current === epoch && isActive());
    const session = findSession(turnCaptured.current ? turnSessionId.current : currentTarget()?.id);
    if (!session) return { error: "No session is selected." };
    if (name === "session_context")
      return {
        ...voiceContext(session),
        ...(latest.current.workspace ? { app: thisController().context() } : {}),
      };
    if (name === "stop_work") {
      latest.current.onStop(session.id);
      return { accepted: true, status: "stop_requested" };
    }
    if (name !== "submit_work") return { error: "Unknown tool." };
    let text: string;
    try {
      if (Object.keys(args).some((key) => key !== "text"))
        throw new Error("Unexpected work brief fields.");
      text = voiceWorkText(args.text);
    } catch (cause) {
      return { accepted: false, error: voiceError(cause, "The voice work brief is invalid.") };
    }
    const fresh = findSession(session.id);
    if (!fresh || fresh.historyLoading || fresh.historyLoadError || fresh.worktreeRemoved)
      return { accepted: false, error: "The session is not ready for work." };
    const result = await submitWork(session, text, epoch, isActive);
    // Once dispatch began, cancellation cannot undo acceptance. The realtime
    // response owner suppresses stale speech; retain the actual delivery receipt.
    return result;
  }
  function recoverRealtime(provider: RealtimeProvider, _reason: string, rotation = false) {
    invalidateFeatureHosts();
    manualPresenceCapture.current = false;
    checkingTalkPresence.current = false;
    const wasMuted = mutedRef.current;
    if (presenceRef.current !== "active") {
      stopCapture("sleeping");
      setMuted(false);
      setError("");
      return;
    }
    const delay = rotation ? 0 : VOICE_RECONNECT_DELAYS[retryCount.current++];
    stopCapture("reconnecting", true);
    setMuted(wasMuted);
    setError("");
    if (delay === undefined) {
      stopCapture("idle");
      setError(t("Couldn't connect voice. Try again."));
      return;
    }
    const epoch = generation.current;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = undefined;
      if (generation.current !== epoch) return;
      if (presenceRef.current !== "active") {
        stopCapture("sleeping");
        setMuted(false);
        return;
      }
      void startRealtime(epoch, provider, true, wasMuted);
    }, delay);
  }
  useEffect(() => {
    if (checkingTalkPresence.current && status === "connecting") return;
    if (
      (capturePresence === "idle" || capturePresence === "away") &&
      (status === "live" || status === "connecting" || status === "reconnecting")
    ) {
      stopCapture("sleeping");
      setMuted(false);
      setError("");
    } else if (capturePresence === "active" && status === "sleeping") {
      setStatus("ready"); // Returning never grants microphone permission.
    }
  }, [capturePresence, status]);
  async function startRealtime(
    epoch: number,
    provider: RealtimeProvider,
    _reconnect = false,
    restoreMuted = false,
  ) {
    const capturedHistory = activeHistoryBinding.current;
    // Generated text remains visible, but becomes conversation history only
    // after this exact response has fully played. Unaligned cut text is omitted.
    const pendingReplies = new Map<
      string,
      { text: string; turn: number; binding: VoiceHistoryBinding | undefined }
    >();
    const voice = new RealtimeVoice(
      provider,
      {
        state: (value) => {
          if (generation.current !== epoch) return;
          if (value === "speaking") setMessage("");
          setPhase(value);
        },
        reply: (text, append, responseId) => {
          if (generation.current === epoch && voiceDisclosureCurrent()) {
            if (responseId) {
              const previous = pendingReplies.get(responseId);
              pendingReplies.set(responseId, {
                text: (append && previous ? previous.text + text : text).slice(0, 16000),
                turn: previous?.turn ?? sequence.current,
                binding: previous?.binding ?? activeHistoryBinding.current,
              });
              if (pendingReplies.size > 8)
                pendingReplies.delete(pendingReplies.keys().next().value!);
            }
            setMessage((current) => (append ? current + text : text));
          }
        },
        replyPlayed: (responseId) => {
          const pending = pendingReplies.get(responseId);
          pendingReplies.delete(responseId);
          if (
            !pending ||
            generation.current !== epoch ||
            pending.turn !== sequence.current ||
            pending.binding !== activeHistoryBinding.current ||
            !voiceDisclosureCurrent()
          )
            return;
          lastDeliveredAssistant.current = pending.text;
          rememberTurn("assistant", pending.text);
          transcriptStore.current?.finish();
        },
        replyDiscarded: (responseId) => {
          pendingReplies.delete(responseId);
        },
        transcript: (text) => {
          if (generation.current === epoch) {
            ownerSpeech.current = text;
            void spokenLanguage.current!.record(text).catch(() => {});
            rememberTurn("user", text);
            const history = activeHistoryBinding.current,
              store = transcriptStore.current;
            if (history && store)
              void causalGeneration.current?.accept(history, store.ownerReceipt(), text);
            setTranscript(text);
          }
        },
        interceptTranscript: (text) =>
          generation.current !== epoch || interceptSpeech(text) || consumeChoice(text),
        consumeOwnerTranscript: (text) => !voiceDisclosureCurrent() || consumeOwnerRule(text),
        captureTurn: () => {
          const snapshot = currentSpeechTarget();
          return () => captureTurn(snapshot);
        },
        playback: (active) => {
          if (generation.current === epoch && voiceDisclosureCurrent()) setPlayback(active);
        },
        tool: (name, args, wait) => realtimeTool(name, args, epoch, undefined, wait),
        rotate: () => {
          if (generation.current === epoch) recoverRealtime(provider, "", true);
        },
        diagnostic: (event) => {
          // Connection metadata only: provider reasons may contain private text.
          console.info("[voice.connection]", provider, event);
        },
        timing: (event) => {
          // Bounded metadata only. This measures scheduled output, not audibility.
          if (generation.current === epoch) console.info("[voice.timing]", provider, event);
        },
        error: (value, fatal, details) => {
          if (generation.current !== epoch) return;
          if (fatal && details?.recoverable) {
            recoverRealtime(provider, value);
            return;
          }
          if (fatal) close();
          setError(t(value));
        },
      },
      locale.split("-")[0],
      audioLevel,
      settings.speakers[settings.mode === "grok" ? "grok" : "openai"],
      ownerInstructions(),
      languageLock,
      {
        turnEndSilence: settings.turnEndSilence,
        allowBargeIn: settings.allowBargeIn,
        manualTurnEnd: settings.manualTurnEnd,
        experimentalSemanticVad:
          provider === "openai" &&
          settings.manualTurnEnd !== true &&
          settings.experimentalSemanticVad === true,
      },
    );
    client.current = voice;
    voice.setOutputMuted(speakerMutedRef.current);
    if (restoreMuted) voice.mute(true);
    let connectionScope: VoiceHistoryScope | undefined;
    const disclosureCurrent = () =>
      generation.current === epoch &&
      voiceDisclosureCurrent() &&
      capturedHistory?.current?.() !== false &&
      (!connectionScope || connectionScope.current());
    let runtimeRegistrationPending = false;
    try {
      const secret = await realtimeSecret(provider);
      if (generation.current !== epoch) return;
      const scope = await capturedHistory?.scope?.().catch(() => undefined);
      connectionScope = scope;
      if (generation.current !== epoch) return;
      if (capturedHistory?.current && !capturedHistory.current()) {
        stopCapture("ready", true);
        return;
      }
      let seed: import("../../../shared/model/host-contracts/assistant").AssistantMessage[] = [];
      let seededSummary: ReturnType<typeof voiceThreadSummary>;
      try {
        await transcriptStore.current?.retry();
        const stored = await capturedHistory?.open();
        if (stored && scope?.current()) {
          const page = await capturedHistory!.request({
            op: "threads.messages",
            threadId: stored.thread.id,
            limit: 6,
          });
          seed =
            page.messages?.filter((message) => voiceHistoryMessageVisible(message, scope)) ?? [];
          if (page.thread?.id === stored.thread.id)
            seededSummary = voiceThreadSummary(page.thread, scope);
        }
      } catch (cause) {
        if (generation.current === epoch)
          setHistoryNotice(voiceError(cause, "Conversation was not saved. Retry."));
      }
      if (generation.current !== epoch || capturedHistory?.current?.() === false) return;
      const safeTurns = voiceThreadSeed({ summary: "" }, seed).map(({ role, text }) => ({
        role,
        text,
      }));
      const causal = new VoiceCausalGeneration(
        seed.map((message) => message.id),
        !!seededSummary,
        () => generation.current === epoch && voiceDisclosureCurrent(),
        (cause) => {
          if (generation.current === epoch) reportContextFailure(cause);
        },
        undefined,
        seededSummary?.proofId,
      );
      retainCausalGeneration(causal);
      const summary = seededSummary?.text ?? "";
      runtimeRegistrationPending = true;
      await beginVoiceRuntime(voice, provider === "xai" ? "grok" : "openai");
      if (!disclosureCurrent()) {
        closeVoiceRuntimeEvidence(voice, voice.retire());
        return;
      }
      if (!capturedHistory) throw new Error("Voice runtime source unavailable.");
      const [sourceHistory, sourceEnvironment] = await Promise.all([
        capturedHistory.open(),
        capturedHistory.environmentId?.(),
      ]);
      if (!sourceEnvironment || !disclosureCurrent())
        throw new Error("Voice runtime source unavailable.");
      const { isTauri } = await import("@tauri-apps/api/core");
      if (isTauri())
        await waitForAssistantControlSource(
          sourceHistory.thread.id,
          sourceEnvironment,
          disclosureCurrent,
        );
      if (!disclosureCurrent()) throw new Error("Voice runtime source changed.");
      await causal.bindRuntimeIdentity(capturedHistory);
      if (!disclosureCurrent()) {
        closeVoiceRuntimeEvidence(voice, voice.retire());
        return;
      }
      runtimeRegistrationPending = false;
      await voice.connect(secret, safeTurns, {
        summary,
        disclosureCurrent,
        ...(settings.microphoneId ? { deviceId: settings.microphoneId } : {}),
      });
      if (generation.current === epoch && !disclosureCurrent()) {
        stopCapture("ready", true);
        return;
      }
      if (generation.current === epoch) {
        if (restoreMuted) voice.mute(true);
        setStatus("live");
        // A brief connection must not replenish an endless retry loop.
        stableTimer.current = setTimeout(() => {
          if (generation.current === epoch) retryCount.current = 0;
        }, 60_000);
      }
    } catch (cause) {
      if (generation.current !== epoch) return;
      if (!disclosureCurrent()) {
        stopCapture("ready", true);
        return;
      }
      if (runtimeRegistrationPending) {
        close();
        setError(voiceError(cause, "Voice runtime registration was not confirmed."));
      } else if (classifyVoiceFailure(cause).recoverable)
        recoverRealtime(provider, voiceError(cause, "Voice could not connect."));
      else {
        close();
        setError(voiceError(cause, "Voice could not connect."));
      }
    }
  }
  async function start() {
    if (
      client.current ||
      status === "connecting" ||
      (!currentTarget() && !latest.current.workspace)
    )
      return;
    clearTimeout(stableTimer.current);
    clearTimeout(retryTimer.current);
    retryCount.current = 0;
    setMuted(false);
    const epoch = ++generation.current;
    const manualAway =
      assistantSnapshot?.presence?.state === "away" || assistantSnapshot?.presence?.state === "dnd";
    checkingTalkPresence.current = manualAway;
    setStatus("connecting");
    setError("");
    setTranscript("");
    setMessage("");
    try {
      if (manualAway) {
        const actual = await readNativeVoicePresence(settings.idleSleepMinutes);
        if (generation.current !== epoch) return;
        checkingTalkPresence.current = false;
        if (actual !== "active" || detectedPresence !== "active") {
          stopCapture("sleeping", true);
          setError(
            t(
              "Current computer presence could not be verified. Mark yourself here before talking.",
            ),
          );
          return;
        }
        manualPresenceCapture.current = true;
      }
      const latestState = await assistantRequest({ op: "snapshot", limit: 100 });
      snapshotRef.current = latestState.snapshot ?? null;
      if (generation.current !== epoch) return;
      const currentProfile = snapshotRef.current?.profile;
      if (!currentProfile?.setupComplete || !currentProfile.voiceSetupComplete)
        throw new Error("Complete voice setup before starting.");
      historyBindings.current!.clear();
      const selected = currentSpeechTarget(),
        binding = selected.historyBinding!;
      activeHistoryBinding.current = binding;
      setManagementBinding(binding);
      const opening = binding.open();
      turnHistory.current = opening;
      transcriptStore.current?.bindPending(
        async () => (await binding.open()).thread,
        selected.historySessionId,
        binding.request,
      );
      threadSummary.current = "";
      recentTurns.current = [];
      try {
        const stored = await opening;
        if (generation.current !== epoch) return;
        transcriptStore.current?.bind(stored.thread, selected.historySessionId, stored.request);
        setHistoryNotice("");
        threadSummary.current = stored.thread.summary;
        recentTurns.current = stored.messages.map(({ role, text, projectIds }) => ({
          role,
          text,
          projectIds,
        }));
        history.current.set(
          latest.current.workspace
            ? scopeRef.current
              ? "global"
              : selected.projectPath
            : (selected.sessionId ?? "global"),
          voiceThreadSeed(stored.thread, stored.messages),
        );
      } catch {
        if (generation.current === epoch) setHistoryNotice(t("Conversation was not saved. Retry."));
      }
    } catch (cause) {
      if (generation.current === epoch) {
        close();
        setError(voiceError(cause, "Conversation history is unavailable."));
      }
      return;
    }
    if (generation.current !== epoch) return;
    const mode = loadVoiceSettings().mode;
    // Cloud modes replace local recognition, the reply provider and local speech.
    if (mode !== "local") return startRealtime(epoch, REALTIME[mode].provider);
    // Prime native voice enumeration before the first response.
    globalThis.speechSynthesis?.getVoices();
    // The reply provider starts in parallel with the local models.
    const warmTarget = currentTarget() ?? latest.current.assistantSession;
    if (warmTarget) void warmVoiceReply(warmTarget);
    const voice = new LocalVoice(
      {
        start: () => {
          const session = currentTarget();
          // No-op when already warm; otherwise the provider starts while the user talks.
          if (session) void warmVoiceReply(session);
          return {
            sessionId: session?.id,
            sequence: sequence.current,
            [speechTarget]: currentSpeechTarget(),
          } satisfies CapturedSpeechBinding;
        },
        accept: (binding) => {
          if (generation.current !== epoch || binding.sequence !== sequence.current) return;
          if (pendingChoice.current || pendingJobs.current)
            return { ...binding, sequence: sequence.current };
          sequence.current++;
          sideRequest.current?.abort();
          sideRequest.current = null;
          setMessage("");
          captureTurn((binding as CapturedSpeechBinding)[speechTarget]);
          return { ...binding, sequence: sequence.current };
        },
        interceptTranscript: (result, binding) =>
          generation.current !== epoch ||
          binding.sequence !== sequence.current ||
          interceptSpeech(result.text),
        transcript: (result, binding) => {
          if (generation.current === epoch)
            void spokenLanguage.current!.record(result.text, result.language).catch(() => {});
          void onSpeech(result.text, binding, epoch);
        },
        playback: (active) => {
          if (generation.current === epoch) setPlayback(active);
        },
        state: (value) => {
          if (generation.current === epoch && !sideRequest.current) setPhase(value);
        },
        error: (value, fatal) => {
          if (generation.current === epoch) {
            if (fatal) close();
            setError(t(value));
          }
        },
      },
      voiceLanguageCode(languageLock) ?? locale.split("-")[0],
      voiceRuntimeSettings(loadVoiceSettings()),
      audioLevel,
      {
        turnEndSilence: settings.turnEndSilence,
        allowBargeIn: settings.allowBargeIn,
        manualTurnEnd: settings.manualTurnEnd,
        languageLock: voiceLanguageCode(languageLock),
        deviceId: settings.microphoneId,
      },
    );
    client.current = voice;
    voice.setOutputMuted(speakerMutedRef.current);
    try {
      await beginVoiceRuntime(voice, "local");
      if (generation.current !== epoch) return;
      await voice.connect();
      if (generation.current === epoch) setStatus("live");
    } catch (cause) {
      if (generation.current !== epoch) return;
      close();
      setError(voiceError(cause, "Local voice could not start."));
    }
  }
  const visualState = voiceVisualState({ status, phase, muted, playback, error });
  const sessionProgress = useVoiceSessionProgress(target);
  const sessionStatusText = t(
    sessionProgress === "quiet" ? "No recent session updates" : "Session working",
  );
  const statusText = t(
    status === "live"
      ? muted
        ? "Microphone paused"
        : playback
          ? "Assistant speaking"
          : phase === "transcribing"
            ? "Transcribing locally..."
            : phase === "replying"
              ? "Preparing a reply..."
              : phase === "speaking"
                ? "Receiving speech..."
                : hearingInput
                  ? "Microphone is receiving sound"
                  : "Listening"
      : status === "reconnecting"
        ? "Reconnecting..."
        : status === "sleeping"
          ? "Asleep"
          : status === "ready"
            ? "Ready. Microphone is off."
            : status === "connecting"
              ? realtime
                ? "Connecting voice..."
                : "Preparing local voice..."
              : "Ready to connect",
  );
  function toggleMute() {
    setLastAdmittedSpeechAt(null);
    client.current?.mute(!muted);
    setMuted(!muted);
  }
  function beginPushToTalk() {
    if (status !== "live" || !mutedRef.current || !client.current?.beginPushToTalk()) return false;
    pushToTalkHeld.current = true;
    setMuted(false);
    return true;
  }
  function endPushToTalk() {
    if (!pushToTalkHeld.current) return;
    pushToTalkHeld.current = false;
    client.current?.endPushToTalk();
    setMuted(true);
  }
  function cancelPushToTalk() {
    if (!pushToTalkHeld.current) return;
    pushToTalkHeld.current = false;
    if (!client.current) return;
    client.current?.mute(true);
    setMuted(true);
  }
  const pushToTalkBinding = useVoicePushToTalk({
    enabled: open && !detached && status === "live",
    begin: beginPushToTalk,
    end: endPushToTalk,
    cancel: cancelPushToTalk,
  });
  function toggleSpeaker() {
    speakerMutedRef.current = !speakerMutedRef.current;
    if (speakerMutedRef.current && briefingAbort.current && !briefingAbort.current.signal.aborted) {
      briefingAbort.current.abort();
      setPlayback(false);
    }
    client.current?.setOutputMuted(speakerMutedRef.current);
    setSpeakerMuted(speakerMutedRef.current);
  }
  const speakerButton = (
    <Button
      iconOnly
      label={t(speakerMuted ? "Unmute speaker" : "Mute speaker")}
      tooltip={t(speakerMuted ? "Unmute speaker" : "Mute speaker")}
      selected={speakerMuted}
      aria-pressed={speakerMuted}
      onClick={toggleSpeaker}
    >
      {speakerMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
    </Button>
  );
  // Compact mode's single control: start when idle, otherwise mute or resume.
  const canTalk = status === "idle" || status === "sleeping" || status === "ready";
  const micLabel = t(
    canTalk ? (status === "idle" ? "Start voice" : "Talk") : muted ? "Resume" : "Pause mic",
  );
  const micButton = (
    <Button
      iconOnly
      variant={canTalk || (status === "live" && !muted) ? "primary" : "secondary"}
      tone={muted ? "danger" : undefined}
      label={micLabel}
      tooltip={micLabel}
      loading={status === "connecting" || status === "reconnecting"}
      disabled={canTalk ? !target && !props.workspace : status !== "live"}
      selected={status === "live" && muted}
      aria-pressed={canTalk ? undefined : muted}
      onClick={() => (canTalk ? void start() : toggleMute())}
    >
      {muted || status === "ready" || status === "sleeping" ? (
        <MicOff className="icon-sm" />
      ) : (
        <Mic className="icon-sm" />
      )}
    </Button>
  );
  function setCompact(value: boolean) {
    saveVoiceSettings({ ...loadVoiceSettings(), compact: value });
  }
  function setManualTurnEnd(manual: boolean) {
    try {
      const next = saveVoiceTurnEndChoice(manual);
      // Synchronous storage + configuration finish before another audio frame.
      client.current?.configureConversation({
        turnEndSilence: next.turnEndSilence,
        allowBargeIn: next.allowBargeIn,
        manualTurnEnd: manual,
      });
      setError((current) => (current === t(VOICE_TURN_CHOICE_FAILED) ? "" : current));
    } catch {
      setError(t(VOICE_TURN_CHOICE_FAILED));
    }
  }
  async function popOut(placement: Omit<VoiceOverlayPlacement, "width" | "height">) {
    if (!canDetach) return;
    try {
      // The floating window measures and fits its own content after loading.
      await openVoiceOverlay({
        ...placement,
        width: compact ? VOICE_OVERLAY_COMPACT_SIZE.width : VOICE_OVERLAY_EXPANDED_WIDTH,
        height: compact
          ? VOICE_OVERLAY_COMPACT_SIZE.height
          : Math.max(VOICE_OVERLAY_COMPACT_SIZE.height, panel.current?.offsetHeight ?? 0),
      });
      setDetached(true);
    } catch (cause) {
      setError(voiceError(cause, "The floating voice window could not open."));
    }
  }
  function dock() {
    setDetached(false);
    void closeVoiceOverlay().catch(() => undefined);
  }
  function onOverlayCommand(command: VoiceOverlayCommand) {
    if (command === "start") void start();
    else if (command === "finishTurn") {
      if (status === "live") client.current?.finishTurn();
    } else if (command === "manualTurnEnd") setManualTurnEnd(true);
    else if (command === "automaticTurnEnd") setManualTurnEnd(false);
    else if (command === "toggleMute") {
      if (status === "live") toggleMute();
    } else if (command === "toggleSpeaker") {
      toggleSpeaker();
    } else if (command === "beginPushToTalk") beginPushToTalk();
    else if (command === "endPushToTalk") endPushToTalk();
    else if (command === "cancelPushToTalk") cancelPushToTalk();
    else if (command === "silence") client.current?.silence();
    else if (command === "disconnect") close();
    else if (command === "dock") dock();
    else if (command === "close") {
      dock();
      dismiss();
    }
  }
  const jobReviewVisible =
    !jobReview ||
    jobReview.jobs.every((row) =>
      assistantJobDraftVisible(row, (id) => {
        const project = jobReview.projects.find((project) => project.id === id);
        return (
          !!project &&
          !isProjectLocked(project.path) &&
          (props.projects ?? [{ path: currentTarget()?.cwd ?? props.projectPath ?? "" }]).some(
            (visible) => pathKey(visible.path) === pathKey(project.path),
          )
        );
      }),
    );
  const historyScopeVisible = activeHistoryBinding.current?.current?.() ?? true;
  const bodyVisible = jobReviewVisible && historyScopeVisible;
  useLayoutEffect(() => {
    if (!bodyVisible) {
      client.current?.silence();
      if (status === "live" || status === "connecting" || status === "reconnecting")
        stopCapture("ready", true);
    }
  }, [bodyVisible, status]);
  const shownTranscript = bodyVisible ? transcript : "",
    shownMessage = bodyVisible ? message : "",
    shownError = bodyVisible ? error : "";
  const actionableError =
    shownError === t("Conversation was not saved. Retry.") ||
    shownError ===
      t("Current computer presence could not be verified. Mark yourself here before talking.");
  const scopeTitle =
    props.workspace && globalScope
      ? t("Global")
      : target?.title ||
        props.projects?.find((project) => project.path === props.projectPath)?.name ||
        props.projectPath?.split(/[\\/]/).pop() ||
        t("Select a session");
  const visibleToolActivities = bodyVisible
    ? toolActivities.filter((entry) =>
        !entry.projectPath
          ? globalScope
          : !isProjectLocked(entry.projectPath) &&
            (props.projects ?? [{ path: target?.cwd ?? props.projectPath ?? "" }]).some(
              (project) => pathKey(project.path) === pathKey(entry.projectPath),
            ),
      )
    : [];
  useVoiceOverlayHost({
    detached: open && detached,
    level: audioLevel,
    state: {
      status,
      visualState,
      statusText,
      title: `${identity.title} · ${scopeTitle}`,
      choice: bodyVisible ? choice : null,
      jobReview: jobReviewVisible ? jobReview : null,
      muted,
      speakerMuted,
      working: Boolean(target?.busy),
      workingStatus: sessionStatusText,
      activity: visibleToolActivities.map((entry) => ({
        ...entry,
        elapsedMs: entry.elapsedMs ?? elapsedSince(entry.startedAt),
      })),
      canStart: Boolean(target) || Boolean(props.workspace),
      transcript: shownTranscript,
      message: shownMessage,
      error: shownError,
      notice: historyNotice,
      manualTurnEnd: settings.manualTurnEnd === true,
      privacy: realtime
        ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
            p1: realtime.name,
          })
        : t(
            "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
          ),
    },
    onCommand: onOverlayCommand,
    onChoice: (id, reply) => {
      if (pendingChoice.current?.choice.id === id) answerChoice(reply);
    },
    onChoiceRetry: (id) => {
      if (pendingChoice.current?.choice.id === id) void retryChoice();
    },
    onJobReview: (id, action, rows) => {
      if (pendingJobs.current?.review.id !== id) return;
      if (action === "change" && rows) changeJobReview(rows);
      else if (action === "start" && rows) void startReviewedJobs(rows);
      else if (action === "cancel") cancelJobReview();
    },
    // Closed natively, or its owner reloaded: bring the controls home.
    onClosed: () => setDetached(false),
    onStopWaiting: (id) => {
      if (visibleToolActivities.some((entry) => entry.id === id))
        toolActivity.current?.stopWaiting(id);
    },
    onError: () => setError(t("Voice window could not connect. Return to the app and retry.")),
  });
  const summary = voiceSummaryLine({
    message: shownMessage,
    transcript: shownTranscript,
    error: shownError || historyNotice,
    statusText:
      hearingInput && status === "live" && !muted && !playback && phase === "listening"
        ? t("Sound detected")
        : statusText,
  });
  const moveLabel = t(
    canDetach
      ? "Move voice window. Drag outside the app to float it. Use arrow keys to reposition."
      : "Move voice window. Use arrow keys to reposition.",
  );
  if (open && detached)
    return (
      <div className={styles.launcher}>
        <Button
          ref={launcher}
          iconOnly
          selected
          label={t("Return voice companion to this window")}
          tooltip={t("Return voice companion to this window")}
          onClick={dock}
        >
          <AppWindow className="icon-md" />
        </Button>
      </div>
    );
  if (!open)
    return (
      <div className={styles.launcher}>
        <Button
          ref={launcher}
          iconOnly
          label={t("Voice companion")}
          tooltip={t("Voice companion")}
          onClick={() => {
            try {
              const saved = JSON.parse(localStorage.getItem("bycoda:voice-position") ?? "null") as {
                x?: unknown;
                y?: unknown;
              } | null;
              if (
                typeof saved?.x === "number" &&
                Number.isFinite(saved.x) &&
                typeof saved.y === "number" &&
                Number.isFinite(saved.y)
              )
                setPosition({ x: saved.x, y: saved.y });
            } catch {
              /* Position storage is optional. */
            }
            setOpen(true);
          }}
        >
          <MessageSquare className="icon-md" />
        </Button>
      </div>
    );
  return (
    <section
      ref={panel}
      aria-label={t("Voice companion")}
      className={styles.panel}
      data-compact={compact || undefined}
      data-detaching={detaching || undefined}
      data-voice-state={visualState}
      tabIndex={-1}
      style={
        position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined
      }
    >
      <header className={styles.header}>
        <Button
          iconOnly
          variant="ghost"
          label={moveLabel}
          tooltip={moveLabel}
          className={styles.drag}
          onDoubleClick={() => {
            if (compact) setCompact(false);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const rect = panel.current!.getBoundingClientRect();
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX - rect.x,
              y: event.clientY - rect.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            setDetaching(
              canDetach &&
                pointerOutsideWindow(
                  event.clientX,
                  event.clientY,
                  window.innerWidth,
                  window.innerHeight,
                ),
            );
            const rect = panel.current!.getBoundingClientRect();
            const next = clampVoicePosition(
              event.clientX - drag.current.x,
              event.clientY - drag.current.y,
              rect.width,
              rect.height,
              window.innerWidth,
              window.innerHeight,
            );
            drag.current.position = next;
            // Pointer movement owns presentation until release. Keep audio,
            // transcript and tool controls out of the per-event render path.
            Object.assign(panel.current!.style, {
              left: `${next.x}px`,
              top: `${next.y}px`,
              right: "auto",
              bottom: "auto",
            });
          }}
          onPointerUp={(event) => {
            const grab = drag.current;
            if (!grab || grab.pointerId !== event.pointerId) return;
            drag.current = null;
            setDetaching(false);
            if (grab.position) setPosition(grab.position);
            // Released beyond the app: continue as a native floating window
            // under the pointer, keeping the same grab point.
            if (
              grab &&
              canDetach &&
              pointerOutsideWindow(
                event.clientX,
                event.clientY,
                window.innerWidth,
                window.innerHeight,
              )
            ) {
              void popOut({ fromCursor: true, x: grab.x, y: grab.y });
              return;
            }
            if (grab.position)
              try {
                localStorage.setItem("bycoda:voice-position", JSON.stringify(grab.position));
              } catch {
                /* Optional. */
              }
          }}
          onPointerCancel={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            if (drag.current.position) setPosition(drag.current.position);
            drag.current = null;
            setDetaching(false);
          }}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            const rect = panel.current!.getBoundingClientRect();
            const next = clampVoicePosition(
              rect.x + move[0],
              rect.y + move[1],
              rect.width,
              rect.height,
              window.innerWidth,
              window.innerHeight,
            );
            setPosition(next);
            try {
              localStorage.setItem("bycoda:voice-position", JSON.stringify(next));
            } catch {
              /* Optional. */
            }
          }}
        >
          {compact ? (
            <VoiceVisualizer
              visual={settings.visual}
              state={visualState}
              working={Boolean(target?.busy)}
              level={audioLevel}
              small
            />
          ) : (
            <GripVertical className="icon-sm" />
          )}
        </Button>
        {!compact ? <h2 className={styles.title}>{identity.title}</h2> : null}
        {compact ? (
          <div className={styles.heading}>
            <Tooltip
              asChild
              label={target?.title}
              when={target?.title && target.title !== scopeTitle ? "always" : "overflow"}
            >
              <h2 className={styles.title}>
                {identity.title} · {scopeTitle}
              </h2>
            </Tooltip>
            {/* The live line; the status region below stays authoritative for readers. */}
            <OverflowTooltip label={summary}>
              <span className={styles.summary} aria-hidden="true">
                {summary}
              </span>
            </OverflowTooltip>
          </div>
        ) : null}
        {compact ? (
          <>
            {status === "live" && (
              <VoiceTurnControl
                compact
                manual={settings.manualTurnEnd === true}
                muted={muted}
                onManualChange={setManualTurnEnd}
                onFinish={() => client.current?.finishTurn()}
              />
            )}{" "}
            {status !== "idle" && (
              <Button
                iconOnly
                label={t("Disconnect voice")}
                tooltip={t("Disconnect voice")}
                onClick={close}
              >
                <Square className="icon-sm" />
              </Button>
            )}
            {speakerButton}
            {micButton}
          </>
        ) : (
          // Floating is rare (dragging outside the app also floats), so it lives in the menu.
          <VoiceOptionsMenu
            onFloat={
              canDetach
                ? () => {
                    const rect = panel.current?.getBoundingClientRect();
                    void popOut({ fromCursor: false, x: rect?.x ?? 0, y: rect?.y ?? 0 });
                  }
                : undefined
            }
          />
        )}
        <Button
          ref={compactToggle}
          iconOnly
          label={t(compact ? "Expand voice companion" : "Compact voice companion")}
          tooltip={t(compact ? "Expand voice companion" : "Compact voice companion")}
          aria-expanded={!compact}
          onClick={() => setCompact(!compact)}
        >
          {compact ? <Maximize2 className="icon-sm" /> : <Minimize2 className="icon-sm" />}
        </Button>
        {!compact && (
          <Button
            iconOnly
            label={t("Close voice companion")}
            tooltip={t("Close voice companion")}
            onClick={dismiss}
          >
            <X className="icon-sm" />
          </Button>
        )}
      </header>
      <LiveText
        className={styles.srOnly}
        text={compact ? `${shownError || statusText}${target?.busy ? ` | ${sessionStatusText}` : ""}` : jobReview && !detached && !jobReviewVisible ? t("The selected project is no longer visible.") : shownMessage}
      />
      <div className={styles.body} hidden={compact}>
        {bodyVisible && (
          <VoiceToolActivityPanel
            entries={visibleToolActivities}
            onStopWaiting={(id) => toolActivity.current?.stopWaiting(id)}
          />
        )}
        {props.workspace && (
          <div className={styles.scope}>
            <SegmentedControl
              label={t("Voice scope")}
              value={globalScope ? "global" : "session"}
              onValueChange={(value) => {
                scopeRef.current = value === "global";
                setGlobalScope(scopeRef.current);
              }}
              options={[
                { value: "global", label: t("Global"), icon: <Globe className="icon-sm" /> },
                {
                  value: "session",
                  label: t("Project"),
                  icon: <MessageMultiple className="icon-sm" />,
                },
              ]}
            />
          </div>
        )}
        {choice && !detached && bodyVisible ? (
          <VoiceChoiceCard
            choice={choice}
            onRetry={() => void retryChoice()}
            onReply={answerChoice}
          />
        ) : null}
        {jobReview && !detached ? (
          jobReviewVisible ? (
            <VoiceJobReview
              key={jobReview.id}
              review={{
                ...jobReview,
                projects: jobReview.projects.filter(
                  (project) =>
                    !isProjectLocked(project.path) &&
                    (
                      props.projects ?? [{ path: currentTarget()?.cwd ?? props.projectPath ?? "" }]
                    ).some((visible) => pathKey(visible.path) === pathKey(project.path)),
                ),
              }}
              onChange={changeJobReview}
              onStart={(rows) => void startReviewedJobs(rows)}
              onCancel={cancelJobReview}
            />
          ) : (
            <div>
              <p>{t("The selected project is no longer visible.")}</p>
              <Button disabled={jobReview.busy} onClick={cancelJobReview}>
                {t("Cancel review")}
              </Button>
            </div>
          )
        ) : null}
        {error === t("Conversation was not saved. Retry.") ||
        historyNotice === t("Conversation was not saved. Retry.") ? (
          <Button
            onClick={() => {
              transcriptStore.current?.finish();
              void transcriptStore.current
                ?.retry()
                .then(() => {
                  setError("");
                  setHistoryNotice("");
                })
                .catch(() => setError(t("Conversation was not saved. Retry.")));
            }}
          >
            {t("Save conversation")}
          </Button>
        ) : null}
        {(!props.workspace || !globalScope) && (
          <div className={styles.target}>
            <VoiceSessionPicker
              sessions={props.sessions}
              activeId={props.activeId}
              pinned={pinned}
              onPin={setPinned}
            />
          </div>
        )}
        <div className={styles.state}>
          <VoiceVisualizer
            visual={settings.visual}
            state={visualState}
            working={Boolean(target?.busy)}
            level={audioLevel}
            small
          />
          <div className={styles.stateText}>
            <LiveText className={styles.status} text={statusText} />
            {target?.busy ? <span className={styles.caption}>{sessionStatusText}</span> : null}
          </div>
          {target?.busy && (
            <Button
              iconOnly
              label={t("Stop work")}
              tooltip={t("Stop work")}
              onClick={() => props.onStop(target.id)}
            >
              <Square className="icon-sm" />
            </Button>
          )}
          {status === "idle" && (
            <InfoPopover label={t("About voice")} width={260}>
              {realtime
                ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                    p1: realtime.name,
                  })
                : t(
                    "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
                  )}
            </InfoPopover>
          )}
        </div>
        {shownTranscript && (
          <div className={`${styles.turn} ${styles.heard}`}>
            <span className="sr-only">{t("You")}: </span>
            <p className={styles.message}>{shownTranscript}</p>
          </div>
        )}
        {shownMessage && (
          <div className={styles.turn}>
            <span className="sr-only">{t("Reply")}: </span>
            <p className={styles.message}>{shownMessage}</p>
          </div>
        )}
        {shownError &&
          (actionableError ? (
            <InlineError className={styles.caption}>{shownError}</InlineError>
          ) : (
            <>
              <InlineError className={styles.caption}>{t("Voice needs attention")}</InlineError>
              <details className={styles.feedback}>
                <summary>{t("Error details")}</summary>
                <p>{shownError}</p>
              </details>
            </>
          ))}
        {briefingRetry.retryable && <Button disabled={!briefingRetry.canRetry} onClick={briefingRetry.retry}>{t("Retry briefing")}</Button>}
        {shownError ? <MicrophoneRecoveryAction message={shownError} /> : null}
        <LiveText className={styles.caption} text={historyNotice !== shownError ? historyNotice : ""} />
        <LiveText className={styles.caption} text={ruleNotice} />
        {ownerRuleWrites.current.hasPending && (
          <Button loading={savingRule} onClick={() => void saveOwnerRule()}>
            {t("Retry rule save")}
          </Button>
        )}
        {status === "live" && muted && pushToTalkBinding && (
          <p className={styles.caption}>{t("Hold {p1} to talk", { p1: pushToTalkBinding })}</p>
        )}
      </div>
      <div className={styles.actions} hidden={compact}>
        {status === "live" && !compact && (
          <VoiceTurnControl
            manual={settings.manualTurnEnd === true}
            muted={muted}
            onManualChange={setManualTurnEnd}
            onFinish={() => client.current?.finishTurn()}
          />
        )}
        {canTalk ? (
          <>
            <Button
              variant="primary"
              data-voice-start
              disabled={!target && !props.workspace}
              onClick={() => void start()}
              startIcon={<Mic className="icon-sm" />}
            >
              {t(status === "idle" ? "Start voice" : "Talk")}
            </Button>
            {status !== "idle" && (
              <Button iconOnly label={t("Disconnect voice")} onClick={close}>
                <Square className="icon-sm" />
              </Button>
            )}
          </>
        ) : status === "connecting" || status === "reconnecting" ? (
          <Button label={t("Cancel")} startIcon={<X className="icon-sm" />} onClick={close}>
            {t("Cancel")}
          </Button>
        ) : (
          <>
            {/* The mic toggle is the main live action; the rest stay icons. */}
            <Button
              iconOnly
              label={t(muted ? "Resume" : "Pause mic")}
              tooltip={t(muted ? "Resume" : "Pause mic")}
              variant={muted ? "secondary" : "primary"}
              tone={muted ? "danger" : undefined}
              disabled={status !== "live"}
              selected={muted}
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? <MicOff className="icon-sm" /> : <Mic className="icon-sm" />}
            </Button>
            <Button
              iconOnly
              label={t("Silence")}
              tooltip={t("Silence")}
              onClick={() => client.current?.silence()}
            >
              <Pause className="icon-sm" />
            </Button>
            {speakerButton}
            <Button
              iconOnly
              label={t("Disconnect voice")}
              tooltip={t("Disconnect voice")}
              onClick={close}
            >
              <Square className="icon-sm" />
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
