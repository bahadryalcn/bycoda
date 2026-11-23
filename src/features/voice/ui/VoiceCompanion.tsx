import { surfaceAttributes } from "../../../shared/ui/Surface";
import {
  registerVoiceGenerationRetirement,
  recordVoiceGenerationClosure,
  beginVoiceRuntime,
  associateVoiceGeneration,
  bindVoiceGeneration,
  closeVoiceRuntimeEvidence,
} from "../model/voiceGenerationRetirement";
import { narrationWanted, retireNarrationOutput } from "../model/voiceNarrationLifecycle";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { Session } from "../../sessions/public/session";
import { currentExecutionTools } from "../../sessions/public/commandInspection";
import { requestToolsUi } from "../../host-tools";
import { voiceLiveResults } from "../model/voiceLiveWork";
import { sessionsRef as liveSessions, useSession } from "../../sessions/model/sessionsStore";
import { Button } from "../../../shared/ui/Button";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Text } from "../../../shared/ui/Text";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { GripVertical } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { voiceError } from "../model/voiceAssistantNotices";
import { VOICE_HOST_STEP_MS, voiceConnectionStep } from "../model/voiceConnectionStep";
import { voiceInterruptedTurnNotice } from "../model/voiceInstructions";
import { invalidateFeatureHosts } from "../../connections/model/hostFeatureClient";
import { useVoiceSessionProgress } from "../model/voiceSessionProgress";
import { VoiceToolActivity, type VoiceToolActivityEntry } from "../model/voiceToolActivity";
import { VoiceCompanionView } from "./companion/VoiceCompanionView";
import { VoiceCompanionViewInput, voiceCompanionViewTool } from "../model/voiceCompanionViewTool";
import { VoiceLiveWorkspace } from "./companion/VoiceLiveWorkspace";
import {
  presentVoiceResultTool,
  VoicePresentedResultSchema,
  type VoicePresentedResult,
} from "../model/voicePresentedResult";
import {
  VoiceLauncher,
  VoiceReturnButton,
  type VoiceWakeControls,
} from "./companion/VoiceLauncher";
import { useVoiceChatTurns, useVoiceTranscript } from "./companion/useVoiceChatTurns";
import { voiceJobsNeedReview } from "./companion/voiceJobAutoStart";
import { useVoicePushToTalk } from "./useVoicePushToTalk";
import {
  useAssistantControlSource,
  waitForAssistantControlSource,
} from "../../assistant/model/useAssistantControlSource";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { LocalVoice, type SpeechBinding } from "../model/localVoice";
import {
  useVoicePresence,
  useWindowShown,
  readNativeVoicePresence,
  deriveCapturePresence,
  markAcceptedVoiceSpeech,
} from "../model/voicePresence";
import { voiceSleepRequested } from "../model/voiceWakePhrase";
import { shouldSilentlyAcknowledgeVoice, shouldWaitForVoice } from "../model/voiceSpeechPolicy";
import {
  classifyVoiceFailure,
  voiceLostSpeechNotice,
  voiceResumeTurns,
} from "../model/voiceReconnect";
import { VoiceReconnectScheduler } from "../model/voiceReconnectScheduler";
import { VoiceCompanionRecovery } from "./companion/VoiceCompanionRecovery";
import { useVoiceHearing } from "./companion/useVoiceHearing";
import { voiceStatusText } from "./companion/voiceStatusText";
import { useVoiceReturnCall } from "./useVoiceReturnCall";
import { useVoiceTalkEvent } from "./useVoiceTalkEvent";
import { revealVoiceTalkWindow } from "../../../platform/tauri/voiceTalkEvent";
import { RealtimeVoice } from "../model/realtimeVoice";
import { realtimeSecret, type RealtimeProvider } from "../model/realtimeVoiceClient";
import {
  converseWithSession,
  warmVoiceReply,
  immediateVoiceDecision,
} from "../model/voiceConversation";
import { useVoicePanelDrag } from "./companion/useVoicePanelDrag";
import { clampVoicePosition, voiceContext, voiceTarget } from "../model/voiceSession";
import styles from "./VoiceCompanion.module.css";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
} from "../model/voiceSettings";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { VoiceSessionPicker } from "./VoicePanelChoices";
import { saveVoiceTurnEndChoice, VOICE_TURN_CHOICE_FAILED } from "../model/voiceTurnPolicy";
import { createVoiceController } from "../model/voiceController";
import { converseWithAssistant } from "../model/voiceAssistant";
import { voiceTools } from "../model/realtimeVoice";
import { installVoiceApprovalPort } from "./companion/voiceApprovalPort";
import { voiceJobReceipt, voiceJobsAcceptedSpeech } from "../model/voiceJobReceipt";
import {
  voiceTurnProjectPaths,
  voiceWorkspaceSurface,
  type VoiceWorkspaceProject,
} from "../model/voiceWorkspaceActions";
import { voiceUsageReportOf } from "../model/voiceWorkspaceUsage";
import type { UsageReport } from "../../usage/public/usageReport";
import type { useVoiceWorkspaceActions } from "../../../app/workspace/bridges/useVoiceWorkspaceActions";
import { voiceVisualState } from "../model/voiceVisualState";
import { voiceWorkText } from "../model/voiceWork";
import { voiceWorkRefusal } from "../model/voiceWorkAdmission";
import {
  closeVoiceOverlay,
  hasNativeWindows,
  openVoiceOverlay,
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
import { withVoiceSessionBoundary } from "../model/voiceSessionGap";
import { VoicePanelResize } from "./companion/VoicePanelResize";
import { useVoiceLauncherSlot } from "./companion/voiceLauncherSlot";
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
import { playCue } from "../../settings/public/sounds";
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
  voiceOwnerRequestedSessionStop,
  voiceSessionStopTool,
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
  draftVoiceJobs,
  voiceJobProjects,
  changeVoiceJobRows,
  spokenJobReviewDecision,
  type VoiceJobDraft,
  type VoiceJobReviewState,
} from "../model/voiceJobs";
import { captureAssistantHostRead } from "../../assistant/model/assistantHostRead";
import { voiceAssistantControlChoice } from "../model/voiceAssistantControlChoice";
import {
  assistantJobProjectIds,
  assistantJobVisible,
  assistantJobDraftVisible,
  assistantJobDraftReady,
} from "../../assistant/model/assistantJobs";
import { pathKey } from "../../../shared/lib/paths";
import {
  isProjectLocked,
  subscribeGroupLock,
  getGroupLockView,
} from "../../group-lock/model/groupLock";
import {
  canRetryRoomPrivacyProjection,
  getRoomPrivacyStatus,
  recoverRoomPrivacyProjection,
} from "../../group-lock/model/roomPrivacyProjection";
import { useVoiceBriefing } from "./useVoiceBriefing";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { newRequestId } from "../../../shared/lib/id/requestId";

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

export type VoiceCompanionProps = {
  onWorkspaceOutlet?: (outlet: VoiceWorkspaceOutlet | undefined) => void;
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

type VoiceWorkDestination =
  | { kind: "session"; sessionId: string; projectPath: string }
  | { kind: "tools"; panelId: string; projectPath: string };

export type VoiceWorkspaceOutlet = VoiceWorkDestination & {
  element: HTMLElement;
  overlay: symbol | null;
};

const voiceConversationTools = {
  name: "workspace.conversation_tools.open",
  description:
    "Open the requested bycoda Conversation Tool in the exact project and session. An omitted target uses the session bound to accepted speech. Resolve ambiguous targets first. Set surface project for the normal workspace or voice for the fullscreen right drawer. Omit surface or use auto to follow the current call mode.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      projectPath: { type: "string", minLength: 1 },
      sessionId: { type: "string", minLength: 1 },
      surface: voiceWorkspaceSurface,
      tab: { type: "string", enum: ["devices", "browser", "servers", "logs", "resources"] },
    },
    required: ["tab"],
  },
};
export function VoiceCompanion(props: VoiceCompanionProps & { wakeControls?: VoiceWakeControls }) {
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
  const [fullScreen, setFullScreen] = useState(false);
  const workPanelToggle = useRef<HTMLButtonElement>(null);
  const workPanel = useRef<HTMLDivElement>(null);
  const [workPanelRequest, setWorkPanelRequest] = useState(0);
  const [workDestination, setWorkDestination] = useState<{
    revision: number;
    target: VoiceWorkDestination;
  }>();
  const [voiceResultTurn, setVoiceResultTurn] = useState<{ revision: number; since: number }>();
  const [hiddenResults, setHiddenResults] = useState<number>();
  const [presentedResult, setPresentedResult] = useState<{
    revision: number;
    result: VoicePresentedResult;
  }>();
  // The accepted turn's own Usage report; drawn from its data, never from model text.
  const [usageReport, setUsageReport] = useState<{
    revision: number;
    report: UsageReport;
    lock: ReturnType<typeof getGroupLockView>;
  }>();
  const [voiceSubmittedWork, setVoiceSubmittedWork] = useState<{
    revision: number;
    sessionId: string;
    cwd: string;
    text: string;
    previousTurnId: string | undefined;
  }>();
  const [status, setStatus] = useState<
    "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready"
  >("idle");
  const liveConversation =
    status === "connecting" || status === "reconnecting" || status === "live";
  const conversationActive = liveConversation || playback;
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
  useEffect(installVoiceApprovalPort, []);
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
  const [message, setMessage] = useState("");
  const [transcript, setTranscript, transcriptTurn] = useVoiceTranscript();
  const [error, setError] = useState("");
  const ownerSpeech = useRef("");
  /** The owner's last request until a reply to it plays; a reconnect reports it as interrupted. */
  const unansweredTurn = useRef("");
  /** Captured speech died with its connection before any transcript; ask for it once. */
  const lostSpeech = useRef(false);
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
  const compact = settings.compact && !choice && !jobReview && !fullScreen;
  const pendingJobs = useRef<{
    review: VoiceJobReviewState;
    /** False while jobs start without review; a failed start reveals the review. */
    shown: boolean;
    environmentId: string;
    batch: VoiceJobBatch;
    resolve: (value: unknown) => void;
    released?: boolean;
    wait?: { waitForOwner(): void };
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
    if (pending.shown) setJobReview(pending.review);
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
    if (pending.shown) setJobReview(pending.review);
    try {
      // A held privacy failure refuses every Host admission; settle it first, as the Room's retry does.
      if (getRoomPrivacyStatus().error && canRetryRoomPrivacyProjection())
        await recoverRoomPrivacyProjection();
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
      const receipt = await voiceJobReceipt(jobs, (input) =>
        assistantRequest(input, pending.environmentId),
      );
      if (pendingJobs.current !== pending) return;
      pending.resolve(receipt);
      pendingJobs.current = null;
      setJobReview(null);
      if (pending.released) client.current?.speak(voiceJobsAcceptedSpeech(jobs));
    } catch (cause) {
      if (pendingJobs.current === pending) {
        pending.review = {
          ...pending.review,
          busy: false,
          error: voiceError(cause, "Job status is unknown. Check the Room before retrying."),
          accepted: pending.batch.accepted.map((job) => job.id),
        };
        // A direct start that fails shows its one coherent error in the review.
        pending.shown = true;
        setJobReview(pending.review);
        pending.wait?.waitForOwner();
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
      const spoken = spokenJobReviewDecision(text);
      if (spoken) {
        rememberTurn("user", text);
        if (spoken === "start") void startReviewedJobs(pendingJobs.current.review.jobs);
        else cancelJobReview();
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
  const closeFromEffect = useEffectEvent(close);
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
      removeFillers: settings.removeFillers,
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
        closeFromEffect();
        setError(t("Voice settings changed. Reconnect voice to apply."));
      }
    } else client.current?.configureConversation(options);
  }, [
    settings.turnEndSilence,
    settings.allowBargeIn,
    settings.removeFillers,
    settings.manualTurnEnd,
    settings.mode,
    settings.experimentalSemanticVad,
  ]);
  // Hidden companion with no live conversation has no consumer that needs a native read;
  // live capture (safety stop on away) keeps polling even when the page is not shown.
  const windowShown = useWindowShown();
  const detectedPresence = useVoicePresence(
    open && (windowShown || conversationActive),
    settings.idleSleepMinutes,
  );
  const [lastAdmittedSpeechAt, setLastAdmittedSpeechAt] = useState<number | null>(null);
  const markAdmittedSpeech = useCallback(
    () => setLastAdmittedSpeechAt(markAcceptedVoiceSpeech()),
    [],
  );
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
  const briefingRetry = useVoiceBriefing({
    snapshot: assistantSnapshot,
    owner: ownerKey,
    session: JSON.stringify([props.activeId, props.assistantSession?.id]),
    presence,
    status,
    phase,
    muted,
    speakerMuted,
    hold: settings.holdAnnouncements === true,
    playback: playbackRef,
    pendingChoice,
    pendingJobs,
    abort: briefingAbort,
    generation,
    setPlayback,
    setMessage,
    setError,
    formatError: (cause) => voiceError(cause, "Voice could not connect."),
  });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [reconnect] = useState(() => new VoiceReconnectScheduler());
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
  const managementIdle = status === "idle";
  useEffect(() => {
    let active = true;
    setManagementSource(undefined);
    if (!managementBinding || managementBinding.remote || managementIdle) return;
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
  }, [managementBinding, managementIdle]);
  const managementCurrent = !managementIdle && managementBinding?.current?.() !== false;
  useAssistantControlSource(
    managementCurrent ? managementSource?.threadId : undefined,
    managementCurrent ? managementSource?.environmentId : undefined,
    "interactive",
    liveConversation,
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
  const wanted = narrationWanted(assistantSnapshot?.profile);
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
          closeFromEffect();
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
      !wanted ||
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
    wanted,
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
  const shellTarget = voiceTarget(props.activeId, pinned, props.sessions);
  const target = useSession(open ? shellTarget?.id : undefined) ?? shellTarget;
  const findSession = (id: string | undefined) =>
    liveSessions.current.find((item) => item.id === id) ??
    latest.current.sessions.find((item) => item.id === id);
  const currentTarget = () => findSession(pinnedRef.current ?? latest.current.activeId);
  const canChangeCompanionView = useStableCallback(
    () => open && status === "live" && turnCaptured.current && voiceDisclosureCurrent(),
  );
  const changeCompanionView = useStableCallback((input: Record<string, unknown>) => {
    if (!canChangeCompanionView()) throw new Error("There is no active voice conversation.");
    const parsed = VoiceCompanionViewInput.safeParse(input);
    if (!parsed.success) throw new Error("Choose fullscreen, window or mini.");
    const { mode } = parsed.data;
    if (mode === "mini" && (choice || jobReview))
      throw new Error(
        "Answer the open question or finish reviewing the jobs before switching to Mini.",
      );
    // The next tool in this turn can immediately present into the mounted full-screen view.
    flushSync(() => {
      if (mode === "fullscreen") {
        enterFullScreen();
      } else {
        if (detached) dock();
        setCompact(mode === "mini");
        exitFullScreen();
      }
    });
    if (
      mode === "fullscreen"
        ? panel.current?.hasAttribute("data-full-screen") !== true
        : !panel.current ||
          panel.current.hasAttribute("data-full-screen") ||
          panel.current.hasAttribute("data-compact") !== (mode === "mini")
    )
      throw new Error("The requested voice view has not been confirmed.");
    return { action: voiceCompanionViewTool.name, status: "completed" as const, mode };
  });
  const openWorkDestination = useStableCallback(
    (target: VoiceWorkDestination, revision: number) => {
      if (revision !== turnRevision.current || !voiceDisclosureCurrent())
        throw new Error("The voice turn changed before the destination opened.");
      flushSync(() => {
        setWorkDestination({ revision, target });
        setHiddenResults(undefined);
        setWorkPanelRequest((request) => request + 1);
      });
    },
  );
  const findMountedDestination = useStableCallback(
    (attribute: string, id: string, inVoice: boolean, projectPath?: string) => {
      const root = inVoice ? workPanel.current : document;
      return Boolean(
        root &&
        [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].some(
          (element) =>
            element.getAttribute(attribute) === id &&
            (!projectPath ||
              pathKey(element.dataset.sessionProject ?? "") === pathKey(projectPath)) &&
            (!projectPath ||
              element.querySelector<HTMLElement>("[data-session-drop]")?.dataset.sessionDrop ===
                id) &&
            !element.closest("[hidden], [aria-hidden='true']"),
        ),
      );
    },
  );
  const applyWorkspaceSurface = useStableCallback((surface: unknown) => {
    const inVoice = panel.current?.hasAttribute("data-full-screen") === true;
    if (surface === "project" && inVoice) flushSync(exitFullScreen);
    if (surface === "voice" && !inVoice) flushSync(enterFullScreen);
    return panel.current?.hasAttribute("data-full-screen") === true;
  });
  const openConversationTools = useStableCallback(async (input: Record<string, unknown>) => {
    const workspace = latest.current.workspace;
    if (!workspace || !canChangeCompanionView())
      throw new Error("Conversation Tools are unavailable in this voice turn.");
    if (
      Object.keys(input).some(
        (key) => !["projectPath", "sessionId", "tab", "surface"].includes(key),
      ) ||
      (input.projectPath !== undefined && typeof input.projectPath !== "string") ||
      (input.sessionId !== undefined && typeof input.sessionId !== "string") ||
      (input.surface !== undefined &&
        !voiceWorkspaceSurface.enum.includes(String(input.surface))) ||
      !["devices", "browser", "servers", "logs", "resources"].includes(String(input.tab))
    )
      throw new Error("Choose a valid Conversation Tool and target.");
    const revision = turnRevision.current;
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : turnSessionId.current;
    const projectPath =
      typeof input.projectPath === "string"
        ? input.projectPath
        : typeof input.sessionId === "string"
          ? findSession(sessionId)?.cwd
          : turnProjectPath.current;
    if (
      !sessionId ||
      !projectPath ||
      (input.sessionId === undefined && pathKey(projectPath) !== pathKey(turnProjectPath.current))
    )
      throw new Error("Which session in that project should show Conversation Tools?");
    if (!turnAllowedProjectPaths.current.some((path) => pathKey(path) === pathKey(projectPath)))
      throw new Error("That project is outside this voice turn's scope.");
    await workspace.execute("workspace.sessions.open", {
      sessionId,
      projectPath,
      requestId: crypto.randomUUID(),
    });
    if (
      revision !== turnRevision.current ||
      !voiceDisclosureCurrent() ||
      isProjectLocked(projectPath)
    )
      throw new Error("The voice turn or project scope changed before the tool opened.");
    const state = await requestToolsUi(
      { sessionId, cwd: projectPath, title: findSession(sessionId)?.title ?? sessionId },
      "ui.tools.open",
      { tab: input.tab, placement: "right" },
    );
    if (revision !== turnRevision.current || !canChangeCompanionView())
      return {
        action: voiceConversationTools.name,
        status: "accepted" as const,
        projectPath,
        sessionId,
      };
    const mounted = state.panels.find(
      (item) =>
        item.id === state.openedPanelId && item.tab === input.tab && item.mounted && item.visible,
    );
    const inVoice = applyWorkspaceSurface(input.surface);
    if (
      mounted &&
      inVoice &&
      latest.current.onWorkspaceOutlet &&
      mounted.presentation !== "detached"
    )
      openWorkDestination({ kind: "tools", panelId: mounted.id, projectPath }, revision);
    const confirmed =
      mounted &&
      ((mounted.presentation === "detached" &&
        (input.surface === undefined || input.surface === "auto")) ||
        findMountedDestination("data-tools-pane-id", mounted.id, inVoice));
    return {
      action: voiceConversationTools.name,
      status: confirmed ? ("completed" as const) : ("accepted" as const),
      projectPath,
      sessionId,
    };
  });
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
      causalContextUncertified: () => causalGeneration.current?.uncertified(),
      invalidateCausalContext: async () => {
        await causalGeneration.current?.invalidate("unverified-tool");
      },
      workspace: {
        tools: [
          ...(latest.current.workspace?.tools ?? []),
          ...(canChangeCompanionView() ? [voiceCompanionViewTool] : []),
          ...(canChangeCompanionView() ? [presentVoiceResultTool] : []),
          ...(latest.current.workspace && canChangeCompanionView() ? [voiceConversationTools] : []),
        ],
        execute: async (action, input) => {
          if (action === voiceCompanionViewTool.name) return changeCompanionView(input);
          if (action === voiceConversationTools.name) return openConversationTools(input);
          if (action === presentVoiceResultTool.name) {
            if (!canChangeCompanionView())
              throw new Error("There is no active voice turn to show this result in.");
            const parsed = VoicePresentedResultSchema.safeParse(input);
            if (!parsed.success)
              throw new Error("This result cannot be displayed. Use short, non-sensitive facts.");
            flushSync(() => {
              enterFullScreen();
              setPresentedResult({ revision: turnRevision.current, result: parsed.data });
              setWorkDestination(undefined);
              setHiddenResults(undefined);
              setWorkPanelRequest((request) => request + 1);
            });
            return {
              action,
              status: workPanel.current && !workPanel.current.hidden ? "completed" : "accepted",
            };
          }
          if (!latest.current.workspace) throw new Error("Workspace actions are unavailable.");
          if (
            ["workspace.views.open", "workspace.projects.select", "workspace.usage.open"].includes(
              action,
            ) &&
            canChangeCompanionView()
          ) {
            const revision = turnRevision.current;
            const result = await latest.current.workspace.execute(action, input);
            if (
              revision === turnRevision.current &&
              voiceDisclosureCurrent() &&
              panel.current?.hasAttribute("data-full-screen") &&
              (result.status === "completed" || result.status === "accepted")
            )
              applyWorkspaceSurface("project");
            return result;
          }
          if (action === "workspace.sessions.open" && canChangeCompanionView()) {
            if (
              input.surface !== undefined &&
              !voiceWorkspaceSurface.enum.includes(String(input.surface))
            )
              throw new Error("Choose the project workspace or fullscreen voice drawer.");
            const revision = turnRevision.current;
            const result = await latest.current.workspace.execute(action, input);
            if (!result.sessionId || !result.projectPath) return result;
            if (revision !== turnRevision.current || !canChangeCompanionView())
              return { ...result, status: "accepted" };
            const inVoice = applyWorkspaceSurface(input.surface);
            if (inVoice && latest.current.onWorkspaceOutlet)
              openWorkDestination(
                { kind: "session", sessionId: result.sessionId, projectPath: result.projectPath },
                revision,
              );
            return {
              ...result,
              status: findMountedDestination(
                "data-workspace-session-id",
                result.sessionId,
                inVoice,
                result.projectPath,
              )
                ? "completed"
                : "accepted",
            };
          }
          if (action === "workspace.usage.report" && canChangeCompanionView()) {
            const revision = turnRevision.current;
            const result = await latest.current.workspace.execute(action, input);
            const report = voiceUsageReportOf(result);
            if (!report) return result;
            // The read is async: a newer turn or an ended call must not receive this report.
            if (revision !== turnRevision.current || !canChangeCompanionView())
              return { ...result, shown: "not-shown" };
            const inVoice = panel.current?.hasAttribute("data-full-screen") === true;
            flushSync(() => {
              setUsageReport({ revision, report, lock: getGroupLockView() });
              setWorkDestination(undefined);
              setHiddenResults(undefined);
              setWorkPanelRequest((request) => request + 1);
            });
            // Only a full-screen call has the drawer; elsewhere the report waits for this turn's fullscreen.
            return {
              ...result,
              shown:
                inVoice && workPanel.current && !workPanel.current.hidden
                  ? "mounted"
                  : "waiting-for-fullscreen",
            };
          }
          const submission = action === "workspace.sessions.submit";
          const creation = action === "workspace.sessions.create" && input.submit === true;
          const brief = submission ? input.text : creation ? input.prompt : undefined;
          if (typeof brief !== "string" || !turnCaptured.current)
            return latest.current.workspace.execute(action, input);
          const revision = turnRevision.current;
          const before =
            submission && typeof input.sessionId === "string"
              ? findSession(input.sessionId)
              : undefined;
          const previousTurnId = before && currentExecutionTools(before.blocks).turnId;
          const result = await latest.current.workspace.execute(action, input);
          if (
            revision === turnRevision.current &&
            result.status === "accepted" &&
            result.sessionId &&
            result.projectPath &&
            ((submission &&
              before?.id === result.sessionId &&
              pathKey(before.cwd) === pathKey(result.projectPath) &&
              result.accepted === true) ||
              (creation && result.submitted === true))
          ) {
            setVoiceSubmittedWork({
              revision,
              sessionId: result.sessionId,
              cwd: result.projectPath,
              text: brief.trim(),
              previousTurnId,
            });
          }
          return result;
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
  /** Shows the load notice and keeps the real cause in the console for diagnosis. */
  function historyLoadFailed(cause: unknown) {
    console.warn("Voice conversation history could not be loaded", cause);
    setHistoryNotice(t("Conversation history could not be loaded."));
  }
  /** A load notice belongs to the attempt that failed; a pending save notice stays. */
  function clearHistoryLoadNotice() {
    const loadFailed = t("Conversation history could not be loaded.");
    setHistoryNotice((notice) => (notice === loadFailed ? "" : notice));
  }
  /** History open failed before anything was recorded: reopen it, then flush pending writes. */
  function retryHistoryLoad() {
    const binding = activeHistoryBinding.current;
    if (!binding) return;
    setHistoryNotice("");
    void binding.open().then(
      (stored) => {
        if (activeHistoryBinding.current !== binding) return;
        threadSummary.current = stored.thread.summary;
        void transcriptStore.current
          ?.retry()
          .catch(() => setError(t("Conversation was not saved. Retry.")));
      },
      (cause) => {
        if (activeHistoryBinding.current === binding) historyLoadFailed(cause);
      },
    );
  }
  function captureTurn(snapshot: SpeechTarget) {
    turnRevision.current++;
    ownerSpeech.current = "";
    const revision = turnRevision.current;
    setVoiceResultTurn({ revision, since: monotonicNow() });
    setPresentedResult(undefined);
    setUsageReport(undefined);
    setVoiceSubmittedWork(undefined);
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
      .catch((cause) => {
        if (revision === turnRevision.current) historyLoadFailed(cause);
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
    const revision = turnRevision.current;
    const previousTurnId = currentExecutionTools(session.blocks).turnId;
    const result = Promise.resolve().then(async () => {
      if (generation.current !== epoch || !active()) return { accepted: false };
      const accepted = await latest.current.onSubmit(session.id, text);
      if (accepted && generation.current === epoch && active() && turnRevision.current === revision)
        setVoiceSubmittedWork({
          revision,
          sessionId: session.id,
          cwd: session.cwd,
          text,
          previousTurnId,
        });
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
    setVoiceResultTurn(undefined);
    setPresentedResult(undefined);
    setUsageReport(undefined);
    setVoiceSubmittedWork(undefined);
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
    reconnect.cancel();
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
    clearHistoryLoadNotice();
  }
  function stopTo(next: "sleeping" | "ready") {
    stopCapture(next);
    setMuted(false);
  }
  function close() {
    setVoiceResultTurn(undefined);
    setPresentedResult(undefined);
    setUsageReport(undefined);
    setVoiceSubmittedWork(undefined);
    invalidateFeatureHosts();
    setLastAdmittedSpeechAt(null);
    lastDeliveredAssistant.current = "";
    manualPresenceCapture.current = false;
    checkingTalkPresence.current = false;
    cancelJobReview();
    releaseChoice();
    transcriptStore.current?.finish();
    clearTimeout(stableTimer.current);
    reconnect.reset();
    recentTurns.current = [];
    unansweredTurn.current = "";
    lostSpeech.current = false;
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
    clearHistoryLoadNotice();
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
    closeFromEffect();
  }, [connection]);
  function dismiss() {
    close();
    setFullScreen(false);
    returnFocus.current = true;
    setOpen(false);
  }
  function exitFullScreen() {
    setFullScreen(false);
    compactToggle.current?.focus();
  }
  function closeWorkPanel() {
    setHiddenResults(voiceResultTurn?.revision);
    workPanelToggle.current?.focus();
  }
  const workspaceOverlay = useOverlay(
    panel,
    fullScreen,
    fullScreen
      ? () => {
          if (workPanelToggle.current?.getAttribute("aria-expanded") === "true") closeWorkPanel();
          else exitFullScreen();
        }
      : undefined,
    open && !detached,
    undefined,
    false,
    !fullScreen,
  );
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
    if (hasNativeWindows()) void closeVoiceOverlay().catch(() => undefined);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(stableTimer.current);
      reconnect.cancel();
      generation.current++;
      sideRequest.current?.abort();
      transcriptStore.current?.finish();
      closeVoiceRuntime();
    },
    [reconnect],
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
    if (voiceSleepRequested(text, snapshotRef.current?.profile)) {
      queueMicrotask(() => stopTo("ready"));
      return true;
    }
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
    } catch (cause) {
      historyLoadFailed(cause);
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
    const previousSpeech = exchanges.filter((entry) => entry.role === "user").pop()?.text;
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
        promptExchanges = withVoiceSessionBoundary(
          voiceThreadSeed(summary && stored.thread ? stored.thread : { summary: "" }, seed),
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
          onProgress: reply,
          onFailure: setError,
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
              previousSpeech,
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
      if (decision.action === "silence" || decision.action === "stop") {
        if (decision.action === "silence" || !voiceOwnerRequestedSessionStop(text))
          return client.current?.silence();
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
        const refusal = voiceWorkRefusal(
          text,
          "submit_work",
          undefined,
          previousSpeech,
          decision.text ?? text,
        );
        if (refusal) {
          const spoken =
            refusal.intent === "ambiguous"
              ? t("What would you like your assistant to do or change?")
              : t("Select a session and speak again.");
          reply(spoken, session, false, () => recordResponse({ role: "assistant", text: spoken }));
          return;
        }
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
    previousSpeech?: string,
  ) {
    if (generation.current !== epoch || !active() || !voiceDisclosureCurrent())
      return { error: "The voice connection is no longer active." };
    const capturedRevision = turnRevision.current;
    const acceptedSpeech = ownerSpeech.current;
    const refusal = voiceWorkRefusal(
      acceptedSpeech,
      name,
      args.action,
      previousSpeech,
      name === "submit_work" ? args.text : args.input,
    );
    const reviewAmbiguousJob =
      name === "give_jobs" && refusal?.intent === "ambiguous" && Boolean(acceptedSpeech.trim());
    if (refusal && !reviewAmbiguousJob) return refusal;
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
            reviewAmbiguousJob,
          },
        ),
    );
  }
  async function performRealtimeTool(
    name: string,
    args: Record<string, unknown>,
    epoch: number,
    active: () => boolean = () => true,
    wait?: { waitForOwner(): void; reviewAmbiguousJob: boolean },
  ) {
    const revision = turnRevision.current;
    const isActive = () => active() && turnRevision.current === revision;
    if (generation.current !== epoch || !isActive() || !voiceDisclosureCurrent())
      return { error: "The voice connection is no longer active." };
    if (/^(?:conversation|social|runtime_logs|workspace)_/.test(name))
      return {
        status: "failed",
        error:
          "No operation was dispatched. Invoke discovered tools through app_tool_call, using their family and exact action fields.",
      };
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
      const projects = voiceJobProjects(result.projects ?? [], {
        allowed,
        visible,
        locked: isProjectLocked,
        global: turnGlobalScope.current && scopeRef.current,
        projectPath: turnProjectPath.current,
      });
      const defaultPath =
        turnProjectPath.current || latest.current.projectPath || currentTarget()?.cwd;
      const capabilities = (
        await assistantRequest({ op: "snapshot", limit: 100 }, owner.environmentId)
      ).snapshot?.capabilities;
      if (generation.current !== epoch || !isActive()) return { status: "cancelled" };
      // A refused proposal saved nothing; returning it keeps the result definite for the model.
      const drafted = draftVoiceJobs(
        args.jobs,
        projects,
        allowed,
        defaultPath ?? "",
        newRequestId,
        capabilities,
      );
      if (!("jobs" in drafted)) return drafted;
      const { jobs } = drafted;
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
      // A proposal without recognized work intent needs explicit owner review.
      const showReview =
        wait?.reviewAmbiguousJob ||
        voiceJobsNeedReview(
          jobs,
          {
            quickNotes: review.quickNotes === true,
            quickAutomations: review.quickAutomations === true,
          },
          snapshotRef.current?.profile.confirmJobs,
          assistantJobDraftReady,
        );
      if (showReview) {
        setJobReview(review);
        wait?.waitForOwner();
      }
      return new Promise<unknown>((resolve) => {
        pendingJobs.current = {
          review,
          shown: showReview,
          wait,
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
        if (!showReview) void startReviewedJobs(jobs);
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
        playCue("voiceQuestion");
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
    ) {
      const live = () => generation.current === epoch && isActive();
      const result = await thisController().execute(name, args, live);
      // A project this turn created joins its frozen scope; every use still checks visibility.
      const scope = turnAllowedProjectPaths;
      if (turnRevision.current === revision)
        scope.current = voiceTurnProjectPaths(scope.current, args, result);
      return result;
    }
    const session = findSession(turnCaptured.current ? turnSessionId.current : currentTarget()?.id);
    if (!session) return { error: "No session is selected." };
    if (name === "session_context")
      return {
        ...voiceContext(session),
        ...(latest.current.workspace ? { app: thisController().context() } : {}),
      };
    if (name === "stop_work")
      return voiceSessionStopTool(ownerSpeech.current, () => latest.current.onStop(session.id));
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
  function recoverRealtime(provider: RealtimeProvider, rotation = false, code?: string) {
    // The app log is the only record of why a live voice session dropped. Reason codes and
    // state flags only: provider messages and transcripts may contain private text.
    console.warn("[voice] realtime recovering", {
      provider,
      rotation,
      code: code ?? "unclassified",
      at: Date.now(),
      speechLost: lostSpeech.current,
      unansweredTurn: !!unansweredTurn.current,
    });
    // Rotation waits for an idle connection, so nothing from it remains to report.
    if (rotation) {
      unansweredTurn.current = "";
      lostSpeech.current = false;
    }
    invalidateFeatureHosts();
    const wasMuted = mutedRef.current;
    if (presenceRef.current !== "active") {
      stopTo("sleeping");
      setError("");
      return;
    }
    stopCapture("reconnecting", true);
    setMuted(wasMuted);
    setError("");
    const epoch = generation.current;
    const retry = () => {
      if (generation.current !== epoch) return;
      if (presenceRef.current !== "active") {
        stopTo("sleeping");
        return;
      }
      void startRealtime(epoch, provider, true, wasMuted);
    };
    // Slow retries continue until Stop, sleep, a fatal error or the 30 minute cap.
    if (!reconnect.schedule(retry, rotation)) {
      stopCapture("idle");
      setError(t("Couldn’t connect voice. Try again."));
    }
  }
  useEffect(() => {
    const online = () => void reconnect.retryNow();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [reconnect]);
  useEffect(() => {
    if (checkingTalkPresence.current && status === "connecting") return;
    if (
      (capturePresence === "idle" || capturePresence === "away") &&
      (status === "live" || status === "connecting" || status === "reconnecting")
    ) {
      stopTo("sleeping");
      setError("");
    } else if (capturePresence === "active" && status === "sleeping") {
      setStatus("ready"); // Returning never grants microphone permission.
    }
  }, [capturePresence, status]);
  async function startRealtime(
    epoch: number,
    provider: RealtimeProvider,
    reconnecting = false,
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
          unansweredTurn.current = "";
          lostSpeech.current = false;
          rememberTurn("assistant", pending.text);
          transcriptStore.current?.finish();
        },
        replyDiscarded: (responseId) => {
          pendingReplies.delete(responseId);
        },
        transcript: (text) => {
          if (generation.current === epoch) {
            ownerSpeech.current = text;
            unansweredTurn.current = text;
            lostSpeech.current = false;
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
          if (generation.current === epoch) recoverRealtime(provider, true, "rotation");
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
            if (details.speechLost) lostSpeech.current = true;
            recoverRealtime(provider, false, details.code);
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
        removeFillers: settings.removeFillers,
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
    // Every await before the socket is bounded, so "connecting" always ends in live or an error.
    const step = <T,>(name: string, work: Promise<T>, ms: number, message: string) =>
      voiceConnectionStep(name, provider, work, ms, message);
    // Best effort: a stalled step degrades to the fallback instead of failing the connection.
    const soft = <T,>(name: string, work: Promise<T>, fallback: T) =>
      step(name, work, VOICE_HOST_STEP_MS, "").catch(() => fallback);
    const contextStalled = t("Voice could not start: the conversation did not respond.");
    try {
      const secret = await step(
        "secret",
        realtimeSecret(provider),
        VOICE_HOST_STEP_MS,
        t("Voice could not start: the voice key was not issued."),
      );
      if (generation.current !== epoch) return;
      const scope = await soft(
        "scope",
        capturedHistory?.scope?.() ?? Promise.resolve(undefined),
        undefined,
      );
      connectionScope = scope;
      if (generation.current !== epoch) return;
      if (capturedHistory?.current && !capturedHistory.current()) {
        stopCapture("ready", true);
        return;
      }
      let seed: import("../../../shared/model/host-contracts/assistant").AssistantMessage[] = [];
      let seededSummary: ReturnType<typeof voiceThreadSummary>;
      try {
        await step(
          "transcript-retry",
          Promise.resolve(transcriptStore.current?.retry()),
          VOICE_HOST_STEP_MS,
          contextStalled,
        );
      } catch {
        if (generation.current === epoch) setHistoryNotice(t("Conversation was not saved. Retry."));
      }
      try {
        const stored = await step(
          "history-open",
          Promise.resolve(capturedHistory?.open()),
          VOICE_HOST_STEP_MS,
          contextStalled,
        );
        if (stored && scope?.current()) {
          const page = await step(
            "history-seed",
            capturedHistory!.request({
              op: "threads.messages",
              threadId: stored.thread.id,
              limit: 6,
            }),
            VOICE_HOST_STEP_MS,
            contextStalled,
          );
          seed =
            page.messages?.filter((message) => voiceHistoryMessageVisible(message, scope)) ?? [];
          if (page.thread?.id === stored.thread.id)
            seededSummary = voiceThreadSummary(page.thread, scope);
        }
      } catch (cause) {
        if (generation.current === epoch) historyLoadFailed(cause);
      }
      if (generation.current !== epoch || capturedHistory?.current?.() === false) return;
      const storedTurns = voiceThreadSeed({ summary: "" }, seed);
      // A resumed call is the same conversation: restore accepted turns the Host has not
      // stored yet, within the current scope, and never present it as a first contact.
      const safeTurns = (
        reconnecting
          ? voiceResumeTurns(
              storedTurns,
              recentTurns.current.filter(
                (turn) => scope && voiceHistoryMessageVisible(turn, scope),
              ),
            )
          : withVoiceSessionBoundary(storedTurns, seed)
      ).map(({ role, text }) => ({ role, text }));
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
      await step(
        "runtime-register",
        beginVoiceRuntime(voice, provider === "xai" ? "grok" : "openai"),
        VOICE_HOST_STEP_MS,
        t("Voice could not start: the voice runtime did not register."),
      );
      if (!disclosureCurrent()) {
        closeVoiceRuntimeEvidence(voice, voice.retire());
        return;
      }
      if (!capturedHistory) throw new Error("Voice runtime source unavailable.");
      const [sourceHistory, sourceEnvironment] = await step(
        "runtime-source",
        Promise.all([capturedHistory.open(), capturedHistory.environmentId?.()]),
        VOICE_HOST_STEP_MS,
        contextStalled,
      );
      if (!sourceEnvironment || !disclosureCurrent())
        throw new Error("Voice runtime source unavailable.");
      const { isTauri } = await import("@tauri-apps/api/core");
      if (isTauri())
        await step(
          "control-source",
          waitForAssistantControlSource(
            sourceHistory.thread.id,
            sourceEnvironment,
            disclosureCurrent,
          ),
          VOICE_HOST_STEP_MS,
          contextStalled,
        );
      if (!disclosureCurrent()) throw new Error("Voice runtime source changed.");
      await step(
        "runtime-identity",
        causal.bindRuntimeIdentity(capturedHistory),
        VOICE_HOST_STEP_MS,
        contextStalled,
      );
      if (!disclosureCurrent()) {
        closeVoiceRuntimeEvidence(voice, voice.retire());
        return;
      }
      runtimeRegistrationPending = false;
      await voice.connect(secret, safeTurns, {
        renewSecret: () => realtimeSecret(provider),
        summary,
        openWork: await soft(
          "open-work",
          assistantControls.current!.openWork(disclosureCurrent),
          "",
        ),
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
        // A dropped connection must not swallow the owner's request: ask instead of going silent.
        // The markers clear on a played reply or new speech, so an unheard notice survives a drop.
        if (reconnecting && (unansweredTurn.current || lostSpeech.current))
          voice.speak(
            lostSpeech.current
              ? voiceLostSpeechNotice(unansweredTurn.current)
              : voiceInterruptedTurnNotice(unansweredTurn.current),
          );
        // A brief connection must not replenish an endless retry loop.
        stableTimer.current = setTimeout(() => {
          if (generation.current === epoch) reconnect.reset();
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
        recoverRealtime(provider, false, "connect-failed");
      else {
        close();
        setError(voiceError(cause, "Voice could not connect."));
      }
    }
  }
  async function start(wake = false) {
    if (
      client.current ||
      status === "connecting" ||
      (!currentTarget() && !latest.current.workspace)
    )
      return;
    clearTimeout(stableTimer.current);
    reconnect.reset();
    unansweredTurn.current = "";
    lostSpeech.current = false;
    setMuted(false);
    const epoch = ++generation.current;
    const manualAway =
      assistantSnapshot?.presence?.state === "away" || assistantSnapshot?.presence?.state === "dnd";
    checkingTalkPresence.current = wake || manualAway;
    setStatus("connecting");
    setError("");
    setTranscript("");
    setMessage("");
    try {
      // A new owner start captures the current scope before any await. A retired
      // conversation's hidden participants must not cancel this connection.
      historyBindings.current!.clear();
      const selected = currentSpeechTarget(),
        binding = selected.historyBinding!;
      activeHistoryBinding.current = binding;
      if (wake) {
        const actual = await readNativeVoicePresence(settings.idleSleepMinutes);
        if (generation.current !== epoch) return;
        const manual = snapshotRef.current?.presence?.state;
        if ((actual !== "active" && actual !== "idle") || manual === "away" || manual === "dnd") {
          stopCapture("ready", true);
          return;
        }
        // The accepted wake phrase is recent speech even when keyboard/mouse are idle.
        markAdmittedSpeech();
        setOpen(true);
        if (detached) dock();
        void revealVoiceTalkWindow().catch(() =>
          console.warn("[voice] could not reveal the workspace after wake"),
        );
        checkingTalkPresence.current = false;
      } else if (manualAway) {
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
      // Only the profile gates start; a full snapshot would make the Host prove every
      // project referenced by recent Room history before voice could connect.
      const { profile: currentProfile } = await voiceConnectionStep(
        "profile",
        loadVoiceSettings().mode,
        assistantRequest({ op: "profile.get" }),
        VOICE_HOST_STEP_MS,
        t("Voice could not start: the assistant did not respond."),
      );
      if (generation.current !== epoch) return;
      if (currentProfile && snapshotRef.current)
        snapshotRef.current = { ...snapshotRef.current, profile: currentProfile };
      if (!currentProfile?.setupComplete || !currentProfile.voiceSetupComplete)
        throw new Error("Complete voice setup before starting.");
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
        const stored = await voiceConnectionStep(
          "conversation-open",
          loadVoiceSettings().mode,
          opening,
          VOICE_HOST_STEP_MS,
          t("Voice could not start: the conversation did not respond."),
        );
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
      } catch (cause) {
        if (generation.current === epoch) historyLoadFailed(cause);
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
        removeFillers: settings.removeFillers,
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
  const returnCall = useVoiceReturnCall({
    settings,
    snapshot: assistantSnapshot,
    capturePresence,
    status,
    muted,
    speakerMuted,
    available: Boolean(target) || Boolean(props.workspace),
    lastAdmittedSpeechAt,
    briefingDelivering: briefingRetry.delivering,
    start,
    stopToReady: () => stopTo("ready"),
    setPlayback,
  });
  useVoiceTalkEvent({
    status,
    start: (wake) => {
      if (!wake) setOpen(true);
      void start(wake);
    },
  });
  const visualState = voiceVisualState({ status, phase, muted, playback, error });
  const sessionProgress = useVoiceSessionProgress(target);
  const sessionStatusText = t(
    sessionProgress === "quiet" ? "No recent session updates" : "Session working",
  );
  // One shared sampler: the panel re-renders when hearing flips, not for each level value. The
  // detached window mirrors this text, so it keeps sampling while the main window is hidden.
  const hearingInput = useVoiceHearing(audioLevel, status === "live" && !muted, detached);
  const statusText = voiceStatusText({
    status,
    muted,
    playback,
    phase,
    hearingInput,
    realtime: !!realtime,
  });
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
        removeFillers: next.removeFillers,
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
    else if (command === "dismissError") setError("");
    else if (command === "disconnect") close();
    else if (command === "dock") dock();
    else if (command === "openWorkspace") enterFullScreen();
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
  const chatTurns = useVoiceChatTurns(shownTranscript, shownMessage, bodyVisible, transcriptTurn);
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
  const currentResultTurn =
    fullScreen && status === "live" && bodyVisible ? voiceResultTurn : undefined;
  const acceptedWork =
    currentResultTurn?.revision === voiceSubmittedWork?.revision ? voiceSubmittedWork : undefined;
  const storedResultSession = useSession(acceptedWork?.sessionId);
  const resultSession = acceptedWork
    ? [storedResultSession, ...props.sessions].find(
        (session) =>
          session?.id === acceptedWork.sessionId &&
          pathKey(session.cwd) === pathKey(acceptedWork.cwd),
      )
    : undefined;
  const resultSessionVisible =
    resultSession &&
    !isProjectLocked(resultSession.cwd) &&
    (props.projects ?? [{ path: target?.cwd ?? props.projectPath ?? "" }]).some(
      (project) => pathKey(project.path) === pathKey(resultSession.cwd),
    );
  const resultTurnId = resultSessionVisible
    ? currentExecutionTools(resultSession.blocks).turnId
    : undefined;
  const boundedSession =
    resultSession &&
    acceptedWork &&
    resultTurnId &&
    resultTurnId !== acceptedWork.previousTurnId &&
    resultSession.blocks.find((block) => block.id === resultTurnId)?.text.trim() ===
      acceptedWork.text
      ? resultSession
      : undefined;
  const resultActivities = currentResultTurn
    ? visibleToolActivities.filter((entry) => entry.startedAt >= currentResultTurn.since)
    : [];
  const visiblePresentation =
    currentResultTurn && presentedResult?.revision === currentResultTurn.revision
      ? presentedResult.result
      : undefined;
  // A lock change after the read hides the report: its figures were filtered under the old lock.
  const visibleUsage =
    currentResultTurn &&
    usageReport?.revision === currentResultTurn.revision &&
    usageReport.lock === getGroupLockView()
      ? usageReport.report
      : undefined;
  const hasLiveResults = Boolean(
    visiblePresentation ||
    visibleUsage ||
    voiceLiveResults(boundedSession, resultActivities).length,
  );
  const visibleDestination =
    currentResultTurn &&
    workDestination?.revision === currentResultTurn.revision &&
    !isProjectLocked(workDestination.target.projectPath) &&
    !choice &&
    !jobReview
      ? workDestination.target
      : undefined;
  const hasWorkPanel = hasLiveResults || Boolean(visibleDestination);
  const workPanelOpen = hasWorkPanel && hiddenResults !== currentResultTurn?.revision;
  const onWorkspaceOutlet = props.onWorkspaceOutlet;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Publishes the mounted call drawer to the shell's existing pane owners.
  useLayoutEffect(() => {
    if (
      !fullScreen ||
      !onWorkspaceOutlet ||
      !visibleDestination ||
      !workPanelOpen ||
      !workPanel.current
    )
      return;
    onWorkspaceOutlet({
      ...visibleDestination,
      element: workPanel.current,
      overlay: workspaceOverlay,
    });
    return () => onWorkspaceOutlet(undefined);
  }, [fullScreen, onWorkspaceOutlet, visibleDestination, workPanelOpen, workspaceOverlay]);
  function enterFullScreen() {
    if (detached) dock();
    setOpen(true);
    setFullScreen(true);
  }
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Moves DOM focus into the shared overlay after the fullscreen transition.
  useLayoutEffect(() => {
    if (fullScreen) compactToggle.current?.focus();
  }, [fullScreen]);
  useVoiceOverlayHost({
    detached: open && detached,
    level: audioLevel,
    state: {
      status,
      visualState,
      statusText,
      title: `${identity.title} · ${scopeTitle}`,
      name: identity.name,
      avatar: assistantSnapshot?.profile.avatar,
      chatTurns,
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
  const panelDrag = useVoicePanelDrag({
    panel,
    canDetach,
    onDetaching: setDetaching,
    onPosition: setPosition,
    onPopOut: (placement) => void popOut(placement),
  });
  // Where the closed launcher docks; the open panel follows the same footer or rail (styles .panel[data-dock]).
  const launcherSlot = useVoiceLauncherSlot();
  const dockMode = launcherSlot
    ? launcherSlot.hasAttribute("data-compact")
      ? "rail"
      : "footer"
    : undefined;
  const moveName = t("Move voice window");
  const moveHint = t(
    canDetach
      ? "Drag outside the app to float it. Use arrow keys to reposition."
      : "Use arrow keys to reposition.",
  );
  if (open && detached && !props.wakeControls)
    return <VoiceReturnButton ref={launcher} onReturn={dock} />;
  const launcherControl =
    !open || props.wakeControls ? (
      <VoiceLauncher
        ref={launcher}
        visual={settings.visual}
        name={identity.name}
        avatar={assistantSnapshot?.profile.avatar}
        state={visualState}
        returnToWindow={open && detached}
        wakeControls={props.wakeControls}
        onOpen={() => {
          if (open) {
            if (detached) dock();
            else panel.current?.focus();
            return;
          }
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
      />
    ) : null;
  if (!open || detached) return <>{launcherControl}</>;
  const handle = (
    <Button
      touchTarget="control"
      iconOnly
      variant="ghost"
      label={moveName}
      aria-description={moveHint}
      className={styles.drag}
      onDoubleClick={() => {
        if (compact) setCompact(false);
      }}
      data-drag-handle=""
      onKeyDown={panelDrag.onHandleKeyDown}
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
  );
  const companionPanel = (
    <Text
      as="section"
      size="caption"
      tone="neutral"
      leading="inherit"
      ref={panel}
      aria-label={t("Voice companion")}
      role={fullScreen ? "dialog" : undefined}
      aria-modal={fullScreen || undefined}
      {...surfaceAttributes(
        {
          variant: fullScreen ? "opaque-canvas" : "floating",
          frame: detaching ? "focus" : shownError ? "danger" : "pane",
          radius: fullScreen ? undefined : compact ? "pill" : "panel",
        },
        styles.panel,
      )}
      data-compact={compact || undefined}
      data-full-screen={fullScreen || undefined}
      data-live-call={(fullScreen && status === "live") || undefined}
      data-work-panel={(fullScreen && workPanelOpen) || undefined}
      data-dock={dockMode}
      data-detaching={detaching || undefined}
      data-voice-state={visualState}
      tabIndex={-1}
      style={
        position && !fullScreen
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <VoiceCompanionView
        compact={compact}
        status={status}
        phase={phase}
        handle={fullScreen ? null : handle}
        headerDrag={fullScreen ? undefined : panelDrag.header}
        resize={fullScreen ? null : <VoicePanelResize panel={panel} onPosition={setPosition} />}
        fullScreen={fullScreen}
        workPanelRef={workPanel}
        workPanelRequest={workPanelRequest}
        workPanelLabel={
          visibleDestination?.kind === "tools"
            ? t("Conversation tools")
            : visibleDestination?.kind === "session"
              ? t("Sessions")
              : undefined
        }
        workPanelToggleRef={workPanelToggle}
        onToggleWorkPanel={
          hasWorkPanel
            ? workPanelOpen
              ? closeWorkPanel
              : () => setHiddenResults(undefined)
            : undefined
        }
        showWorkPanel={fullScreen && workPanelOpen}
        workPanel={
          fullScreen && workPanelOpen && !visibleDestination ? (
            <VoiceLiveWorkspace
              session={boundedSession}
              activities={resultActivities}
              presented={visiblePresentation}
              usageReport={visibleUsage}
            />
          ) : null
        }
        onToggleFullScreen={fullScreen ? exitFullScreen : enterFullScreen}
        panel={panel}
        sideKey={choice?.id ?? jobReview?.id}
        visualState={visualState}
        working={Boolean(target?.busy)}
        audioLevel={audioLevel}
        title={identity.title}
        name={identity.name}
        scopeTitle={scopeTitle}
        targetTitle={target?.title}
        summary={summary}
        muted={muted}
        speakerMuted={speakerMuted}
        manual={settings.manualTurnEnd === true}
        statusText={statusText}
        sessionStatusText={sessionStatusText}
        startDisabled={!target && !props.workspace}
        engine={realtime ? realtime.name : t("This computer")}
        privacy={
          realtime
            ? t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                p1: realtime.name,
              })
            : t(
                "Audio is processed on this computer. Replies use the session’s signed-in provider. No API key required.",
              )
        }
        pushHint={
          status === "live" && muted && pushToTalkBinding
            ? t("Hold {p1} to talk", { p1: pushToTalkBinding })
            : ""
        }
        workspace={Boolean(props.workspace)}
        globalScope={globalScope}
        canDetach={canDetach && !fullScreen}
        toolActivities={visibleToolActivities}
        chatTurns={chatTurns}
        error={shownError}
        onDismissError={() => setError("")}
        liveText={
          compact
            ? `${shownError || statusText}${target?.busy ? ` | ${sessionStatusText}` : ""}`
            : jobReview && !detached && !jobReviewVisible
              ? t("The selected project is no longer visible.")
              : shownMessage
        }
        toggleRef={compactToggle}
        sessionPicker={
          !props.workspace || !globalScope ? (
            <div className={styles.target}>
              <VoiceSessionPicker
                sessions={props.sessions}
                activeId={props.activeId}
                pinned={pinned}
                onPin={setPinned}
              />
            </div>
          ) : null
        }
        choice={
          choice && !detached && bodyVisible ? (
            <VoiceChoiceCard
              choice={choice}
              onRetry={() => void retryChoice()}
              onReply={answerChoice}
            />
          ) : null
        }
        jobReview={
          jobReview && !detached ? (
            jobReviewVisible ? (
              <VoiceJobReview
                key={jobReview.id}
                review={{
                  ...jobReview,
                  projects: jobReview.projects.filter(
                    (project) =>
                      !isProjectLocked(project.path) &&
                      (
                        props.projects ?? [
                          { path: currentTarget()?.cwd ?? props.projectPath ?? "" },
                        ]
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
          ) : null
        }
        recovery={
          <VoiceCompanionRecovery
            error={error}
            shownError={shownError}
            historyNotice={historyNotice}
            ruleNotice={ruleNotice}
            returnNotice={returnCall.notice}
            briefing={briefingRetry}
            rulePending={ownerRuleWrites.current.hasPending}
            savingRule={savingRule}
            onSaveConversation={() => {
              transcriptStore.current?.finish();
              void transcriptStore.current
                ?.retry()
                .then(() => {
                  setError("");
                  setHistoryNotice("");
                })
                .catch(() => setError(t("Conversation was not saved. Retry.")));
            }}
            onRetryHistory={retryHistoryLoad}
            onSaveRule={() => void saveOwnerRule()}
            onTalkNow={returnCall.talkNow}
          />
        }
        onScopeChange={(value) => {
          scopeRef.current = value;
          setGlobalScope(value);
          clearHistoryLoadNotice();
        }}
        onFloat={() => {
          const rect = panel.current?.getBoundingClientRect();
          void popOut({ fromCursor: false, x: rect?.x ?? 0, y: rect?.y ?? 0 });
        }}
        onStopWaiting={(id) => toolActivity.current?.stopWaiting(id)}
        onStopWork={() => {
          if (target) props.onStop(target.id);
        }}
        onStart={() => void start()}
        onClose={close}
        onDismiss={dismiss}
        onToggleCompact={() => {
          exitFullScreen();
          setCompact(!compact);
        }}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
        onSilence={() => client.current?.silence()}
        onFinish={() => client.current?.finishTurn()}
        onManualChange={setManualTurnEnd}
      />
    </Text>
  );
  return (
    <>
      {launcherControl}
      <OverlayParent.Provider value={workspaceOverlay}>{companionPanel}</OverlayParent.Provider>
    </>
  );
}
