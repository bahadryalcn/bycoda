import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { useLocale, getLocale, useT } from "../../../shared/i18n";
import { ChevronDown, GripVertical, Loader, StickyNote, X } from "../../../shared/ui/icons";
import { sessionPerformanceTrace } from "../../../shared/lib/performanceTrace";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Composer } from "./Composer";
import type { NewSessionOptions } from "../model/newSessionCommand";
import "./session-notes-layout.css";
import { ProjectQuickActions } from "../../projects/ui/ProjectQuickActions";
import type { ExpandingButtonGroupItem } from "../../../shared/ui/ExpandingButtonGroup";
import type { ProjectAction } from "../../projects/model/projectActions";
import type { OpenFileFn } from "../../search/model/search";
import {
  sessionProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import type { Worktree } from "../../source-control/model/worktrees";
import {
  orchestrationCheckoutCwd,
  orchestrator,
  sameCheckout,
} from "../../orchestration/model/orchestration";
import { DiscussionEmpty } from "./DiscussionEmpty";
import { LinkedWorkItemUpdateNotice } from "../../inbox/ui/LinkedWorkItemUpdateNotice";
import { SessionReview } from "./SessionReview";
import { RetryFailedTurn } from "./RetryFailedTurn";
import { PromptOutline } from "./PromptOutline";
import {
  canCompactHarnessContext,
  canStopHarnessBackgroundWork,
  stopHarnessBackgroundWork,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../../integrations/harness";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionWorkCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type PlanBuildTarget,
  type RuntimeMode,
  type Session,
  type WorkspaceMode,
  type ComposerTurnOptions,
} from "../model/session";
import { sessionHasBtwThreads, supportsBtwHarness } from "../model/btw";
import { sessionRetryNotice } from "../model/sessionIssue";
import {
  sameSessionIgnoringStreamingText,
  sameBlocksIgnoringStreamingText,
  sameLastTurnRecall,
  shallowArrayEqual,
} from "../model/stableBlocks";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { BtwSheet, useBtwConversation } from "./BtwSheet";
import { ActivityDock } from "./ActivityDock";
import { InterruptedNotice } from "./InterruptedNotice";
import { CONTINUE_PROMPT } from "../model/inFlight";
import { SubagentSheet, useSubagentSheet } from "./SubagentSheet";
import { useSubagentRelay } from "./useSubagentRelay";
import { isBackgroundOnly, type DockAgent } from "../model/activityDock";
import { requestOpenSubagent, requestViewSubagent } from "./subagentFocus";
import { AgentTranscript } from "./AgentTranscript";
import { Modal } from "../../../shared/ui/Modal";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";
import { Button } from "../../../shared/ui/Button";
import { PooledTranscript, type TranscriptPool } from "./TranscriptPool";
import { TranscriptFind } from "./TranscriptFind";
import {
  clearTranscriptJump,
  peekTranscriptJump,
  subscribeTranscriptJump,
} from "../model/transcriptJump";
import { EmptySession } from "./EmptySession";
import { CrewBackdrop } from "./CrewBackdrop";
import { useComposerDockMotion } from "./useComposerDockMotion";
import {
  acknowledgeQuoteRequest,
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
  type QuoteRequest,
} from "../model/quoteDraft";
import { createNote, noteTitle } from "../../notes";
import {
  getNotesPanelOpen,
  NOTES_PANEL_COMMAND,
  subscribeNotesPanel,
  toggleNotesPanel,
} from "../../notes/notesPanel";
import { SessionNotesPanel } from "../../notes/ui/SessionNotesPanel";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import { BycodaWelcome } from "./BycodaWelcome";
import { projectKey } from "../../../shared/lib/paths";
import { userPromptHistory } from "../model/composerHistory";
import { lastTurnRecall, lastUserTurnBlock } from "../model/editLastTurn";
import { isOperatorUserTurn, operatorUserPrompt } from "../model/operatorCommand";
import { canRewindConversation } from "../model/conversationRewind";
import { conversationRewindStrategy } from "../model/conversationRewindStrategy";
import type { LastTurnRecall } from "../model/editLastTurn";
import {
  loadProjectChatBackgroundSettings,
  projectChatBackgroundImageRevision,
  projectChatBackgroundRevision,
  subscribeProjectChatBackground,
} from "../../projects/model/projectChatBackground";
import { useProjectBackgroundEffect } from "../../projects/ui/useProjectBackgroundEffect";
import { GradientBlurBackground } from "../../settings/ui/GradientBlurBackground";
import { LiveBackgroundLayer } from "../../settings/ui/LiveBackgroundCanvas";
import {
  loadChatBackgroundPath,
  loadNewThreadBackgroundEffect,
  subscribeChatBackgroundPath,
} from "../../settings/model/appearance";
import type { SessionFolderTarget } from "../model/sessionFolders";
import { markLinkedSessionUpdateSeen } from "../../inbox/model/linkedSessionSeen";
import { RemoteSession } from "../../connections/ui/RemoteSession";
import { usePaneSession } from "../model/sessionsStore";
import { isRemoteProjectPath } from "../../projects/model/recents";
import type { HostSession } from "../../connections/model/protocol";
import {
  AdoptedSessionNotice,
  BackgroundSessionIndicator,
} from "../../connections/ui/AdoptedSessionNotice";
import { SharedQueueRecoveryNotice } from "../../connections/ui/SharedQueueRecoveryNotice";
import type { RefreshAdoptedSession } from "../../connections/model/useAdoptedSessions";

export type SessionPaneProps = {
  session: Session;
  workspaceSwitchingSessionId?: string;
  windowMovingSessionIds?: ReadonlySet<string>;
  reviewUndoLocked?: boolean;
  visible: boolean;
  focused: boolean;
  addToChatTarget?: boolean;
  inSplit: boolean;
  composerFocused: boolean;
  composerFocusToken?: number;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  onFocus: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCwdChange: (sessionId: string, cwd: string) => void;
  onBranchChange: (sessionId: string) => void;
  onWorktreeChange?: (sessionId: string, tree: Worktree) => Promise<void>;
  onRemoteSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onRefreshAdoptedSession?: RefreshAdoptedSession;
  onWorkspaceModeChange: (sessionId: string, mode: WorkspaceMode, base?: string) => void;
  onWorktreeBaseChange: (sessionId: string, base: string) => void;
  onManageWorktrees?: () => void;
  onModelChange: (sessionId: string, harness: HarnessId, model: string, accountId?: string) => void;
  onModelSettingsChange: (sessionId: string, settings: Record<string, string>) => void;
  onRuntimeModeChange: (sessionId: string, mode: RuntimeMode) => void;
  onSubmit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  onSaveDraft: (sessionId: string, text: string, attachments: Attachment[]) => boolean | void;
  onRemoveDraft: (sessionId: string, draftBlockId: string) => boolean | void;
  onStop: (sessionId: string) => void;
  onCompactContext: (sessionId: string) => boolean;
  onNewSession?: (sessionId: string, options?: NewSessionOptions) => void;
  /** Open the picker of conversations Claude Code stored for this project. */
  onResumeProviderSession?: (sessionId: string) => void;
  onPlaceSessionInFolder: (sessionId: string, target: SessionFolderTarget) => void;
  onDeleteQueuedMessage: (sessionId: string, messageId: string) => void;
  onEditQueuedMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    attachments: Attachment[],
  ) => void;
  onQueuedMessageEditingChange: (sessionId: string, messageId?: string) => void;
  onReorderQueuedMessages?: (sessionId: string, messageIds: string[]) => void;
  onSteerQueuedMessage: (
    sessionId: string,
    messageId: string,
  ) => import("../model/queueAction").QueueAction;
  onResumeQueue: (sessionId: string) => import("../model/queueAction").QueueAction;
  onUsageLimitResume?: (sessionId: string) => void;
  onUsageLimitResumeAtReset: (sessionId: string, enabled: boolean) => void;
  onUsageLimitDismiss: (sessionId: string) => void;
  onSelectProviderAccount?: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  onInboxCardDismiss?: (sessionId: string) => void;
  onLinkedWorkItemUpdateCardDismiss?: (sessionId: string) => void;
  onNoteCardDismiss?: (sessionId: string) => void;
  onHandoffCardDismiss?: (sessionId: string) => void;
  onOpenLinkedWorkItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => Promise<boolean>;
  onDeleteSession?: (sessionId: string) => Promise<boolean>;
  onRewindMessage?: (sessionId: string, blockId: string) => Promise<boolean>;
  onApproval: (sessionId: string, requestId: number, decision: ApprovalDecision) => void;
  onQuestionReply: (sessionId: string, requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (sessionId: string, requestId: number) => void;
  onOpenFile: OpenFileFn;
  onOpenDiff: (path?: string, session?: { sessionId: string; cwd: string }) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
  onBuildPlan: (sessionId: string, blockId: string, target?: PlanBuildTarget) => void;
  onSecondOpinion?: (sessionId: string, target: ModelTarget, turn: Block[]) => void;
  onHandoff?: (sessionId: string, target: ModelTarget, turn: Block[]) => void;
  onBtwSubmit?: (
    sessionId: string,
    turn: Block[],
    threadId: string,
    messageId: string,
    text: string,
    model?: string,
    modelSettings?: Record<string, string>,
  ) => boolean | void;
  onBtwRetry?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwDelete?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwStop?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwModelChange?: (
    sessionId: string,
    turn: Block[],
    threadId: string,
    model: string,
    modelSettings: Record<string, string>,
  ) => void;
  onNewTerminal: (sessionId: string) => void;
  onRunProjectAction?: (sessionId: string, action: ProjectAction) => void;

  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Keeps this transcript mounted after the pane closes. */
  transcriptPool?: TranscriptPool;
  /** Remote history is fetched only when the reader reaches its loaded boundary. */
  remoteHistoryHasMore?: boolean;
  remoteHistoryLoading?: boolean;
  remoteHistoryError?: string;
  onLoadRemoteHistory?: () => Promise<number | void> | void;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
};

type Props = SessionPaneProps & {
  /** The session runtime is on another machine. */
  remoteSession?: boolean;
  remoteFeatures?: { attachments: boolean; plan: boolean; draft: boolean; steer?: boolean };
  /** An opened host conversation whose transcript has not arrived yet. */
  remoteSessionLoading?: boolean;
  remoteSessionStarted?: boolean;
  workingMachine?: string;
  headerStatus?: ReactNode;
  /** A host chat whose last turn the host lost: shows Continue, as a quit turn does locally. */
  interruptedTurn?: boolean;
  /** Why a message to the host cannot be delivered now; Send still tries to reconnect. */
  sendBlockedReason?: string;
  allowedModelHarnesses?: readonly HarnessId[];
};

function RewoundHistoryDisclosure({
  history,
  truncated = false,
}: {
  history: NonNullable<Session["rewindHistory"]>;
  truncated?: boolean;
}) {
  const t = useT();
  return (
    <details
      data-rewind-history
      className="mx-auto max-h-64 w-full max-w-4xl shrink-0 overflow-y-auto border-b border-(--ui-tone-neutral-border) px-3 py-2 text-xs text-[var(--ui-text-secondary)]"
    >
      <summary className="cursor-pointer hover:text-(--ui-tone-neutral-fg)">
        {t("Rewound history ({p0})", { p0: history.length })}
      </summary>
      {truncated ? (
        <p className="mt-1 text-[var(--ui-text-disabled)]">
          {t("Showing a preview of rewound history.")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-3">
        {[...history].reverse().map((entry) => (
          <section key={entry.id} className="flex flex-col gap-2">
            <time
              dateTime={new Date(entry.createdAt).toISOString()}
              className="text-[var(--ui-text-disabled)]"
            >
              {new Date(entry.createdAt).toLocaleString(getLocale())}
            </time>
            {entry.blocks
              .filter(
                (block) =>
                  !block.internal &&
                  !block.draft &&
                  (Boolean(block.text) || Boolean(block.attachments?.length)),
              )
              .map((block, index) => (
                <article
                  key={`${block.id}:${index}`}
                  className="min-w-0 rounded-md bg-[var(--ui-surface)] px-2.5 py-2"
                >
                  {block.text ? (
                    <pre className="select-text whitespace-pre-wrap break-words font-sans text-(--ui-tone-neutral-fg)">
                      {block.text}
                    </pre>
                  ) : null}
                  {block.attachments?.length ? (
                    <p className="mt-1 break-words text-[var(--ui-text-secondary)]">
                      {t("Attachments")}: {block.attachments.map((file) => file.name).join(", ")}
                    </p>
                  ) : null}
                </article>
              ))}
          </section>
        ))}
      </div>
    </details>
  );
}

function sameRemoteFeatures(a: Props["remoteFeatures"], b: Props["remoteFeatures"]): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.attachments === b.attachments &&
      a.plan === b.plan &&
      a.draft === b.draft &&
      a.steer === b.steer)
  );
}

export const SessionPane = memo(function SessionPane(props: SessionPaneProps) {
  useLocale();
  // The shell hands down sessions that lag behind by streamed text; the store
  // holds the live one, and this subscription is what repaints the stream. A
  // hidden pane only follows the shell, so a busy background tab does not
  // re-render on every streamed frame.
  const live = usePaneSession(props.session.id, props.visible) ?? props.session;
  // Sessions in a project on another machine render this same pane, backed by
  // the host instead of this computer's session runtime.
  if (isRemoteProjectPath(props.session.cwd))
    return (
      <RemoteSession
        shell={props.session}
        visible={props.visible}
        onSnapshot={props.onRemoteSnapshot}
        onOpenFile={props.onOpenFile}
        onOpenDiff={props.onOpenDiff}
        onOpenPlan={props.onOpenPlan}
        render={(remote) => <LocalSessionPane {...props} {...remote} />}
      />
    );
  return <LocalSessionPane {...props} session={live} />;
});

const LocalSessionPane = memo(function LocalSessionPane({
  remoteSession = false,
  remoteFeatures,
  remoteSessionLoading = false,
  remoteSessionStarted = false,
  workingMachine,
  headerStatus,
  interruptedTurn,
  sendBlockedReason,
  allowedModelHarnesses,
  session,
  workspaceSwitchingSessionId,
  windowMovingSessionIds,
  reviewUndoLocked = false,
  visible,
  focused,
  addToChatTarget = focused,
  inSplit,
  composerFocused,
  composerFocusToken,
  recents,
  hideProjectPicker,
  onFocus,
  onClose,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  onRefreshAdoptedSession,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  onManageWorktrees,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onSaveDraft,
  onRemoveDraft,
  onSubmit,
  onStop,
  onCompactContext,
  onNewSession,
  onPlaceSessionInFolder,
  onResumeProviderSession,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onQueuedMessageEditingChange,
  onReorderQueuedMessages,
  onSteerQueuedMessage,
  onResumeQueue,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onSelectProviderAccount,
  onInboxCardDismiss,
  onLinkedWorkItemUpdateCardDismiss,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onOpenLinkedWorkItem,
  onArchiveSession,
  onDeleteSession,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSecondOpinion,
  onHandoff,
  onBtwSubmit,
  onBtwRetry,
  onBtwDelete,
  onBtwStop,
  onBtwModelChange,
  onNewTerminal,
  onRunProjectAction,
  onPaneDragStart,
  transcriptPool,
  onRewindMessage,
  remoteHistoryHasMore = false,
  remoteHistoryLoading = false,
  remoteHistoryError,
  onLoadRemoteHistory,
  onLoadRemoteBlock,
}: Props) {
  const t = useT();
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const managed = orchestrationRuns.some(
    (run) =>
      (run.status === "active" || run.status === "paused") &&
      sameCheckout(orchestrationCheckoutCwd(run), sessionWorkCwd(session)),
  );
  const title = sessionDisplayTitle(session.title, session.harness);
  const retryNotice = sessionRetryNotice(session.retryMessage);
  const isEmpty = session.blocks.length === 0;
  const remote = remoteSession;
  const activeSessionIdRef = useRef(session.id);
  activeSessionIdRef.current = session.id;
  const stableSession = useStableValue(session, sameSessionIgnoringStreamingText);
  const stableBlocks = useStableValue(session.blocks, sameBlocksIgnoringStreamingText);
  const lastUserMessage = useMemo(() => lastUserTurnBlock(stableBlocks), [stableBlocks]);
  const editLastTurnSupported = Boolean(
    onRewindMessage &&
    lastUserMessage &&
    canRewindConversation(stableSession, lastUserMessage.id) &&
    !managed &&
    !session.inboxAsk &&
    !session.worktreeRemoved &&
    !sendBlockedReason,
  );
  // `session.blocks` is a new array every streamed frame; these keep one
  // reference while only the streaming text changed, so the memoized Composer
  // and its siblings stay put.
  const turnRecall = useStableValue(
    useMemo(
      () => (editLastTurnSupported ? lastTurnRecall(stableSession) : null),
      [editLastTurnSupported, stableSession],
    ),
    sameLastTurnRecall,
  );
  const stableRemoteFeatures = useStableValue(remoteFeatures, sameRemoteFeatures);
  const stableAllowedHarnesses = useStableValue(allowedModelHarnesses, shallowArrayEqual);
  // Find and the outline read live text only while a search or a card is open.
  const [findSearching, setFindSearching] = useState(false);
  const [findAction, setFindAction] = useState<ExpandingButtonGroupItem | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const draftBlock = useMemo(() => sessionDraftBlock(stableSession), [stableSession]);
  useSyncExternalStore(
    subscribeProjectChatBackground,
    projectChatBackgroundRevision,
    projectChatBackgroundRevision,
  );
  const globalBackgroundPath = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadChatBackgroundPath,
    loadChatBackgroundPath,
  );
  const globalBackgroundEffect = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadNewThreadBackgroundEffect,
    loadNewThreadBackgroundEffect,
  );
  const projectBackground = loadProjectChatBackgroundSettings(projectKey(session.cwd));
  const projectBackgroundUrl = useProjectBackgroundEffect(
    projectBackground?.path ?? null,
    projectBackground?.effect ?? "none",
    projectChatBackgroundImageRevision(),
  );
  const projectBackgroundPresent = !!projectBackground;
  const projectBackgroundEmptyOpacity = projectBackground?.emptyOpacity;
  const projectBackgroundSessionOpacity = projectBackground?.sessionOpacity;
  const projectBackgroundStyle = useMemo(
    () =>
      projectBackgroundPresent
        ? ({
            "--chat-background-image": projectBackgroundUrl
              ? `url(${JSON.stringify(projectBackgroundUrl)})`
              : "none",
            "--chat-background-empty-opacity": String(projectBackgroundEmptyOpacity),
            "--chat-background-session-opacity": String(projectBackgroundSessionOpacity),
          } as CSSProperties)
        : undefined,
    [
      projectBackgroundPresent,
      projectBackgroundUrl,
      projectBackgroundEmptyOpacity,
      projectBackgroundSessionOpacity,
    ],
  );
  const approve = useCallback(
    (requestId: number, decision: ApprovalDecision) => onApproval(session.id, requestId, decision),
    [onApproval, session.id],
  );
  const replyQuestion = useCallback(
    (requestId: number, reply: UserQuestionReply) => onQuestionReply(session.id, requestId, reply),
    [onQuestionReply, session.id],
  );
  const openPlan = useCallback(
    (blockId: string) => onOpenPlan(session.id, blockId),
    [onOpenPlan, session.id],
  );
  const buildPlan = useCallback(
    (blockId: string, target?: PlanBuildTarget) => onBuildPlan(session.id, blockId, target),
    [onBuildPlan, session.id],
  );
  const jumpToBottomRef = useRef<(() => void) | null>(null);
  const transcriptScope = useRef<HTMLDivElement>(null);
  const [transcriptScroller, setTranscriptScroller] = useState<HTMLDivElement | null>(null);
  const focusPane = useCallback(() => onFocus(session.id), [onFocus, session.id]);
  const quoteRequestId = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [editingLastTurn, setEditingLastTurn] = useState(false);
  const [pendingRewind, setPendingRewind] = useState<{
    sessionId: string;
    block: Block;
    action: "edit" | "return";
    recall: LastTurnRecall;
  } | null>(null);
  const [rewindingMessage, setRewindingMessage] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const [rewindDraftSignal, setRewindDraftSignal] = useState<{
    sessionId: string;
    id: string;
    value: LastTurnRecall;
  } | null>(null);
  const rewindIncludesGroupedTurn = Boolean(
    pendingRewind &&
    session.harness === "codex" &&
    conversationRewindStrategy(session, pendingRewind.block.id, true).blockId !==
      pendingRewind.block.id,
  );
  useEffect(() => {
    setEditingLastTurn(false);
  }, [session.id, editLastTurnSupported]);
  useEffect(() => {
    setPendingRewind(null);
    setRewindError(null);
    setRewindDraftSignal(null);
  }, [session.id]);
  const modelWelcomeSequence = useRef(0);
  const decorativeMotionEnabled = useDecorativeMotionEnabled();
  const [modelWelcome, setModelWelcome] = useState<{
    run: number;
  } | null>(null);
  const dismissModelWelcome = useCallback(() => setModelWelcome(null), []);
  useEffect(() => {
    if (!visible || !decorativeMotionEnabled) setModelWelcome(null);
  }, [visible, decorativeMotionEnabled]);
  // Restore a saved run for this lead; its agents render on the sidebar card.
  useEffect(() => {
    if (!remote && !session.inboxAsk && !session.worktreeRemoved)
      void orchestrator.hydrate(session.id).catch(console.error);
  }, [remote, session.id, session.inboxAsk, session.worktreeRemoved]);
  const [quoteRequest, setQuoteRequest] = useState<QuoteRequest>();
  const btw = useBtwConversation({
    available:
      !remote &&
      !isEmpty &&
      !managed &&
      !session.inboxAsk &&
      !session.worktreeRemoved &&
      !!onBtwSubmit &&
      !!onBtwRetry &&
      (supportsBtwHarness(session.harness) || sessionHasBtwThreads(stableBlocks)),
    blocks: stableBlocks,
    harness: session.harness,
    managed,
    model: session.model,
    modelSettings: session.modelSettings,
    onSubmit: (turn, threadId, messageId, text, model, modelSettings) =>
      onBtwSubmit?.(session.id, turn, threadId, messageId, text, model, modelSettings),
    onRetry: (turn, threadId) => onBtwRetry?.(session.id, turn, threadId),
    onDelete: (turn, threadId) => onBtwDelete?.(session.id, turn, threadId),
    onStop: (turn, threadId) => onBtwStop?.(session.id, turn, threadId),
    onModelChange: (turn, threadId, model, modelSettings) =>
      onBtwModelChange?.(session.id, turn, threadId, model, modelSettings),
  });
  const onJumpToBottomReady = useCallback((jump: (() => void) | null) => {
    jumpToBottomRef.current = jump;
  }, []);
  const revealBlockRef = useRef<((blockId: string) => boolean) | null>(null);
  const onRevealReady = useCallback((reveal: ((blockId: string) => boolean) | null) => {
    revealBlockRef.current = reveal;
  }, []);
  const revealBlock = useCallback(
    (blockId: string) => revealBlockRef.current?.(blockId) ?? false,
    [],
  );
  const navigateBlockRef = useRef<((blockId: string | null, query?: string) => boolean) | null>(
    null,
  );
  const [navigatorReady, setNavigatorReady] = useState(false);
  const onNavigateReady = useCallback(
    (navigate: ((blockId: string | null, query?: string) => boolean) | null) => {
      navigateBlockRef.current = navigate;
      setNavigatorReady(navigate !== null);
    },
    [],
  );
  const navigateBlock = useCallback(
    (blockId: string | null, query?: string) => navigateBlockRef.current?.(blockId, query) ?? false,
    [],
  );
  // The dock's rows: bring the run into view, and open it once it is there.
  const showAgentInTranscript = useCallback(
    (blockId: string) => {
      requestOpenSubagent(blockId);
      navigateBlock(blockId);
    },
    [navigateBlock],
  );
  const subagentSheet = useSubagentSheet(stableBlocks, visible);
  const closeSubagentSheet = subagentSheet.close;
  // Claude can end one task on its own; the others only end the whole turn.
  const perItemStop = canStopHarnessBackgroundWork(session.harness);
  const stopBackground = useStableCallback((callId?: string) =>
    stopHarnessBackgroundWork(session.harness, session.id, callId),
  );
  // Only one sheet over the pane at a time: a side question takes over.
  useEffect(() => {
    if (btw.open) closeSubagentSheet();
  }, [btw.open, closeSubagentSheet]);
  const openDockAgent = useCallback(
    (agent: DockAgent) => {
      if (agent.kind === "agent") requestViewSubagent(agent.blockId);
      else subagentSheet.open(agent.blockId);
    },
    [subagentSheet.open],
  );
  const jumpRequest = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(session.id),
    () => null,
  );
  useEffect(() => {
    if (!visible || !navigatorReady || !jumpRequest) return;
    const frame = requestAnimationFrame(() => {
      if (navigateBlock(jumpRequest.blockId, jumpRequest.query)) {
        clearTranscriptJump(session.id, jumpRequest.token);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, navigatorReady, jumpRequest, navigateBlock, session.id]);
  const addSelectionToChat = useCallback((text: string, mode?: QuoteRequest["mode"]) => {
    quoteRequestId.current += 1;
    setQuoteRequest({ id: quoteRequestId.current, text, mode });
  }, []);
  const acknowledgeQuote = useCallback((handledId: number) => {
    setQuoteRequest((current) => acknowledgeQuoteRequest(current, handledId));
  }, []);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const notesPanelOpen = useSyncExternalStore(subscribeNotesPanel, getNotesPanelOpen, () => false);
  // One panel, docked beside the focused pane, so a split never shows two.
  const showNotesPanel = notesEnabled && notesPanelOpen && visible && focused;
  const paneRef = useRef<HTMLDivElement>(null);
  const notesPanelWasShown = useRef(false);
  useEffect(() => {
    // Closing the panel from the keyboard hands focus back to the composer.
    if (notesPanelWasShown.current && !showNotesPanel && visible && focused) {
      paneRef.current?.querySelector<HTMLTextAreaElement>("[data-composer-box] textarea")?.focus();
    }
    notesPanelWasShown.current = showNotesPanel;
  }, [showNotesPanel, visible, focused]);
  const saveNote = useCallback(
    async (text: string) => {
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      await createNote({
        title: sessionTitle && sessionTitle !== "New session" ? sessionTitle : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.harness, session.id, session.title],
  );
  const saveSelectionNote = useCallback(
    async (text: string) => {
      await createNote({
        title: noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.id],
  );

  useEffect(() => {
    if (!addToChatTarget) return;
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;
      addSelectionToChat(detail.text, detail.mode);
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  }, [addSelectionToChat, addToChatTarget]);
  const workCwd = sessionWorkCwd(session);
  const showDeckProjectPicker = isEmpty && !looksLikeProject(session.cwd);
  const dockComposer =
    remoteSessionLoading || (!draftBlock && (!isEmpty || inSplit || !!session.inboxAsk));
  const composerDockMotion = useComposerDockMotion(dockComposer);
  const draftRef = useRef<string | undefined>(getComposerDraft(session.id));
  // Composer is memoized: every handler keeps one identity and calls the
  // latest closure, so it re-renders only when something it shows changed.
  const composerDraftChange = useStableCallback((text: string) => {
    draftRef.current = text;
    setComposerDraft(session.id, text);
  });
  const composerInboxCardDismiss = useStableCallback(() => onInboxCardDismiss?.(session.id));
  const composerNoteCardDismiss = useStableCallback(() => onNoteCardDismiss?.(session.id));
  const composerHandoffCardDismiss = useStableCallback(() => onHandoffCardDismiss?.(session.id));
  const composerQuestionInteraction = useStableCallback((id: number) =>
    onQuestionInteraction?.(session.id, id),
  );
  const composerFocus = useStableCallback(() => onFocus(session.id));
  const composerNewSession = useStableCallback((options?: NewSessionOptions) =>
    onNewSession?.(session.id, options),
  );
  const composerCwdChange = useStableCallback((cwd: string) => onCwdChange(session.id, cwd));
  const composerBranchChange = useStableCallback(() => onBranchChange(session.id));
  const composerWorktreeChange = useStableCallback(
    onWorktreeChange ? (tree: Worktree) => onWorktreeChange(session.id, tree) : undefined,
  );
  const composerWorkspaceModeChange = useStableCallback((mode: WorkspaceMode, base?: string) =>
    onWorkspaceModeChange(session.id, mode, base),
  );
  const composerWorktreeBaseChange = useStableCallback((base: string) =>
    onWorktreeBaseChange(session.id, base),
  );
  const composerNewTerminal = useStableCallback(() => onNewTerminal(session.id));
  const composerModelChange = useStableCallback(
    (harness: HarnessId, model: string, accountId?: string) => {
      onModelChange(session.id, harness, model, accountId);
      // A new key restarts the animation and its cleanup timer on every pick.
      setModelWelcome(decorativeMotionEnabled ? { run: ++modelWelcomeSequence.current } : null);
    },
  );
  const composerModelSettingsChange = useStableCallback((settings: Record<string, string>) =>
    onModelSettingsChange(session.id, settings),
  );
  const composerRuntimeModeChange = useStableCallback((mode: RuntimeMode) =>
    onRuntimeModeChange(session.id, mode),
  );
  const composerSaveDraft = useStableCallback((text: string, attachments: Attachment[]) =>
    onSaveDraft(session.id, text, attachments),
  );
  const composerSubmit = useStableCallback(
    (text: string, attachments: Attachment[], options?: ComposerTurnOptions) => {
      if (!dockComposer) composerDockMotion.captureLaunch();
      return onSubmit(session.id, text, attachments, options);
    },
  );
  const composerBtwCommand = useStableCallback(btw.openWith);
  const subagentRelayBlockedReason =
    sendBlockedReason ||
    (managed || remote || session.inboxAsk || session.worktreeRemoved || editingLastTurn
      ? t("Messaging is unavailable in this conversation.")
      : undefined);
  const subagentRelay = useSubagentRelay({
    sessionId: session.id,
    block: subagentSheet.block,
    blocked: !!subagentRelayBlockedReason,
    onSubmit: (text, options) => onSubmit(session.id, text, [], options),
  });
  const composerStop = useStableCallback(() => onStop(session.id));
  const composerCompactContext = useStableCallback(() => onCompactContext(session.id));
  const composerPlaceInFolder = useStableCallback((target: SessionFolderTarget) =>
    onPlaceSessionInFolder(session.id, target),
  );
  const composerResumeProviderSession = useStableCallback(
    onResumeProviderSession ? () => onResumeProviderSession(session.id) : undefined,
  );
  const composerDeleteQueuedMessage = useStableCallback((messageId: string) =>
    onDeleteQueuedMessage(session.id, messageId),
  );
  const composerEditQueuedMessage = useStableCallback(
    (messageId: string, text: string, attachments: Attachment[]) =>
      onEditQueuedMessage(session.id, messageId, text, attachments),
  );
  const composerQueuedMessageEditingChange = useStableCallback((messageId?: string) =>
    onQueuedMessageEditingChange(session.id, messageId),
  );
  const composerReorderQueuedMessages = useStableCallback(
    onReorderQueuedMessages
      ? (messageIds: string[]) => onReorderQueuedMessages(session.id, messageIds)
      : undefined,
  );
  const composerSteerQueuedMessage = useStableCallback((messageId: string) =>
    onSteerQueuedMessage(session.id, messageId),
  );
  const composerResumeQueue = useStableCallback(() => onResumeQueue(session.id));
  const composerUsageLimitResume = useStableCallback(() => onUsageLimitResume?.(session.id));
  const composerUsageLimitResumeAtReset = useStableCallback((enabled: boolean) =>
    onUsageLimitResumeAtReset(session.id, enabled),
  );
  const composerUsageLimitDismiss = useStableCallback(() => onUsageLimitDismiss(session.id));
  const composerSelectProviderAccount = useStableCallback(
    (provider: ProviderAccountProvider, accountId: string) =>
      onSelectProviderAccount?.(session.id, provider, accountId),
  );
  const composerPromptHistory = useStableCallback(() => userPromptHistory(session));
  const composerRecallMessageApplied = useCallback((id: string) => {
    setRewindDraftSignal((current) => (current?.id === id ? null : current));
  }, []);
  const requestMessageRewind = useCallback(
    (block: Block, action: "edit" | "return", recall?: LastTurnRecall) => {
      if (!canRewindConversation(session, block.id)) return;
      setRewindError(null);
      setPendingRewind({
        sessionId: session.id,
        block,
        action,
        recall: recall ?? {
          text: isOperatorUserTurn(block) ? `/operator ${operatorUserPrompt(block)}` : block.text,
          attachments: block.attachments ?? [],
        },
      });
    },
    [session],
  );
  const rewindLastTurnToDraft = useCallback(
    (recall: LastTurnRecall) => {
      if (lastUserMessage) requestMessageRewind(lastUserMessage, "edit", recall);
    },
    [lastUserMessage, requestMessageRewind],
  );
  const confirmMessageRewind = useCallback(async () => {
    if (!pendingRewind || rewindingMessage || !onRewindMessage) return;
    const requestedSessionId = pendingRewind.sessionId;
    if (requestedSessionId !== session.id) return;
    if (
      !canRewindConversation(session, pendingRewind.block.id) ||
      managed ||
      session.inboxAsk ||
      session.worktreeRemoved ||
      sendBlockedReason
    ) {
      setRewindError(t("This conversation can no longer be rewound."));
      return;
    }
    setRewindingMessage(true);
    setRewindError(null);
    try {
      const accepted = await onRewindMessage(requestedSessionId, pendingRewind.block.id);
      if (activeSessionIdRef.current !== requestedSessionId) return;
      if (!accepted) {
        setRewindError(t("The conversation could not be rewound. Try again."));
        return;
      }
      if (pendingRewind.action === "edit") {
        setRewindDraftSignal({
          sessionId: requestedSessionId,
          id: crypto.randomUUID(),
          value: pendingRewind.recall,
        });
      }
      setPendingRewind(null);
    } catch {
      setRewindError(t("The conversation could not be rewound. Try again."));
    } finally {
      setRewindingMessage(false);
    }
  }, [managed, onRewindMessage, pendingRewind, rewindingMessage, sendBlockedReason, session]);
  const stopDockAgent = useStableCallback((agent: DockAgent) =>
    agent.callId ? stopBackground(agent.callId) : Promise.reject(new Error("No call to stop")),
  );
  const stopDockAll = useStableCallback(() =>
    perItemStop ? stopBackground() : Promise.resolve(onStop(session.id)),
  );
  const continueInterruptedTurn = useStableCallback(() =>
    onSubmit(session.id, CONTINUE_PROMPT, []),
  );
  const sessionBusy = !!session.busy;
  const hasPendingQuestion = !!session.pendingQuestion;
  const dockAtEnd = !showJumpToBottom;
  const canRewindMessage = useStableCallback(
    (blockId: string) =>
      !!onRewindMessage &&
      !managed &&
      !session.inboxAsk &&
      !session.worktreeRemoved &&
      !sendBlockedReason &&
      canRewindConversation(session, blockId),
  );
  const rewindMessage = useStableCallback((block: Block, action: "return" | "edit") =>
    requestMessageRewind(block, action),
  );
  const sendDraft = useStableCallback((block: Block) =>
    onSubmit(session.id, block.text, block.attachments ?? [], {
      draftBlockId: block.id,
      ...(block.appRequestId ? { appRequestId: block.appRequestId } : {}),
    }),
  );
  const removeDraft = useStableCallback((block: Block) => onRemoveDraft(session.id, block.id));
  const secondOpinion = useStableCallback((target: ModelTarget, turn: Block[]) =>
    onSecondOpinion?.(session.id, target, turn),
  );
  const handoff = useStableCallback((target: ModelTarget, turn: Block[]) =>
    onHandoff?.(session.id, target, turn),
  );
  const latestTurnAccessory = useMemo(
    () => (
      <LatestTurnAccessory
        session={stableSession}
        blocked={managed || editingLastTurn || !!sendBlockedReason}
        onSubmit={composerSubmit}
        showReview={!session.inboxAsk && !session.worktreeRemoved && !draftBlock}
        sessionId={session.id}
        cwd={workCwd}
        enabled={visible}
        busy={!!session.busy}
        undoLocked={
          reviewUndoLocked ||
          orchestrationRuns.some(
            (run) =>
              (run.status === "active" || run.status === "paused") &&
              (run.leadId === session.id ||
                run.tasks.some((task) => task.sessionId === session.id)),
          )
        }
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ),
    [
      stableSession,
      managed,
      editingLastTurn,
      sendBlockedReason,
      composerSubmit,
      draftBlock,
      session.id,
      session.inboxAsk,
      session.worktreeRemoved,
      session.busy,
      workCwd,
      visible,
      reviewUndoLocked,
      orchestrationRuns,
      onOpenFile,
      onOpenDiff,
    ],
  );
  const composerChildren = useMemo(
    () => (
      <>
        {/* Above the queue and the input, below any question form. */}
        <ActivityDock
          sessionId={session.id}
          blocks={stableBlocks}
          busy={sessionBusy}
          pendingQuestion={hasPendingQuestion}
          backgroundTasks={session.backgroundTasks}
          backgroundAgents={session.backgroundAgents}
          visible={visible}
          atEnd={dockAtEnd}
          onOpenAgent={openDockAgent}
          perItemStop={perItemStop}
          onStopAgent={stopDockAgent}
          onStopAll={stopDockAll}
        />
        <InterruptedNotice
          session={stableSession}
          interruptedTurn={interruptedTurn}
          blockedReason={sendBlockedReason}
          message={remote ? "The host stopped this turn before it finished." : undefined}
          onContinue={continueInterruptedTurn}
        />
      </>
    ),
    [
      session.id,
      stableBlocks,
      sessionBusy,
      hasPendingQuestion,
      session.backgroundTasks,
      session.backgroundAgents,
      visible,
      dockAtEnd,
      openDockAgent,
      perItemStop,
      stopDockAgent,
      stopDockAll,
      stableSession,
      interruptedTurn,
      sendBlockedReason,
      remote,
      continueInterruptedTurn,
    ],
  );
  const composer = (
    <Composer
      key={session.id}
      disabled={
        rewindingMessage ||
        workspaceSwitchingSessionId === session.id ||
        windowMovingSessionIds?.has(session.id)
      }
      remoteSession={remoteSession}
      sendBlockedReason={sendBlockedReason}
      sendHeldReason={
        windowMovingSessionIds?.has(session.id)
          ? "Opening new window… Your draft will move with the conversation."
          : undefined
      }
      remoteFeatures={stableRemoteFeatures}
      allowedModelHarnesses={stableAllowedHarnesses}
      enabled={visible}
      focused={focused && composerFocused && !btw.open}
      focusToken={composerFocusToken}
      hotkeys={focused && !btw.open}
      shell={!dockComposer}
      harness={session.harness}
      model={session.model}
      modelSettings={session.modelSettings}
      runtimeMode={session.runtimeMode}
      cwd={session.cwd}
      executionCwd={workCwd}
      sessionId={session.id}
      compactSupported={canCompactHarnessContext(session.harness)}
      recents={recents}
      hideProjectPicker={!!session.inboxAsk || (hideProjectPicker ? !showDeckProjectPicker : false)}
      hideBranchPicker={!!session.inboxAsk || managed}
      hideTopBar={!!session.inboxAsk}
      context={session.context}
      contextBlocks={stableBlocks}
      contextEmpty={
        isEmpty &&
        !session.providerSessionId &&
        !session.busy &&
        !session.continuingElsewhere &&
        !session.historyPartial &&
        !session.historyLoading &&
        !session.historyLoadError &&
        !remoteSessionLoading &&
        !remoteSessionStarted &&
        !remoteHistoryHasMore &&
        !remoteHistoryLoading &&
        !remoteHistoryError
      }
      sessionUsage={session.usage}
      quoteRequest={quoteRequest}
      initialDraft={
        draftRef.current ??
        (session.inboxCard || session.noteCard || session.handoffCard
          ? undefined
          : session.composerSeed)
      }
      onDraftChange={composerDraftChange}
      inboxCard={session.inboxCard}
      noteCard={session.noteCard}
      handoffCard={session.handoffCard}
      question={session.pendingQuestion}
      onQuoteRequestConsumed={acknowledgeQuote}
      onInboxCardDismiss={composerInboxCardDismiss}
      onNoteCardDismiss={composerNoteCardDismiss}
      onHandoffCardDismiss={composerHandoffCardDismiss}
      onQuestionReply={replyQuestion}
      onQuestionInteraction={composerQuestionInteraction}
      onFocus={composerFocus}
      onCwdChange={composerCwdChange}
      onBranchChange={composerBranchChange}
      onWorktreeChange={composerWorktreeChange}
      draftWorkspace={
        !session.inboxAsk &&
        !session.worktreeRemoved &&
        !managed &&
        (remote
          ? !remoteSessionStarted
          : (isEmpty || !!session.workspaceMode) && !session.worktreeCwd)
      }
      workspaceMode={session.workspaceMode}
      worktreeBase={session.worktreeBase}
      onWorkspaceModeChange={composerWorkspaceModeChange}
      onWorktreeBaseChange={composerWorktreeBaseChange}
      worktreeRemoved={session.worktreeRemoved}
      onManageWorktrees={onManageWorktrees}
      onNewTerminal={composerNewTerminal}
      onModelChange={composerModelChange}
      onModelSettingsChange={composerModelSettingsChange}
      onRuntimeModeChange={composerRuntimeModeChange}
      canSaveDraft={
        (!remote || !!remoteFeatures?.draft) &&
        !session.busy &&
        !draftBlock &&
        !session.inboxAsk &&
        !session.inboxCard &&
        !session.noteCard &&
        !session.handoffCard
      }
      onSaveDraft={composerSaveDraft}
      onSubmit={composerSubmit}
      onBtwCommand={composerBtwCommand}
      onStop={composerStop}
      onCompactContext={composerCompactContext}
      onNewSession={onNewSession ? composerNewSession : undefined}
      onPlaceInFolder={composerPlaceInFolder}
      onResumeProviderSession={composerResumeProviderSession}
      queuedMessages={session.queuedMessages}
      queueStatus={session.queueStatus}
      runningModelTarget={session.runningModelTarget}
      onDeleteQueuedMessage={composerDeleteQueuedMessage}
      onEditQueuedMessage={composerEditQueuedMessage}
      onQueuedMessageEditingChange={composerQueuedMessageEditingChange}
      onReorderQueuedMessages={composerReorderQueuedMessages}
      onSteerQueuedMessage={composerSteerQueuedMessage}
      onResumeQueue={composerResumeQueue}
      usageLimit={session.usageLimit}
      onUsageLimitResume={onUsageLimitResume ? composerUsageLimitResume : undefined}
      onUsageLimitResumeAtReset={composerUsageLimitResumeAtReset}
      onUsageLimitDismiss={composerUsageLimitDismiss}
      providerAccountId={
        supportsProviderAccounts(session.harness)
          ? sessionProviderAccountId(session.harness, session)
          : undefined
      }
      onSelectProviderAccount={onSelectProviderAccount ? composerSelectProviderAccount : undefined}
      onOpenFile={onOpenFile}
      busy={!!session.busy}
      backgroundOnly={isBackgroundOnly(
        !!session.busy,
        session.backgroundTasks,
        session.backgroundAgents,
      )}
      backgroundTaskCount={session.backgroundTasks?.length ?? 0}
      worktreePreparing={session.worktreePreparing}
      editLastTurnSupported={editLastTurnSupported}
      lastTurnRecall={turnRecall}
      promptHistory={composerPromptHistory}
      onRecallLastTurn={rewindLastTurnToDraft}
      recalledMessage={
        rewindDraftSignal?.sessionId === session.id
          ? { id: rewindDraftSignal.id, value: rewindDraftSignal.value }
          : undefined
      }
      onRecalledMessageApplied={composerRecallMessageApplied}
      onEditingLastTurnChange={setEditingLastTurn}
    >
      {composerChildren}
    </Composer>
  );

  const hasPaneHeader = inSplit || Boolean(onPaneDragStart);
  const workingBadge = workingMachine ? (
    <Badge
      tone="neutral"
      role="status"
      data-working-machine
      title={`${t("Working on ")}${workingMachine}.`}
      className="min-w-0"
    >
      {t("Working on ")}
      {workingMachine}.
    </Badge>
  ) : null;
  const notesShortcut = useKeybindingShortcut(NOTES_PANEL_COMMAND);
  const closeShortcut = useKeybindingShortcut("Pane: Close");
  const paneActions: ExpandingButtonGroupItem[] = [
    ...(hasPaneHeader && !session.inboxAsk && findAction ? [findAction] : []),
    ...(notesEnabled && visible && focused && !showNotesPanel
      ? [
          {
            id: "notes",
            label: t("Notes"),
            ariaLabel: t("Open notes panel"),
            shortcut: notesShortcut,
            icon: <StickyNote className="size-3.5" strokeWidth={1.75} />,
            onSelect: toggleNotesPanel,
          },
        ]
      : []),
  ];
  const projectActions = visible ? (
    <ProjectQuickActions
      cwd={workCwd}
      actionsCwd={session.cwd}
      shortcutsEnabled={focused}
      additionalItems={paneActions}
      trailing={
        hasPaneHeader ? (
          <Button
            iconOnly
            label={t("Close pane")}
            variant="ghost"
            size="sm"
            type="button"
            tooltip={t("Close pane")}
            shortcut={closeShortcut}
            onClick={() => onClose(session.id)}
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </Button>
        ) : null
      }
      onRun={
        onRunProjectAction && !session.worktreeRemoved
          ? (action) => onRunProjectAction(session.id, action)
          : undefined
      }
    />
  ) : null;

  const pane = (
    <div
      ref={paneRef}
      data-session-drop={session.id}
      data-session-visible={visible}
      data-session-empty={isEmpty}
      data-project-chat-background={!!projectBackground}
      data-project-background-effect={projectBackground?.effect}
      data-project-background-scope={projectBackground?.scope}
      style={projectBackgroundStyle}
      className="chat-pane-background relative isolate flex h-full min-h-0 min-w-0 flex-1 flex-col"
      onMouseDown={() => onFocus(session.id)}
    >
      <LiveBackgroundLayer
        active={focused}
        visible={visible}
        speech={streamingReplyLength(session)}
        activity={liveTurnActivity(session)}
      />
      {!isEmpty ? <CrewBackdrop visible={visible} session={stableSession} /> : null}
      {projectBackground?.effect === "gradient-blur" ||
      (!projectBackground && globalBackgroundPath && globalBackgroundEffect === "gradient-blur") ? (
        <GradientBlurBackground />
      ) : null}
      {modelWelcome && visible && decorativeMotionEnabled ? (
        <BycodaWelcome key={modelWelcome.run} onDone={dismissModelWelcome} />
      ) : null}
      {hasPaneHeader ? (
        <div
          data-session-header
          className={`session-pane-header shrink-0 touch-none items-center gap-1.5 border-b border-(--ui-tone-neutral-border) px-2 select-none ${
            onPaneDragStart ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0 || !onPaneDragStart) return;
            if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
              return;
            }
            onPaneDragStart(event);
          }}
        >
          <div
            className={`session-header-title flex min-w-0 items-center gap-1.5 ${workingBadge ? "" : "flex-1"}`}
          >
            {onPaneDragStart ? (
              <GripVertical
                className="size-3.5 shrink-0 text-(--ui-text-secondary)"
                strokeWidth={1.75}
              />
            ) : null}
            <span
              className={`size-2 shrink-0 rounded-full ${focused ? "bg-(--ui-tone-accent-subtle)" : "bg-transparent"}`}
            />
            <span
              className="min-w-0 flex-1 truncate text-xs text-(--ui-tone-neutral-fg)"
              title={title}
            >
              {title}
            </span>
          </div>
          {workingBadge}
          <div className="session-pane-header-actions">
            {headerStatus}
            <BackgroundSessionIndicator key={session.id} session={session} />
            {projectActions}
          </div>
        </div>
      ) : null}
      {!hasPaneHeader && workingBadge ? (
        <div
          data-session-agent-header
          className="flex h-9 shrink-0 items-center gap-3 border-b border-(--ui-tone-neutral-border) px-12"
        >
          {workingBadge}
        </div>
      ) : null}
      {!hasPaneHeader ? (
        <div className="absolute end-3 top-1.5 z-10 flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {headerStatus}
          <BackgroundSessionIndicator key={session.id} session={session} />
          {projectActions}
        </div>
      ) : null}
      <div data-session-body className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <SharedQueueRecoveryNotice key={`queue:${session.id}`} sessionId={session.id} />
        <AdoptedSessionNotice
          key={session.id}
          session={session}
          onRefresh={onRefreshAdoptedSession}
        />
        <div ref={transcriptScope} className="@container relative flex min-h-0 flex-1 flex-col">
          {visible && focused && !session.inboxAsk ? (
            <LinkedWorkItemUpdateNotice
              sessionId={session.id}
              card={session.linkedWorkItemUpdateCard}
              onAcknowledge={() => {
                const updatedAt = session.linkedWorkItemUpdateCard?.updatedAt;
                if (updatedAt != null) {
                  markLinkedSessionUpdateSeen(session.id, updatedAt);
                }
              }}
              onDismiss={() => onLinkedWorkItemUpdateCardDismiss?.(session.id)}
              onOpenDiscussion={() => {
                if (session.linkedWorkItem) {
                  onOpenLinkedWorkItem?.(session.linkedWorkItem, session.id);
                }
              }}
              onAddToChat={(text) => addSelectionToChat(text, "plain")}
              onArchiveSession={
                onArchiveSession ? () => onArchiveSession(session.id, true) : undefined
              }
              onDeleteSession={onDeleteSession ? () => onDeleteSession(session.id) : undefined}
            />
          ) : null}
          {session.retryMessage && (session.busy || session.continuingElsewhere) ? (
            <div
              role="status"
              className="shrink-0 border-b border-(--ui-tone-warning-border) bg-(--ui-tone-warning-subtle) px-3 py-2 text-xs text-(--ui-tone-warning-fg)"
            >
              <strong>
                {t(
                  retryNotice.reconnecting
                    ? "Reconnecting to {provider}"
                    : "{provider} is retrying",
                  { provider: HARNESS_TITLE[session.harness] },
                )}
              </strong>
              {retryNotice.detail ? <> · {retryNotice.detail}</> : null}
            </div>
          ) : null}
          {session.rewindHistory?.length ? (
            <RewoundHistoryDisclosure
              history={session.rewindHistory}
              truncated={session.rewindHistoryTruncated}
            />
          ) : null}
          {remoteSessionLoading ? (
            <div
              role="status"
              className="flex h-full min-h-0 items-center justify-center gap-2 text-ui-secondary text-(--ui-text-secondary)"
            >
              <Loader className="size-4 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden />
              {t("Loading conversation…")}
            </div>
          ) : isEmpty ? (
            session.inboxAsk ? (
              <div className="scrollbar-none h-full min-h-0 overflow-y-auto">
                <DiscussionEmpty message="Explore this item with your agent." />
              </div>
            ) : (
              <EmptySession
                cwd={session.cwd}
                hasChatBackground={Boolean(projectBackground || globalBackgroundPath)}
                composer={
                  dockComposer ? undefined : (
                    <div ref={composerDockMotion.centeredRef} data-session-composer>
                      {composer}
                    </div>
                  )
                }
              />
            )
          ) : (
            <>
              <PooledTranscript
                pool={transcriptPool}
                sessionId={session.id}
                onMouseDown={focusPane}
              >
                <AgentTranscript
                  sessionId={session.id}
                  blocks={session.blocks}
                  performanceTraceId={sessionPerformanceTrace(session.id)}
                  historyLoading={session.historyLoading}
                  historyLoadError={session.historyLoadError}
                  remoteHistoryHasMore={remoteHistoryHasMore}
                  remoteHistoryLoading={remoteHistoryLoading}
                  remoteHistoryError={remoteHistoryError}
                  onLoadRemoteHistory={onLoadRemoteHistory}
                  onLoadRemoteBlock={onLoadRemoteBlock}
                  canRewindMessage={canRewindMessage}
                  onRewindMessage={rewindMessage}
                  busy={!!session.busy}
                  visible={visible}
                  cwd={workCwd}
                  harness={session.harness}
                  model={session.model}
                  modelSettings={session.modelSettings}
                  providerAccountId={session.providerAccountId}
                  pendingQuestion={!!session.pendingQuestion}
                  liveStatusInDock
                  backgroundTasks={session.backgroundTasks}
                  backgroundAgents={session.backgroundAgents}
                  onApproval={session.worktreeRemoved ? undefined : approve}
                  onAddToChat={addSelectionToChat}
                  onSaveNote={notesEnabled ? saveNote : undefined}
                  onSendDraft={draftBlock ? sendDraft : undefined}
                  onRemoveDraft={draftBlock ? removeDraft : undefined}
                  onSaveSelectionNote={notesEnabled ? saveSelectionNote : undefined}
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  onOpenPlan={openPlan}
                  onBuildPlan={session.worktreeRemoved ? undefined : buildPlan}
                  planBuildTargets={!remote}
                  onSecondOpinion={
                    !session.inboxAsk && !session.worktreeRemoved && onSecondOpinion
                      ? secondOpinion
                      : undefined
                  }
                  onHandoff={
                    !session.inboxAsk && !session.worktreeRemoved && onHandoff ? handoff : undefined
                  }
                  onJumpToBottomChange={setShowJumpToBottom}
                  onJumpToBottomReady={onJumpToBottomReady}
                  onRevealReady={onRevealReady}
                  onNavigateReady={onNavigateReady}
                  onScrollerChange={setTranscriptScroller}
                  editingLastTurn={editingLastTurn}
                  onEditLastTurn={undefined}
                  latestTurnAccessory={latestTurnAccessory}
                />
              </PooledTranscript>
              {!session.inboxAsk ? (
                <TranscriptFind
                  sessionId={session.id}
                  onTriggerChange={hasPaneHeader ? setFindAction : undefined}
                  blocks={findSearching ? session.blocks : stableBlocks}
                  visible={visible}
                  focused={focused}
                  onNavigate={navigateBlock}
                  onSearchingChange={setFindSearching}
                  side={
                    session.linkedWorkItemUpdateCard &&
                    session.linkedWorkItemUpdateCard.status !== "loading"
                      ? "left"
                      : "right"
                  }
                />
              ) : null}
              <PromptOutline
                blocks={outlineOpen ? session.blocks : stableBlocks}
                onOpenChange={setOutlineOpen}
                scope={transcriptScope}
                scroller={transcriptScroller}
                visible={visible}
                revealBlock={revealBlock}
              />
              {showJumpToBottom ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
                  <Button
                    iconOnly
                    label={t("Jump to latest")}
                    variant="ghost"
                    type="button"
                    title={t("Jump to latest")}
                    aria-label={t("Jump to latest")}
                    data-jump-to-bottom
                    onClick={() => jumpToBottomRef.current?.()}
                  >
                    <ChevronDown className="size-4" strokeWidth={2} />
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
        {dockComposer ? (
          <div
            ref={composerDockMotion.dockedRef}
            data-session-composer
            inert={btw.open}
            className="mx-auto w-full max-w-4xl shrink-0"
          >
            {composer}
          </div>
        ) : null}
        <BtwSheet
          btw={btw}
          cwd={workCwd}
          providerAccountId={session.providerAccountId}
          visible={visible}
          origin={() =>
            composerDockMotion.dockedRef.current?.querySelector<HTMLElement>(
              "[data-composer-box]",
            ) ?? null
          }
          onSaveNote={notesEnabled ? saveNote : undefined}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
        {subagentSheet.block ? (
          <SubagentSheet
            block={subagentSheet.block}
            busy={!!session.busy}
            visible={visible}
            cwd={workCwd}
            relay={{
              ...subagentRelay,
              blockedReason: subagentRelayBlockedReason,
              onOpenConversation: () => {
                closeSubagentSheet();
                jumpToBottomRef.current?.();
              },
            }}
            onClose={closeSubagentSheet}
            onStop={
              perItemStop && subagentSheet.block.tool?.callId
                ? () => stopBackground(subagentSheet.block?.tool?.callId)
                : undefined
            }
            onShowInTranscript={(blockId) => {
              closeSubagentSheet();
              showAgentInTranscript(blockId);
            }}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        ) : null}
      </div>
    </div>
  );
  return (
    <>
      <div className="session-notes-layout relative flex h-full min-h-0 min-w-0 flex-1">
        {pane}
        {showNotesPanel ? <SessionNotesPanel sessionId={session.id} cwd={session.cwd} /> : null}
      </div>
      {pendingRewind ? (
        <Modal
          onClose={() => {
            if (!rewindingMessage) setPendingRewind(null);
          }}
          title={
            pendingRewind.action === "edit"
              ? t("Rewind and edit message?")
              : t("Return before this message?")
          }
          description={t(
            "This removes the selected message and following outputs from active context. File changes stay unchanged. Continuing may start a fresh provider session. Removed messages remain available in rewound history.",
          )}
          size="sm"
        >
          <div className="flex flex-col gap-4 p-4">
            {rewindIncludesGroupedTurn ? (
              <p className="text-sm text-(--ui-tone-warning-fg)">
                {t(
                  "This message belongs to a grouped Codex turn. Rewinding it also removes earlier steers in that provider turn.",
                )}
              </p>
            ) : null}
            {pendingRewind.action === "edit" ? (
              <p className="text-sm text-[var(--ui-text-secondary)]">
                {t(
                  "The message will return to the composer as an unsent draft and replace its current draft.",
                )}
              </p>
            ) : (
              <p className="text-sm text-[var(--ui-text-secondary)]">
                {t("The current composer draft will be kept.")}
              </p>
            )}
            {rewindError ? (
              <Alert tone="danger" role="alert">
                {rewindError}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={rewindingMessage}
                onClick={() => setPendingRewind(null)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                loading={rewindingMessage}
                loadingLabel={t("Rewinding…")}
                onClick={() => void confirmMessageRewind()}
              >
                {pendingRewind.action === "edit" ? t("Rewind and edit") : t("Return before")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
});

/** Length of the assistant reply currently streaming, or -1 when none is. */
function streamingReplyLength(session: Session): number {
  const last = session.blocks[session.blocks.length - 1];
  return session.busy && last?.role === "assistant" && last.streaming ? last.text.length : -1;
}

/**
 * Everything the running turn has streamed since the latest user message:
 * reply, reasoning and tool progress. Each step also counts as a short burst,
 * so the live background reacts to tool calls that stream no text. -1 when idle.
 */
function liveTurnActivity(session: Session): number {
  if (!session.busy) return -1;
  let length = 0;
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user") break;
    length += 12 + block.text.length + (block.tool?.detail?.length ?? 0);
  }
  return length;
}

const LatestTurnAccessory = memo(function LatestTurnAccessory({
  session,
  blocked,
  onSubmit,
  showReview,
  ...review
}: {
  session: Session;
  blocked: boolean;
  onSubmit: React.ComponentProps<typeof RetryFailedTurn>["onSubmit"];
  showReview: boolean;
} & React.ComponentProps<typeof SessionReview>) {
  return (
    <>
      <RetryFailedTurn session={session} blocked={blocked} onSubmit={onSubmit} />
      {showReview ? <SessionReview {...review} /> : null}
    </>
  );
});
