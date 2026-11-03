import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";
import { Alert } from "../../../shared/ui/Alert";
import { registerVoiceDraftReader } from "../../voice/model/voiceDraftContext";
import {
  DeliveryProgressNotice,
  deliveryIsPending,
  useDeliveryProgress,
} from "./DeliveryProgressNotice";
import { queueState } from "../../connections/model/queueState";
import { useQueueHoldReason } from "../model/deliveryReview";
import {
  takeOverSharedLocalQueue,
  useSharedQueueLeaseHeld,
} from "../../connections/model/useSharedLocalQueues";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { useClearComposerDraft } from "../hooks/useClearComposerDraft";
import { useMountedComposerClosure } from "../hooks/useMountedComposerClosure";
import {
  retainParentInput,
  useParentInputClosure,
  useParentInputsClosed,
  canMutateParentInputs,
  mutateParentInput,
  type ParentInputHandle,
  type ParentAdmission,
} from "../data/parentInputClosure";
import {
  useComposerTranslationSelection,
  type ComposerTranslationSelection,
} from "../hooks/useComposerTranslationSelection";
import {
  canOfferTranslation,
  repromptReference,
  type TextActionTarget,
} from "../model/translation";
import {
  translatedSelection,
  translationHistoryKey,
  type TranslationHistory,
} from "../model/translationHistory";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { ComposerCitations } from "./ComposerCitations";
import { extractChatCitations, withChatCitations, type ChatCitation } from "../model/chatCitation";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { releaseAttachments } from "../model/releaseAttachments";
import { useLocale, useT } from "../../../shared/i18n";
import type { QueueAction } from "../model/queueAction";
import { useComposerSpelling } from "../../settings/model/composerSpelling";
import { ComposerTips } from "./ComposerTips";
import { useWorkspaceCreation } from "../../workspaces/model/workspaceCreation";
import {
  bundledHostWaitsForSessions,
  useBundledHostStatus,
} from "../../connections/model/bundledHostStatus";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { WorkspaceCreationStatus } from "../../workspaces/ui/WorkspaceCreationStatus";
import { SessionWorkspaceActions } from "../../workspaces/ui/SessionWorkspaceActions";
import { WorkspaceRewindPreviewHost } from "../../workspaces/ui/WorkspaceRewindPreview";
import "./chat-controls.css";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  ArrowUp,
  AiIdea,
  Bot,
  CircleDashed,
  CornerDownRight,
  CursorMagicSelection,
  FilePlus,
  GripVertical,
  ListEnd,
  Pause,
  Pencil,
  Play,
  Plus,
  Share,
  SlidersHorizontal,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  retainAttachmentPickerSelection,
  revokeAttachment,
} from "../model/attachments";
import {
  attachmentTokens,
  attachmentsDroppedByEdit,
  deleteTokenAtCaret,
  insertAtSelection,
  removeAttachmentFromText,
  tokensForIncoming,
} from "../model/attachmentTokens";
import { composerMaxHeight, resizeComposer } from "../model/composerResize";
import { createComposerResizeFrame } from "./composerResizeFrame";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import type { ContextUsage } from "../model/contextUsage";
import type { Block } from "../model/session";
import type { SessionUsage } from "../model/sessionUsage";
import { peekProjectFiles } from "../../files/model/fileIndex";
import {
  fileMentionParts,
  mentionLabel,
  mentionTokenAt,
  replaceMentionToken,
  type MentionIndex,
  type MentionToken,
} from "../../files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { composeInboxMessage, type InboxComposerCard } from "../../inbox/model/githubTasks";
import type { HandoffComposerCard } from "../model/handoff";
import { isLocalProject, looksLikeProject, type RecentProject } from "../../projects/model/recents";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  ModelTarget,
  QueuedMessage,
  UsageLimit,
  RuntimeMode,
  WorkspaceMode,
  ComposerTurnOptions,
} from "../model/session";
import { parseShellCommand } from "../model/shellRun";
import { clearConversationBlocker } from "../model/clearConversation";
import { getSessions } from "../model/sessionsStore";
import {
  canSteerHarness,
  isHarnessTurnStopping,
  steerAppliesModelSettings,
  subscribeHarnessStopping,
} from "../../../integrations/harness/core/registry";
import {
  HARNESS_TITLE,
  harnessSupportsAttachments,
  planUnavailableReason,
  unavailableRuntimeModes,
} from "../model/session";
import { hasMissingAttachment } from "../model/queuePersistence";
import { useQueuedSteerRoute, useQueuedTargetSummary } from "../model/reactiveReads";
import { moveQueuedMessage, resolveFollowUpRoute, runningTargetOf } from "../model/messageQueue";
import { HarnessIcon } from "./HarnessIcon";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { announceDrag } from "../../../shared/lib/drag";
import type { UserQuestionPrompt, UserQuestionReply } from "../model/userQuestion";
import { historyKey, type HistoryBrowse } from "../model/composerHistory";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { captureDraft, dropPastedText, insertRestoredText } from "../../../shared/lib/draftRestore";
import {
  createBlankSkill,
  dollarTokenAt,
  rankSkills,
  hasNativeCommands,
  isNativeCommandPrompt,
  replaceSlashToken,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../../skills/model/skills";
import { AccessPicker } from "./AccessPicker";
import { ContextMeter } from "./ContextMeter";
import { AttachmentChip } from "./AttachmentChip";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";
import { BranchPicker } from "../../source-control/ui/BranchPicker";
import { WorktreePicker } from "../../source-control/ui/WorktreePicker";
import {
  isWorkspaceModeShortcut,
  WorkspaceIdentity,
  WorkspacePicker,
} from "../../workspace/ui/WorkspacePicker";
import type { Worktree } from "../../source-control/model/worktrees";
import { CwdPicker } from "../../projects/ui/CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { McpServerPicker } from "./McpServerPicker";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { InboxMiniCard } from "../../inbox/ui/InboxMiniCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import { ModelPicker } from "./ModelPicker";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";
import { QuestionForm } from "./QuestionForm";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { SkillPicker } from "../../skills/ui/SkillPicker";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../model/quoteDraft";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  keybindingPressed,
  loadNotesEnabled,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import { isNoteMentionPath, type NoteComposerCard } from "../../notes";
import { resolveTabGroupLogo } from "../../workspace/model/tabGroups";
import { UsageLimitNotice } from "./UsageLimitNotice";
import {
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { consumePlanCommand, PLAN_COMMAND } from "../model/plan";
import { consumeOperatorCommand, OPERATOR_COMMAND } from "../model/operatorCommand";
import { consumeOrchestratorCommand, ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { consumeDraftCommand, DRAFT_COMMAND } from "../model/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
  ModeCommandText,
  type ModeCommandToken,
} from "./modeCommands";
import { BTW_COMMAND, consumeBtwCommand, consumeBtwPrefix } from "../model/btw";
import { isCompactCommand } from "../model/compact";
import {
  isClearSessionCommand,
  isNewSessionCommand,
  type NewSessionOptions,
} from "../model/newSessionCommand";
import { RESUME_COMMAND, isResumeCommand } from "../model/resumeCommand";
import {
  consumeSessionFolderCommand,
  isSessionFolderCommand,
  runsSessionFolderCommandOnSpace,
  SESSION_FOLDER_COMMAND,
} from "../model/sessionFolderCommand";
import {
  loadSessionFolders,
  type SessionFolderTarget,
  type SessionFolder,
} from "../model/sessionFolders";
import { SessionFolderPicker } from "./SessionFolderPicker";
import { MCP_COMMAND, isMcpCommand } from "../model/mcpCommand";
import {
  mcpContextText,
  mcpTagParts,
  newMcpTag,
  taggedMcpServers,
  type McpTag,
} from "../model/mcpPicker";
import {
  getComposerAttachments,
  getComposerMcpTags,
  getComposerDraftMode,
  setComposerDraftMode,
  setComposerDraftSnapshot,
  setComposerMcpTags,
  takeComposerNotice,
} from "../model/draftCache";
import type { LastTurnRecall } from "../model/editLastTurn";
import {
  isDefaultQueueChord,
  QUEUE_MESSAGE_COMMAND,
  queueShortcutApplies,
} from "../model/composerQueue";
import {
  composerEscapeAction,
  isDefaultStopChord,
  isInterruptChord,
  STOP_TURN_COMMAND,
} from "../model/sessionKeys";
import { insertTemplateBody, templateTriggerAt } from "../model/promptTemplates";
import { SessionDirsPicker } from "./SessionDirsPicker";
import {
  deferredExternalDraftToApply,
  externalDraftAction,
  type DeferredExternalDraft,
} from "./composerExternalDraft";
import { useComposerMcpCatalog } from "./useComposerMcpCatalog";
import { useComposerMentionSources } from "./useComposerMentionSources";
import { useComposerSlashInventory } from "./useComposerSlashInventory";
import { applyTextareaEdit, insertAtCaret } from "./composerTextareaEdit";
import { DictationButton } from "../../voice/ui/DictationButton";
import { useEditingLastTurn } from "./useEditingLastTurn";
import {
  useAttachmentSink,
  useComposerAttachmentLifecycle,
  useComposerAttachmentReads,
  releaseOverLimit,
  skippedPastedFiles,
} from "./useComposerAttachments";
import { useComposerFileDrop } from "./useComposerFileDrop";
import { useComposerRegistrations } from "./useComposerRegistrations";

type Props = {
  enabled?: boolean;
  focused: boolean;
  /** Bump to force a refocus even when `focused` was already true (e.g. window regains OS focus). */
  focusToken?: number;
  shell?: boolean;
  compact?: boolean;
  /**
   * Reading mode: the reader is away from the end of the transcript and not
   * using the composer. The same mounted field shrinks to its content and the
   * secondary workspace row is tucked away; nothing is remounted or copied.
   */
  reading?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  disabled?: boolean;
  allowedModelHarnesses?: readonly HarnessId[];
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  cwd?: string;
  executionCwd: string;
  sessionId?: string;
  /** Nested composers keep their own draft ID; null means no known logical root. */
  parentSessionId?: string | null;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  /** Routes discovery to the host; local-only app modes remain unavailable. */
  remoteSession?: boolean;
  remoteFeatures?: {
    attachments: boolean;
    plan: boolean;
    draft: boolean;
    steer?: boolean;
  };
  /** Why Send cannot reach its destination right now; Send stays usable and tries again. */
  sendBlockedReason?: string;
  /** Send is refused while set (another computer is mid-turn on this session). */
  sendHeldReason?: string;
  context?: ContextUsage;
  contextBlocks?: readonly Block[];
  /** Confirmed empty session; missing usage alone does not establish this. */
  contextEmpty?: boolean;
  sessionUsage?: SessionUsage;
  compactSupported?: boolean;
  quoteRequest?: QuoteRequest;
  initialDraft?: string;
  draftResetToken?: number;
  inboxCard?: InboxComposerCard;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  question?: UserQuestionPrompt;
  busy?: boolean;
  /** The agent is done and only background commands keep the turn open. */
  backgroundOnly?: boolean;
  backgroundTaskCount?: number;
  worktreePreparing?: boolean;
  /** Allow typed text to be sent alongside Stop while a turn is running. */
  allowBusySubmit?: boolean;
  editLastTurnSupported?: boolean;
  lastTurnRecall?: LastTurnRecall | null;
  /** The session's own messages, newest first, for Up/Down in an empty composer. */
  promptHistory?: () => string[];
  queuedMessages?: QueuedMessage[];
  queueStatus?: MessageQueueStatus;
  /** Model and settings of the turn in progress; queued rows saved for another one cannot steer it. */
  runningModelTarget?: ModelTarget;
  usageLimit?: UsageLimit;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onWorktreeChange?: (tree: Worktree) => Promise<void>;
  draftWorkspace?: boolean;
  /** UI integration signal only. Set after the remote creator binds managed ownership. */
  managedWorkspaceCreationReady?: boolean;
  workspaceMode?: WorkspaceMode;
  worktreeBase?: string;
  onWorkspaceModeChange?: (mode: WorkspaceMode, base?: string) => void;
  onWorktreeBaseChange?: (base: string) => void;
  worktreeRemoved?: boolean;
  onManageWorktrees?: () => void;
  onNewTerminal?: () => void;
  onModelChange: (harness: HarnessId, model: string, accountId?: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onQuoteRequestConsumed?: (id: number) => void;
  onInboxCardDismiss?: () => void;
  onNoteCardDismiss?: () => void;
  onHandoffCardDismiss?: () => void;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  questionDraftScope?: string;
  onQuestionInteraction?: (requestId: number) => void;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
    parentAdmission?: ParentAdmission,
  ) => boolean | void;
  /** `draft` opens the side question with the text unsent, for a typed `/btw `. */
  onBtwCommand?: (
    text: string,
    options?: { draft?: boolean },
    parentAdmission?: ParentAdmission,
  ) => boolean | void;
  canSaveDraft?: boolean;
  onSaveDraft?: (
    text: string,
    attachments: Attachment[],
    parentAdmission?: ParentAdmission,
  ) => boolean | void;
  onStop?: () => void;
  onCompactContext?: (parentAdmission?: ParentAdmission) => boolean;
  onNewSession?: (options?: NewSessionOptions, parentAdmission?: ParentAdmission) => void;
  onPlaceInFolder?: (target: SessionFolderTarget) => void;
  /** Open the picker of conversations Claude Code stored for this project. */
  onResumeProviderSession?: (parentAdmission?: ParentAdmission) => void;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onEditQueuedMessage?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onQueuedMessageEditingChange?: (messageId?: string) => void;
  /** The queue in its new order, as ids; resolved against the live queue by the owner. */
  onReorderQueuedMessages?: (messageIds: string[], parentAdmission?: ParentAdmission) => void;
  onSteerQueuedMessage?: (messageId: string) => QueueAction;
  onResumeQueue?: () => QueueAction;
  onUsageLimitResume?: () => void;
  onUsageLimitResumeAtReset?: (enabled: boolean) => void;
  onUsageLimitDismiss?: () => void;
  /** The session's resolved claude/codex account, for the account controls. */
  providerAccountId?: string;
  onSelectProviderAccount?: (provider: ProviderAccountProvider, accountId: string) => void;
  onOpenFile?: (path: string) => void;
  onDraftChange?: (text: string) => void;
  onRecallLastTurnReady?: (recall: () => void) => void;
  onRecallLastTurn?: (value: LastTurnRecall) => void;
  onRecallMessageReady?: (recall: (value: LastTurnRecall) => void) => void;
  recalledMessage?: { id: string; value: LastTurnRecall };
  onRecalledMessageApplied?: (id: string) => void;
  /**
   * Owner-supplied edit marker. Without it the Composer holds the flag itself;
   * `onEditingLastTurnChange` then only reports changes.
   */
  editingLastTurn?: boolean;
  onEditingLastTurnChange?: (editing: boolean) => void;
  children?: ReactNode;
};

function MessageQueue({
  sessionId,
  parentSessionId,
  messages,
  status,
  onDelete,
  canAttach,
  remote = false,
  busy = false,
  runningTarget,
  steerSupported = false,
  onEdit,
  onEditingChange,
  onReorder,
  onSteer,
  onResume,
}: {
  sessionId?: string;
  parentSessionId?: string;
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  canAttach: boolean;
  /** The turn runs on another machine: it cannot be steered, and the queue is this app's. */
  remote?: boolean;
  busy?: boolean;
  /** The running turn's model and settings, for rows that must wait for their own turn. */
  runningTarget?: {
    harness: HarnessId;
    model: string;
    modelSettings: Record<string, string>;
    runningModelTarget?: ModelTarget;
  };
  steerSupported?: boolean;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onEditingChange?: (messageId?: string) => void;
  onReorder?: (messageIds: string[], parentAdmission?: ParentAdmission) => void;
  onSteer?: (messageId: string) => QueueAction;
  onResume?: () => QueueAction;
}) {
  const t = useT();
  const delivery = useDeliveryProgress(sessionId);
  const pendingDelivery = deliveryIsPending(delivery?.stage);
  // Another window sends this queue: say so, and let this one take it over.
  const heldByOtherWindow = useSharedQueueLeaseHeld(sessionId ?? "");
  // The host says why it paused the queue: "stopped" after a Stop, else the provider's error.
  const holdReason = useQueueHoldReason(sessionId ?? "");
  const holdDetail = holdReason && holdReason !== "stopped" ? holdReason : undefined;
  const actionRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string>();
  const dragAdmission = useRef<{
    admission: ParentAdmission;
    identity: object | null;
    committed: boolean;
    ended: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      const drag = dragAdmission.current;
      // Shared reorder cleanup cancels its own timers before this finalizer.
      drag?.admission.finish();
      dragAdmission.current = null;
    },
    [],
  );
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
    actionId: string;
  }>();
  const queueClosed = useParentInputsClosed(parentSessionId);
  const queueOwner = useParentInputClosure({
    kind: "queue-edit",
    sessionId: parentSessionId,
    snapshot: () => ({
      source: "message-queue",
      messages,
      editingId,
      pendingAction,
      feedback,
      actionPending: actionRef.current,
    }),
  });
  const activeFeedback =
    feedback?.error &&
    (feedback.actionId === "resume"
      ? status === "active"
      : feedback.actionId === "takeover"
        ? !heldByOtherWindow
        : !messages.some((message) => message.id === feedback.actionId))
      ? undefined
      : feedback;
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const perform = async (id: string, action: (() => QueueAction) | undefined) => {
    if (actionRef.current) return;
    const admitted = queueOwner.admit();
    if (!admitted) return;
    return admitted.run(async () => {
      actionRef.current = true;
      setPendingAction(id);
      setFeedback(undefined);
      try {
        if (!action)
          throw new Error(
            t("This queue action is unavailable. Reopen the conversation and try again."),
          );
        const result = await action();
        if (result === false)
          throw new Error(
            t(
              "The message was not accepted. It remains queued. Check the conversation and try again.",
            ),
          );
        setFeedback({
          error: false,
          actionId: id,
          text:
            typeof result === "object" && result?.message
              ? t(result.message)
              : id === "resume" && status !== "restored"
                ? t("Queue resumed. Messages will send when this turn finishes.")
                : t("Message accepted. Follow its progress in the conversation."),
        });
      } catch (error) {
        setFeedback({
          error: true,
          actionId: id,
          text: t(String(error).replace(/^Error: /, "")),
        });
      } finally {
        actionRef.current = false;
        setPendingAction(undefined);
      }
    });
  };
  const sortable = useAnimatedReorder(
    messages.map((message) => message.id),
    (ids) => {
      if (actionRef.current) return;
      const drag = dragAdmission.current;
      if (drag && !drag.admission.settled) {
        try {
          if (queueOwner.identity() !== drag.identity) return;
          drag.admission.apply(() =>
            canMutateParentInputs(parentSessionId)
              ? onReorder?.(ids)
              : onReorder?.(ids, drag.admission),
          );
          drag.committed = true;
        } catch {
          queueOwner();
        }
      } else mutateParentInput(queueOwner, () => onReorder?.(ids));
    },
    "y",
    undefined,
    {
      // The row's text is the whole row; speak a short fixed name, not the message body.
      label: () => t("Queued message"),
      onEnd: () => {
        const drag = dragAdmission.current;
        if (!drag) return;
        drag.ended = true;
        // reset() precedes the shared hook's synchronous order callback. Keep
        // the original ticket until that callback, including its settling timer.
        queueMicrotask(() => {
          if (!drag.committed && queueOwner.identity() === drag.identity) queueOwner();
          drag.admission.finish();
          if (dragAdmission.current === drag) dragAdmission.current = null;
        });
      },
    },
  );
  const card = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | undefined>(undefined);
  // Moving a focused row in the DOM drops its focus; give it back after a keyboard move.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    card.current?.querySelector<HTMLElement>(`[data-queue-handle="${refocus.current}"]`)?.focus();
    refocus.current = undefined;
  }, [messages]);
  const moveByKey = (event: KeyboardEvent, id: string, index: number) => {
    if (!queueOwner.canMutate()) return;
    if (
      actionRef.current ||
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    )
      return;
    event.preventDefault();
    const next = moveQueuedMessage(messages, id, index + (event.key === "ArrowUp" ? -1 : 1));
    if (next === messages) return;
    refocus.current = id;
    onReorder?.(next.map((message) => message.id));
    announceDrag(
      t("Moved {p0} to position {p1} of {p2}", {
        p0: t("Queued message"),
        p1: next.findIndex((message) => message.id === id) + 1,
        p2: next.length,
      }),
    );
  };
  const [editingId, setEditingId] = useState<string>();
  const onEditingChangeRef = useRef(onEditingChange);
  const editingIdRef = useRef(editingId);
  useLayoutEffect(() => {
    onEditingChangeRef.current = onEditingChange;
    editingIdRef.current = editingId;
  }, [onEditingChange, editingId]);
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.();
    };
  }, []);
  const editingMessage = messages.find((message) => message.id === editingId);
  // The row was sent or removed while its dialog was open: close, never resurrect it.
  useEffect(() => {
    if (editingId && !editingMessage) {
      setEditingId(undefined);
      onEditingChangeRef.current?.();
    }
  }, [editingId, editingMessage]);
  // Routes and target names resolve queued model targets against the live catalog.
  const targetSummary = useQueuedTargetSummary();
  const steerRoute = useQueuedSteerRoute(
    runningTarget ? { ...runningTarget, busy } : undefined,
    runningTarget ? steerAppliesModelSettings(runningTargetOf(runningTarget).harness) : false,
  );
  if (messages.length === 0 && !pendingAction && !activeFeedback) return null;
  const paused = (status === "paused" || status === "resuming") && messages.length > 0;
  const hold = queueState({
    status,
    messages,
    unknownDelivery: delivery?.stage === "unknown",
    rejected:
      (delivery?.stage === "rejected" && delivery.messageId === messages[0]?.id) || !!holdDetail,
    leaseHeld: heldByOtherWindow,
  });
  const leaseHeld = !paused && hold.kind === "held" && hold.reason === "lease";
  const restored = status === "restored" && messages.length > 0;
  const canSend = (message: QueuedMessage) =>
    !queueClosed &&
    !pendingAction &&
    !pendingDelivery &&
    !message.deliveryUnknown &&
    !(delivery?.messageId === message.id && delivery.stage === "unknown") &&
    !hasMissingAttachment(message) &&
    (!busy || (steerSupported && message.intent !== "plan" && message.intent !== "orchestrate"));

  const startEdit = (message: QueuedMessage) => {
    if (!queueOwner.canMutate()) return;
    setEditingId(message.id);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    queueOwner();
    setEditingId(undefined);
    onEditingChange?.();
  };

  return (
    <div className="px-2 text-(--ui-text-secondary)" data-message-queue data-usage-guide="queue">
      {queueClosed ? (
        <p role="status">{t("Preparing session checkpoint. Your draft is kept.")}</p>
      ) : null}
      <div
        className="relative z-0 rounded-t-xl bg-(--ui-surface-panel) px-2 py-1"
        data-message-queue-card
        ref={card}
      >
        {paused ? (
          <div className="mb-1 flex h-7 items-center gap-2 text-ui-caption">
            <Pause className="icon-sm" />
            <span className="min-w-0 flex-1 truncate" title={holdDetail}>
              {hold.kind === "held" && hold.reason === "unknown"
                ? t("Queue held: delivery is not confirmed")
                : hold.kind === "held" && hold.reason === "rejected"
                  ? t("Queue paused: the last message was not accepted")
                  : t("Queue paused because you interrupted")}
              {holdDetail && !(hold.kind === "held" && hold.reason === "unknown") ? (
                <span className="text-(--ui-text-muted)"> {holdDetail}</span>
              ) : null}
            </span>
            <Button
              variant="ghost"
              type="button"
              disabled={
                !onResume ||
                !!pendingAction ||
                pendingDelivery ||
                // An unconfirmed delivery is settled in the delivery notice, never by a blind resend.
                (hold.kind === "held" && hold.reason === "unknown") ||
                hasMissingAttachment(messages[0])
              }
              loading={pendingAction === "resume"}
              loadingLabel={t("Resuming…")}
              onClick={() => void perform("resume", onResume)}
              className="shrink-0"
            >
              <Play className="icon-sm" />
              {pendingAction === "resume" ? t("Resuming…") : t("Resume")}
            </Button>
          </div>
        ) : null}
        {leaseHeld && sessionId ? (
          <div
            className="mb-1 flex h-7 items-center gap-2 text-ui-caption"
            data-queue-held-elsewhere
          >
            <Pause className="icon-sm" />
            <span className="min-w-0 flex-1 truncate">
              {t("Queue held by another window, which sends it")}
            </span>
            <Button
              variant="ghost"
              type="button"
              disabled={queueClosed || !!pendingAction || pendingDelivery}
              loading={pendingAction === "takeover"}
              loadingLabel={t("Taking over…")}
              onClick={() => void perform("takeover", () => takeOverSharedLocalQueue(sessionId))}
              className="shrink-0"
            >
              {pendingAction === "takeover" ? t("Taking over…") : t("Take over")}
            </Button>
          </div>
        ) : null}
        {restored ? (
          <div className="mb-1 flex h-7 items-center gap-2 text-ui-caption">
            <Pause className="icon-sm" />
            <span className="min-w-0 flex-1 truncate">
              {messages.length === 1
                ? t("1 queued message restored")
                : t("{p0} queued messages restored", { p0: messages.length })}
            </span>
            <Button
              variant="ghost"
              type="button"
              disabled={
                !!pendingAction ||
                pendingDelivery ||
                messages.some((message) => message.deliveryUnknown) ||
                delivery?.stage === "unknown" ||
                hasMissingAttachment(messages[0]) ||
                (!onResume && !canSend(messages[0]))
              }
              loading={pendingAction === "resume"}
              loadingLabel={t("Resuming…")}
              onClick={() =>
                void perform(
                  "resume",
                  onResume ?? (onSteer ? () => onSteer(messages[0].id) : undefined),
                )
              }
              className="shrink-0"
            >
              <Play className="icon-sm" />
              {pendingAction === "resume" ? t("Sending…") : t("Send next")}
            </Button>
          </div>
        ) : null}
        <div
          className="max-h-[min(30dvh,15rem)] min-h-0 overflow-y-auto overscroll-contain"
          data-message-queue-rows
        >
          {messages.map((message, index) => {
            const attachmentGone = hasMissingAttachment(message);
            const route = attachmentGone ? "join" : steerRoute(message);
            const target = message.modelTarget;
            const summary = target ? targetSummary(target) : undefined;
            const targetLabel =
              target && summary
                ? [
                    HARNESS_TITLE[target.harness],
                    summary.model,
                    summary.effort && t(summary.effort),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : undefined;
            const routeNote =
              route === "switch"
                ? t("Steer switches provider")
                : route === "restart"
                  ? t("Steer restarts with this model")
                  : undefined;
            const label =
              message.text.trim() ||
              `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
            return (
              <div
                key={message.id}
                ref={(node) => sortable.setItemRef(message.id, node)}
                className="reorder-item grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ui-caption data-[dragging]:rounded-md data-[dragging]:bg-(--ui-surface) data-[dragging]:shadow-lg"
              >
                {messages.length > 1 ? (
                  <Button
                    iconOnly
                    label={t("Reorder queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    variant="ghost"
                    type="button"
                    data-queue-handle={message.id}
                    tooltip={t("Drag to reorder")}
                    shortcut="Alt+↑ / Alt+↓"
                    aria-label={t("Reorder queued message")}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (dragAdmission.current && !dragAdmission.current.ended) return;
                      const admitted = queueOwner.admit();
                      if (!admitted) return;
                      // This may synchronously finish the previous settling
                      // drag. Its callback must still see its original ticket.
                      if (sortable.onItemPointerDown(message.id, event) !== true) {
                        admitted.finish();
                        return;
                      }
                      dragAdmission.current = {
                        admission: admitted,
                        identity: queueOwner.identity(),
                        committed: false,
                        ended: false,
                      };
                    }}
                    onKeyDown={(event) => moveByKey(event, message.id, index)}
                    className="shrink-0"
                  >
                    <GripVertical className="icon-sm" />
                  </Button>
                ) : (
                  <ListEnd className="icon-sm shrink-0" />
                )}
                <div className="min-w-0 py-1">
                  <OverflowTooltip label={label}>
                    <div className="truncate text-(--ui-text-secondary)">{label}</div>
                  </OverflowTooltip>
                  {attachmentGone ? (
                    <span
                      className="block [overflow-wrap:anywhere] text-(--ui-tone-warning-fg)"
                      title={t(
                        "An attached file is gone. Edit this message to drop it, or remove the message.",
                      )}
                    >
                      {t("Attachment missing")}
                    </span>
                  ) : null}
                  {target && targetLabel ? (
                    <span
                      className="flex min-w-0 items-center gap-1 text-ui-micro text-(--ui-text-secondary)"
                      data-queue-target
                    >
                      <HarnessIcon harness={target.harness} className="size-3 shrink-0" />
                      <span className="truncate" title={t("Queued for {p0}", { p0: targetLabel })}>
                        {targetLabel}
                      </span>
                      {routeNote ? <span className="shrink-0">· {routeNote}</span> : null}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {remote ? null : (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={!canSend(message)}
                      tooltip={
                        busy && (message.intent === "plan" || message.intent === "orchestrate")
                          ? t("New messages wait until this turn finishes. Stop pauses the queue.")
                          : route === "switch"
                            ? t(
                                "Steer stops the running turn, including its background work, and continues this conversation on the saved provider, as switching provider in the composer does.",
                              )
                            : route === "restart"
                              ? t(
                                  "Steer stops the running turn, including its background work, and starts this message as a new turn with its saved model.",
                                )
                              : undefined
                      }
                      loading={
                        pendingAction === message.id ||
                        (pendingDelivery && delivery?.messageId === message.id)
                      }
                      loadingLabel={t("Sending…")}
                      onClick={() =>
                        void perform(message.id, onSteer ? () => onSteer(message.id) : undefined)
                      }
                      className="shrink-0"
                    >
                      <CornerDownRight className="icon-sm" />
                      {pendingAction === message.id ||
                      (pendingDelivery && delivery?.messageId === message.id)
                        ? t("Sending…")
                        : t("Steer")}
                    </Button>
                  )}
                  <Button
                    iconOnly
                    label={t("Edit queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    variant="ghost"
                    type="button"
                    tooltip={t("Edit queued message")}
                    aria-label={t("Edit queued message")}
                    onClick={() => startEdit(message)}
                    className="shrink-0"
                  >
                    <Pencil className="icon-sm" />
                  </Button>
                  <ConfirmMorph
                    label={t("Remove")}
                    icon={<Trash2 className="icon-sm" />}
                    prompt={t("Remove queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    onConfirm={() => {
                      mutateParentInput(queueOwner, () => onDelete?.(message.id));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {!delivery &&
        (pendingAction ||
          activeFeedback ||
          (busy && status === "active" && messages.length > 0)) ? (
          <div
            role={activeFeedback?.error ? "alert" : "status"}
            aria-live="polite"
            className="py-1 text-ui-caption [overflow-wrap:anywhere]"
            data-queue-feedback
          >
            {pendingAction
              ? t("Waiting for confirmation…")
              : (activeFeedback?.text ?? t("Queue is waiting for the current turn to finish."))}
          </div>
        ) : null}
        {remote ? (
          <div className="pt-1 text-ui-micro text-(--ui-text-secondary)">
            {t("Sent one at a time when the host finishes this turn, while {p0} is open.", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
          </div>
        ) : null}
      </div>
      {editingMessage ? (
        <QueuedMessageEditDialog
          key={editingMessage.id}
          parentSessionId={parentSessionId}
          message={editingMessage}
          canAttach={canAttach}
          onSave={(text, attachments) => {
            if (!queueOwner.canMutate()) return;
            onEdit?.(editingMessage.id, text, attachments);
            setEditingId(undefined);
          }}
          onRemove={() => mutateParentInput(queueOwner, () => onDelete?.(editingMessage.id))}
          onCancel={cancelEdit}
        />
      ) : null}
    </div>
  );
}

export const Composer = memo(function Composer({
  enabled = true,
  focused,
  focusToken,
  hotkeys = false,
  shell = false,
  compact = false,
  reading = false,
  placeholder,
  inputAriaLabel,
  disabled = false,
  harness,
  model,
  allowedModelHarnesses,
  modelSettings = {},
  runtimeMode,
  cwd = "~",
  executionCwd,
  sessionId,
  parentSessionId,
  branch,
  recents = [],
  hideProjectPicker = false,
  hideBranchPicker = false,
  hideTopBar = false,
  remoteSession = false,
  sendBlockedReason,
  sendHeldReason,
  remoteFeatures,
  context,
  contextEmpty = false,
  contextBlocks,
  sessionUsage,
  compactSupported = false,
  quoteRequest,
  initialDraft,
  draftResetToken,
  inboxCard,
  noteCard,
  handoffCard,
  question,
  busy = false,
  backgroundOnly = false,
  backgroundTaskCount = 0,
  worktreePreparing = false,
  allowBusySubmit = true,
  editLastTurnSupported = false,
  lastTurnRecall = null,
  promptHistory,
  queuedMessages = [],
  queueStatus,
  runningModelTarget,
  usageLimit,
  onFocus,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  draftWorkspace = false,
  managedWorkspaceCreationReady = false,
  workspaceMode,
  worktreeBase,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  worktreeRemoved = false,
  onManageWorktrees,
  onNewTerminal,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onQuoteRequestConsumed,
  onInboxCardDismiss,
  onBtwCommand,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onQuestionReply,
  questionDraftScope,
  onQuestionInteraction,
  onSubmit,
  canSaveDraft = false,
  onSaveDraft,
  onStop,
  onCompactContext,
  onNewSession,
  onPlaceInFolder,
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
  providerAccountId,
  onSelectProviderAccount,
  onOpenFile,
  onDraftChange,
  onRecallLastTurnReady,
  onRecallLastTurn,
  onRecallMessageReady,
  recalledMessage,
  onRecalledMessageApplied,
  editingLastTurn,
  onEditingLastTurnChange,
  children,
}: Props) {
  "use memo";
  const t = useT();
  const logicalParentSessionId =
    parentSessionId === null ? undefined : (parentSessionId ?? sessionId);
  const parentClosed = useParentInputsClosed(logicalParentSessionId);
  const parentInputRef = useRef<ParentInputHandle | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [citations, setCitationsState] = useState(
    () => extractChatCitations(initialDraft ?? "").citations,
  );
  const citationsRef = useRef<ChatCitation[]>(citations);
  const draftTextRef = useRef(extractChatCitations(initialDraft ?? "").text);
  const mountedClosureRef = useRef<ReturnType<typeof useMountedComposerClosure> | null>(null);
  const attachmentApplyDepth = useRef(0);
  const canMutateDraft = useCallback(
    () =>
      (parentInputRef.current?.canMutate() ?? canMutateParentInputs(logicalParentSessionId)) &&
      (attachmentApplyDepth.current > 0 || (mountedClosureRef.current?.canMutate() ?? true)),
    [logicalParentSessionId],
  );
  const translationContext = useMemo(
    () => ({
      cwd: executionCwd,
      harness,
      model,
      modelSettings,
      providerAccountId,
    }),
    [executionCwd, harness, model, modelSettings, providerAccountId],
  );
  const translationSelection = useComposerTranslationSelection(
    ref,
    !disabled && canOfferTranslation(translationContext),
  );
  const [translationRequest, setTranslationRequest] = useState<{
    selection: ComposerTranslationSelection;
    target: TextActionTarget;
  } | null>(null);
  // A translation belongs to one draft: another session or an accepted external
  // reset drops the open request and invalidates the remembered history. The
  // epoch tags the history instead of clearing a ref during render.
  const [translationScope, setTranslationScope] = useState({
    sessionId,
    draftResetToken,
    epoch: 0,
  });
  if (
    translationScope.sessionId !== sessionId ||
    translationScope.draftResetToken !== draftResetToken
  ) {
    setTranslationScope({ sessionId, draftResetToken, epoch: translationScope.epoch + 1 });
    setTranslationRequest(null);
  }
  const translationHistoryRef = useRef<{
    epoch: number;
    history: TranslationHistory;
  } | null>(null);
  const currentTranslationHistory = () =>
    translationHistoryRef.current?.epoch === translationScope.epoch
      ? translationHistoryRef.current.history
      : null;
  const [inputResize] = useState(createComposerResizeFrame);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const accountProvider = supportsProviderAccounts(harness) ? harness : undefined;
  useEffect(() => () => inputResize.cancel(), [inputResize]);
  const boxRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const modeRef = useRef<HTMLButtonElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // A remount (or a restart) starts from the attachments the draft was saved with.
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    sessionId ? getComposerAttachments(sessionId) : [],
  );
  const attachmentsRef = useRef(attachments);
  const borrowedAttachmentIdsRef = useRef(new Set<string>());
  const consumedQuoteId = useRef<number | null>(null);
  const draftRevisionRef = useRef(0);
  const userEditBeforeRef = useRef<string | null>(null);
  const draftResetTokenRef = useRef(draftResetToken);
  /** Bumped when the draft is cleared, so a late paste cannot land on the next one. */
  const pasteGenerationRef = useRef(0);
  const pasteFailuresRef = useRef(0);
  const sendIntentRef = useRef(0);
  /** Pasted and dropped files still reading when Send is pressed. */
  const pasteFlightRef = useRef<Promise<void> | null>(null);
  const submitLockRef = useRef<symbol | null>(null);
  const submitInputRef = useRef<{ text: string; queue: boolean } | null>(null);
  const submitContinuationRef = useRef<
    ((value: string, queue: boolean, original: ParentAdmission) => void) | null
  >(null);
  const [submission, setSubmission] = useState<{
    sessionId: string | undefined;
    action: "send" | "queue";
  } | null>(null);
  const previousBusyRef = useRef(busy);
  useEffect(() => {
    if (previousBusyRef.current && !busy) {
      sendIntentRef.current += 1;
      submitLockRef.current = null;
      setSubmission(null);
    }
    previousBusyRef.current = busy;
  }, [busy]);
  const stopping = useSyncExternalStore(
    subscribeHarnessStopping,
    () => (sessionId ? isHarnessTurnStopping(sessionId) : false),
    () => false,
  );
  const stopPendingSend = () => {
    parentInputRef.current?.();
    // Retire submission intent without discarding a clipboard read or its result.
    sendIntentRef.current += 1;
    submitLockRef.current = null;
    setSubmission(null);
    onStop?.();
  };
  const positionedInitialDraft = useRef(false);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  /** Set while the text is an unedited entry recalled with Up/Down. */
  const historyRef = useRef<HistoryBrowse | null>(null);
  const escapeArmedRef = useRef<number | null>(null);
  const replaceCitations = useCallback((next: ChatCitation[]) => {
    if (JSON.stringify(citationsRef.current) === JSON.stringify(next)) return;
    citationsRef.current = next;
    setCitationsState(next);
    mountedClosureRef.current?.changed();
  }, []);
  const [draft, setDraftState] = useState(() => extractChatCitations(initialDraft ?? "").text);
  const setDraft = useCallback((update: SetStateAction<string>) => {
    const next = typeof update === "function" ? update(draftTextRef.current) : update;
    if (next !== draftTextRef.current) mountedClosureRef.current?.changed();
    draftTextRef.current = next;
    setDraftState(next);
  }, []);
  const publishedDraft = useRef<string | undefined>(undefined);
  const publishDraft = useCallback(
    (text: string, includeCitations = true) => {
      draftTextRef.current = text;
      if (mountedClosureRef.current?.retired) return;
      const persisted = includeCitations ? withChatCitations(text, citationsRef.current) : text;
      if (publishedDraft.current === persisted) return;
      const publish = () => onDraftChange?.(persisted);
      if (mountedClosureRef.current && !mountedClosureRef.current.publishCache(publish)) return;
      if (!mountedClosureRef.current) publish();
      publishedDraft.current = persisted;
    },
    [onDraftChange],
  );
  const clearVisibleComposer = useClearComposerDraft(ref, setDraft, publishDraft, canMutateDraft);
  const clearComposer = useCallback(() => {
    if (!canMutateDraft()) return;
    replaceCitations([]);
    clearVisibleComposer();
  }, [canMutateDraft, clearVisibleComposer, replaceCitations]);
  // Updating defaultValue rewrites WebKit's text node and commits an active IME.
  // Apply later external drafts through the existing synchronization effect.
  const [mountDraft] = useState(() =>
    initialDraft === undefined ? undefined : extractChatCitations(initialDraft).text,
  );
  const { branches: draftBranches } = useProjectBranchesState(
    executionCwd,
    draftWorkspace && enabled && !busy,
  );
  // "HEAD" (for example from an automation) names the checked-out branch; it is
  // resolved here on every read instead of being written back to the owner.
  const effectiveWorktreeBase =
    draftWorkspace && workspaceMode === "worktree" && worktreeBase === "HEAD"
      ? draftBranches?.current || worktreeBase
      : worktreeBase;
  const workspaceCreation = useWorkspaceCreation(
    cwd,
    draftWorkspace && enabled && looksLikeProject(cwd),
    workspaceMode,
    effectiveWorktreeBase,
  );
  // Only an explicit worktree choice blocks; a policy default falls back to current.
  const remoteWorkspaceCreationBlocked =
    draftWorkspace &&
    workspaceMode === "worktree" &&
    workspaceCreation.mode === "worktree" &&
    !!parseRemotePath(cwd) &&
    !managedWorkspaceCreationReady;
  const workspaceHostUpdateRequired =
    workspaceCreation.updateRequired || remoteWorkspaceCreationBlocked;
  const bundledHostStatus = useBundledHostStatus(
    draftWorkspace && workspaceHostUpdateRequired && !parseRemotePath(cwd),
  );
  const workspaceCreationError =
    workspaceHostUpdateRequired && bundledHostWaitsForSessions(bundledHostStatus)
      ? t(
          "The Host update on this computer is waiting for active sessions to finish and will install automatically.",
        )
      : (workspaceCreation.error ??
        (remoteWorkspaceCreationBlocked
          ? t("Update bycoda to create managed sessions on this remote Host.")
          : undefined));
  // Policy reads are short-bounded; only an explicit worktree error stops Send.
  const workspaceSendBlocked =
    draftWorkspace &&
    (workspaceCreation.pending || (!!workspaceCreationError && workspaceMode === "worktree"));
  const resolvedWorktreeBase =
    workspaceCreation.base || branch || draftBranches?.current || undefined;
  const [hasText, setHasText] = useState(
    () => extractChatCitations(initialDraft ?? "").text.trim().length > 0,
  );
  // Says so when a restored draft lost an attachment whose file is gone.
  const [pasteError, setPasteError] = useState<string | null>(
    () => (sessionId ? takeComposerNotice(sessionId) : undefined) ?? null,
  );
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [planSelected, setPlanSelected] = useState(false);
  const [operatorSelected, setOperatorSelected] = useState(false);
  const [orchestrationSelected, setOrchestrationSelected] = useState(false);
  const [draftSelected, setDraftSelectedState] = useState(() =>
    sessionId ? getComposerDraftMode(sessionId) === "save" : false,
  );
  const draftModeRef = useRef(draftSelected);
  const setDraftSelected = useCallback(
    (update: SetStateAction<boolean>) => {
      if (!canMutateDraft()) return;
      const next = typeof update === "function" ? update(draftModeRef.current) : update;
      if (next === draftModeRef.current) return;
      draftModeRef.current = next;
      setDraftSelectedState(next);
      mountedClosureRef.current?.changed();
    },
    [canMutateDraft],
  );
  useEffect(() => {
    if (sessionId)
      mountedClosureRef.current?.publishCache(() =>
        setComposerDraftMode(sessionId, draftSelected ? "save" : undefined),
      );
  }, [sessionId, draftSelected]);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillSelection, setSkillSelection] = useState({
    query: "",
    cwd,
    index: 0,
  });
  if (skillSelection.query !== (slash?.query ?? "") || skillSelection.cwd !== cwd) {
    setSkillSelection({ query: slash?.query ?? "", cwd, index: 0 });
  }
  const setSkillActive = (next: number | ((index: number) => number)) => {
    setSkillSelection((previous) => {
      const index =
        previous.query === (slash?.query ?? "") && previous.cwd === cwd ? previous.index : 0;
      return {
        query: slash?.query ?? "",
        cwd,
        index: typeof next === "function" ? next(index) : next,
      };
    });
  };
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [sessionFolderOpen, setSessionFolderOpen] = useState(false);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>([]);
  const [sessionFolderSelected, setSessionFolderSelected] = useState(false);
  // The folder choice belongs to one working directory.
  const [folderScopeCwd, setFolderScopeCwd] = useState(cwd);
  if (folderScopeCwd !== cwd) {
    setFolderScopeCwd(cwd);
    setSessionFolderOpen(false);
    setSessionFolderSelected(false);
  }
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  // An open MCP picker lists one project's servers for one provider and session.
  const [mcpScope, setMcpScope] = useState({ executionCwd, harness, sessionId });
  if (
    mcpScope.executionCwd !== executionCwd ||
    mcpScope.harness !== harness ||
    mcpScope.sessionId !== sessionId
  ) {
    setMcpScope({ executionCwd, harness, sessionId });
    setMcpPickerOpen(false);
  }
  const mcpCatalog = useComposerMcpCatalog({
    executionCwd,
    harness,
    active: mcpPickerOpen,
  });
  const { status: mcpStatus, loading: mcpLoading, error: mcpError } = mcpCatalog;
  const [selectedMcp, setSelectedMcpState] = useState<McpTag[]>(() =>
    sessionId ? getComposerMcpTags(sessionId) : [],
  );
  const selectedMcpRef = useRef(selectedMcp);
  const setSelectedMcp = useCallback(
    (update: SetStateAction<McpTag[]>) => {
      if (!canMutateDraft()) return;
      const next = typeof update === "function" ? update(selectedMcpRef.current) : update;
      if (next === selectedMcpRef.current) return;
      selectedMcpRef.current = next;
      setSelectedMcpState(next);
      mountedClosureRef.current?.changed();
    },
    [canMutateDraft],
  );
  const mountedClosure = useMountedComposerClosure({
    sessionId,
    input: ref,
    snapshot: () => ({
      text: withChatCitations(ref.current?.value ?? draftTextRef.current, citationsRef.current),
      attachments: attachmentsRef.current,
      mcpTags: selectedMcpRef.current,
      ...(draftModeRef.current ? { mode: "save" as const } : {}),
    }),
    reopened: () => {
      const text = ref.current?.value ?? draftTextRef.current;
      publishDraft(text);
      if (sessionId)
        mountedClosureRef.current?.publishCache(() =>
          setComposerDraftSnapshot(sessionId, {
            text: withChatCitations(text, citationsRef.current),
            attachments: attachmentsRef.current,
            mcpTags: selectedMcpRef.current,
            ...(draftModeRef.current ? { mode: "save" as const } : {}),
          }),
        );
    },
  });
  useLayoutEffect(() => {
    mountedClosureRef.current = mountedClosure;
  }, [mountedClosure]);
  const mcpInsertAt = useRef<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const remote = remoteSession;
  // Workspace APIs route remote:// paths to their owning machine.
  const localCwd = executionCwd;
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const spelling = useComposerSpelling();
  const queueShortcut = useKeybindingShortcut(QUEUE_MESSAGE_COMMAND);
  const stopShortcut = useKeybindingShortcut(STOP_TURN_COMMAND);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionSelection, setMentionSelection] = useState({
    query: "",
    cwd,
    index: 0,
  });
  if (mentionSelection.query !== (mention?.query ?? "") || mentionSelection.cwd !== cwd) {
    setMentionSelection({ query: mention?.query ?? "", cwd, index: 0 });
  }
  const setMentionActive = (next: number | ((index: number) => number)) => {
    setMentionSelection((previous) => {
      const index =
        previous.query === (mention?.query ?? "") && previous.cwd === cwd ? previous.index : 0;
      return {
        query: mention?.query ?? "",
        cwd,
        index: typeof next === "function" ? next(index) : next,
      };
    });
  };
  const [localResendEdited, setLocalResendEdited] = useEditingLastTurn(
    sessionId,
    editLastTurnSupported,
  );
  const resendEdited = editingLastTurn ?? localResendEdited;
  const setResendEdited = useCallback(
    (editing: boolean) => {
      if (editingLastTurn === undefined) setLocalResendEdited(editing);
      onEditingLastTurnChange?.(editing);
    },
    [editingLastTurn, onEditingLastTurnChange, setLocalResendEdited],
  );
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  useLayoutEffect(() => {
    slashRef.current = slash;
    mentionRef.current = mention;
    attachmentsRef.current = attachments;
  }, [slash, mention, attachments]);

  const mentionOpen =
    mention !== null && (looksLikeProject(executionCwd) || (!remote && notesEnabled));
  const tokens = useMemo(() => attachmentTokens(attachments), [attachments]);
  const navigationEmpty =
    draft.length === 0 &&
    citations.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const skillPickerOpen = creatingSkill || slash !== null;
  const pickerOpen = skillPickerOpen || sessionFolderOpen || mcpPickerOpen;
  const { skillCatalog, promptTemplates, dollarSkills, rankedSkills, skillNames } =
    useComposerSlashInventory({
      harness,
      executionCwd: localCwd,
      sessionId,
      pickerOpen,
      remote,
      remotePlan: !!remoteFeatures?.plan,
      hideTopBar,
      canStartNewSession: !!onNewSession,
      canSaveDraft: canSaveDraft && !!onSaveDraft,
      canResumeProviderSession: !!onResumeProviderSession,
      slashTrigger: slash?.trigger,
      slashQuery: slash?.query ?? "",
    });
  const sessionDirsHarness =
    harness === "claude" || harness === "codex" || harness === "antigravity";
  const showSessionDirs =
    !remote && !compact && sessionDirsHarness && isLocalProject(cwd ?? executionCwd);
  const attachmentsSupported =
    (!remote || !!remoteFeatures?.attachments) && harnessSupportsAttachments(harness);
  const leadingMode = leadingModeCommand(draft, skillNames, { shell: true });
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  // No token can be styled without one of these introducers. Plain drafts use
  // the native text once, avoiding a second full wrapping layout in the overlay.
  const plainDraft =
    !leadingMode && !/[/@$]/.test(draft) && !(attachments.length && draft.includes("["));
  useLayoutEffect(() => {
    // The indent can rewrap the first line after the input already resized.
    if (ref.current) resizeComposer(ref.current);
  }, [modeIndent]);
  useLayoutEffect(() => {
    // Reading mode swaps the field's minimum rows and height ceiling in place;
    // measure the same textarea again, keeping its value, caret and history.
    const el = ref.current;
    if (el) resizeComposer(el);
    if (!reading) return;
    // The compact ceiling follows the window height.
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (ref.current?.isConnected) resizeComposer(ref.current);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [reading]);
  const { mentionIndex, rankedFiles } = useComposerMentionSources({
    executionCwd,
    remote,
    notesEnabled,
    mentionOpen,
    mentionQuery: mention?.query ?? "",
  });
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  useLayoutEffect(() => {
    mentionIndexRef.current = mentionIndex;
  }, [mentionIndex]);
  const skillActive =
    skillSelection.query === (slash?.query ?? "") && skillSelection.cwd === cwd
      ? Math.max(0, Math.min(skillSelection.index, rankedSkills.length - 1))
      : 0;
  const mentionActive =
    mentionSelection.query === (mention?.query ?? "") && mentionSelection.cwd === cwd
      ? Math.max(0, Math.min(mentionSelection.index, rankedFiles.length - 1))
      : 0;

  /** Only the textarea's own text is state; files and cards are read at render. */
  const syncHasText = useCallback((text: string) => setHasText(text.trim().length > 0), []);
  const hasValue =
    hasText ||
    citations.length > 0 ||
    attachments.length > 0 ||
    !!inboxCard ||
    !!noteCard ||
    !!handoffCard;

  // A leading mode command in the text shows the same pill as picking the mode.
  const operatorActive = operatorSelected || leadingMode?.name === OPERATOR_COMMAND.name;
  const orchestrationActive =
    orchestrationSelected || leadingMode?.name === ORCHESTRATOR_COMMAND.name;
  const draftActive = draftSelected || leadingMode?.name === DRAFT_COMMAND.name;
  // Remote draft saving can also create a Host session, so it needs the same bridge.
  const workspaceActionBlocked =
    remoteWorkspaceCreationBlocked || (!draftActive && workspaceSendBlocked);
  const planActive = planSelected || leadingMode?.name === PLAN_COMMAND.name;

  /** Turning a mode off also drops its leading command from the text. */
  const clearLeadingMode = (name: string) => {
    if (!canMutateDraft()) return;
    const el = ref.current;
    if (!el || leadingModeCommand(el.value, skillNames)?.name !== name) return;
    const next = el.value.replace(/^\/[a-z]+\s?/, "");
    el.value = next;
    resizeComposer(el);
    el.setSelectionRange(0, 0);
    setDraft(next);
    publishDraft(next);
    syncHasText(next);
  };

  const resetMcpCatalog = mcpCatalog.reset;
  const openMcpPicker = useCallback(() => {
    resetMcpCatalog();
    setMcpPickerOpen(true);
  }, [resetMcpCatalog]);

  useEffect(() => {
    if (sessionId) mountedClosure.publishCache(() => setComposerMcpTags(sessionId, selectedMcp));
  }, [sessionId, selectedMcp]);

  useComposerAttachmentLifecycle({
    sessionId,
    harness,
    attachments,
    attachmentsRef,
    borrowedAttachmentIdsRef,
    pasteGenerationRef,
    mountedClosure,
    setPasteError,
  });

  /** Text goes at the caret when the input has focus, otherwise at the end. */
  const insertIntoDraft = useCallback(
    (insertion: string) => {
      if (!canMutateDraft()) return;
      const el = ref.current;
      if (!insertion) return;
      if (!el) {
        if (attachmentApplyDepth.current > 0) {
          const edit = insertAtSelection(draftTextRef.current, null, insertion);
          setDraft(edit.text);
          publishDraft(edit.text);
        }
        return;
      }
      const focused = document.activeElement === el;
      const edit = insertAtSelection(
        el.value,
        focused ? { start: el.selectionStart, end: el.selectionEnd } : null,
        insertion,
      );
      applyTextareaEdit(el, edit.text, edit.caret);
    },
    [canMutateDraft, publishDraft],
  );

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!canMutateDraft()) return;
      if (!harnessSupportsAttachments(harness) || incoming.length === 0) return;
      const previous = attachmentsRef.current;
      const next = mergeAttachments(previous, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      // Files the full draft left out are said, not silently dropped.
      setPasteError(releaseOverLimit(previous, next, incoming));
      draftRevisionRef.current += 1;
      // Skipped duplicates are not in `next`, so they get no token either.
      insertIntoDraft(tokensForIncoming(previous, next.slice(previous.length)));
      syncHasText(ref.current?.value ?? "");
      ref.current?.focus();
    },
    [harness, insertIntoDraft, syncHasText],
  );

  useComposerRegistrations({
    cwd,
    sessionId,
    disabled,
    attachmentsSupported,
    inputRef: ref,
    attachmentsRef,
    draftRevisionRef,
    canMutateDraft,
    addAttachments,
    setAttachments,
    setPasteError,
    syncHasText,
  });

  const insertAttachmentToken = useCallback(
    (id: string) => {
      if (!canMutateDraft()) return;
      const index = attachmentsRef.current.findIndex((file) => file.id === id);
      if (index < 0) return;
      draftRevisionRef.current += 1;
      insertIntoDraft(attachmentTokens(attachmentsRef.current)[index]);
      ref.current?.focus();
    },
    [insertIntoDraft],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      if (!canMutateDraft()) return;
      const previous = attachmentsRef.current;
      const removed = previous.find((file) => file.id === id);
      if (removed && !borrowedAttachmentIdsRef.current.delete(removed.id)) {
        revokeAttachment(removed);
      }
      const next = previous.filter((file) => file.id !== id);
      attachmentsRef.current = next;
      draftRevisionRef.current += 1;
      setAttachments(next);
      setPasteError(null);
      // The text loses the removed token and the rest renumber with the chips.
      const el = ref.current;
      if (el) {
        const text = removeAttachmentFromText(
          el.value,
          previous,
          previous.findIndex((file) => file.id === id),
        );
        if (text !== el.value) {
          // Renumbering ahead of the caret shifts it by the same amount.
          const caret = removeAttachmentFromText(
            el.value.slice(0, el.selectionStart ?? el.value.length),
            previous,
            previous.findIndex((file) => file.id === id),
          ).length;
          applyTextareaEdit(el, text, caret);
        }
      }
      syncHasText(ref.current?.value ?? "");
      ref.current?.focus();
    },
    [syncHasText],
  );
  // IPC listener registration is asynchronous; changing providers must not
  // detach it or leave it reading obsolete capabilities and callbacks.
  const attachmentSink = useAttachmentSink({ attachmentsSupported, remote, addAttachments });
  const { rememberAttachmentRead, readDroppedAttachments } = useComposerAttachmentReads({
    parentInputRef,
    mountedClosure,
    sinkRef: attachmentSink,
    attachmentApplyDepth,
    pasteGenerationRef,
    pasteFailuresRef,
    pasteFlightRef,
    setPasteError,
  });

  // The text as it was just before a user edit. Only a native `beforeinput`
  // sets it, so programmatic text changes never count as the user deleting a
  // token. Backspace/Delete against a token takes the whole token.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (event: InputEvent) => {
      userEditBeforeRef.current = el.value;
      const back = event.inputType === "deleteContentBackward";
      if (
        event.isComposing ||
        (!back && event.inputType !== "deleteContentForward") ||
        el.selectionStart !== el.selectionEnd
      ) {
        return;
      }
      const edit = deleteTokenAtCaret(
        el.value,
        el.selectionStart,
        back ? "back" : "forward",
        attachmentsRef.current,
      );
      if (!edit) return;
      event.preventDefault();
      applyTextareaEdit(el, edit.text, edit.caret);
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  // An accepted external draft takes the same projection path as a native edit:
  // the textarea stays the authority and writes first, then the draft text,
  // Send/placeholder state and token menus follow it. Echoes of the current
  // text only refresh the ref, and nothing is written during an IME composition.
  const applyExternalDraft = (el: HTMLTextAreaElement, serialized: string) => {
    const { text, citations: incomingCitations } = extractChatCitations(serialized);
    replaceCitations(incomingCitations);
    const replaced = el.value !== text;
    if (replaced) {
      mountedClosure.changed();
      draftRevisionRef.current += 1;
      el.value = text;
    }
    draftTextRef.current = text;
    if (!positionedInitialDraft.current) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      positionedInitialDraft.current = true;
    }
    resizeComposer(el);
    if (!replaced) return;
    setDraft(text);
    syncHasText(text);
    setSlash(null);
    setMention(null);
  };
  const applyExternalDraftRef = useRef(applyExternalDraft);
  useLayoutEffect(() => {
    applyExternalDraftRef.current = applyExternalDraft;
  });
  const composingRef = useRef(false);
  useEffect(
    () =>
      sessionId
        ? registerVoiceDraftReader(sessionId, () => ({
            text: ref.current?.value ?? draftTextRef.current,
            attachments: attachmentsRef.current,
            composing: composingRef.current,
            attachmentsPending: !!pasteFlightRef.current,
          }))
        : undefined,
    [sessionId],
  );
  const deferredExternalDraftRef = useRef<DeferredExternalDraft | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let settle: number | undefined;
    let valueAtStart = "";
    const start = () => {
      composingRef.current = true;
      valueAtStart = el.value;
    };
    const end = () => {
      composingRef.current = false;
      // Text the user just composed wins: a draft that arrived during that
      // composition is refused rather than written over it.
      if (el.value !== valueAtStart) deferredExternalDraftRef.current = null;
      if (!deferredExternalDraftRef.current) return;
      // Some engines dispatch the final input event after compositionend. Let
      // it update the revision first so a deferred draft never overwrites it.
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (composingRef.current) return;
        const text = deferredExternalDraftToApply({
          deferred: deferredExternalDraftRef.current,
          revision: draftRevisionRef.current,
          domValue: el.value,
        });
        deferredExternalDraftRef.current = null;
        if (text !== null) applyExternalDraftRef.current(el, text);
      }, 0);
    };
    el.addEventListener("compositionstart", start);
    el.addEventListener("compositionend", end);
    return () => {
      window.clearTimeout(settle);
      el.removeEventListener("compositionstart", start);
      el.removeEventListener("compositionend", end);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    const action = externalDraftAction({
      external: initialDraft,
      domValue: el.value,
      composing: composingRef.current,
    });
    if (action === "defer") {
      deferredExternalDraftRef.current = {
        text: initialDraft,
        revision: draftRevisionRef.current,
      };
      return;
    }
    deferredExternalDraftRef.current = null;
    applyExternalDraft(el, initialDraft);
  }, [initialDraft]);

  // Drafts changed while hidden could not be measured. Inbox panes are portaled
  // into place by a parent effect that runs after this one, so the first pass
  // can still find no layout box; retry once the move has landed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    resizeComposer(el);
    if (el.scrollHeight !== 0) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) resizeComposer(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  useEffect(() => {
    publishDraft(draft);
  }, [draft, citations, publishDraft]);
  useEffect(() => {
    if (draftResetToken == null || draftResetTokenRef.current === draftResetToken) {
      return;
    }
    draftResetTokenRef.current = draftResetToken;
    mountedClosure.changed();
    pasteGenerationRef.current += 1;
    draftRevisionRef.current += 1;
    // This reset was accepted externally. Preserve it and invalidate the closed
    // observation instead of silently dropping it through the user edit gate.
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
    replaceCitations([]);
    setDraft("");
    publishDraft("");
    draftModeRef.current = false;
    setDraftSelectedState(false);
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setMcpPickerOpen(false);
    selectedMcpRef.current = [];
    setSelectedMcpState([]);
    setPlusOpen(false);
    setModeOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasText("");
  }, [draftResetToken, clearComposer, syncHasText]);

  const syncHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The textarea can scroll itself to keep the caret visible before React
    // commits the updated highlight text. Sync again after that commit, when
    // the overlay has enough scrollable content to accept the same offset.
    syncHighlightScroll(el);
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) syncHighlightScroll(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, syncHighlightScroll]);

  const syncTokensFromTextarea = (el: HTMLTextAreaElement) => {
    if (creatingSkill) return;
    // A recalled "/plan" must not pop the menu over the next Up press.
    if (historyRef.current?.text === el.value) return;
    const cursor = el.selectionStart ?? 0;
    const token = slashTokenAt(el.value, cursor, hasNativeCommands(harness));
    // `$name` opens only while some Codex skill matches, so `$HOME` stays text.
    const dollar = token ? null : dollarTokenAt(el.value, cursor);
    setSlash(
      token ?? (dollar && rankSkills(dollarSkills, dollar.query, 1).length > 0 ? dollar : null),
    );
    setMention(token ? null : mentionTokenAt(el.value, cursor));
  };

  const openSessionFolderPicker = useCallback(() => {
    setSessionFolders(loadSessionFolders(cwd));
    setSessionFolderOpen(true);
  }, [cwd]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !quoteRequest) return;

    const result = consumeQuoteRequest(
      withChatCitations(el.value, citationsRef.current),
      consumedQuoteId.current,
      quoteRequest,
    );
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      draftRevisionRef.current += 1;
      const incoming = extractChatCitations(result.draft);
      replaceCitations(incoming.citations);
      el.value = incoming.text;
      resizeComposer(el);
      setDraft(incoming.text);
      syncHasText(incoming.text);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(incoming.text.length, incoming.text.length);
      el.focus();
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [onQuoteRequestConsumed, quoteRequest, syncHasText]);

  // `/btw ` opens the side conversation as soon as it is typed, carrying any
  // text after it over as the unsent side question.
  const enterBtwFromPrefix = useCallback(
    (el: HTMLTextAreaElement) => {
      if (!canMutateDraft()) return false;
      if (!onBtwCommand || inboxCard || noteCard || handoffCard) return false;
      if (attachmentsRef.current.length > 0 || citationsRef.current.length > 0) return false;
      const rest = consumeBtwPrefix(el.value);
      if (rest == null || onBtwCommand(rest, { draft: true }) === false) {
        return false;
      }
      el.value = "";
      resizeComposer(el);
      draftRevisionRef.current += 1;
      setDraft("");
      publishDraft("");
      syncHasText("");
      setSlash(null);
      setMention(null);
      return true;
    },
    [canMutateDraft, handoffCard, inboxCard, noteCard, onBtwCommand, publishDraft, syncHasText],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      if (!canMutateDraft()) return;
      const el = ref.current;
      const token = slashRef.current;
      if (!el || !token) {
        setSlash(null);
        setCreatingSkill(false);
        return;
      }
      if (skill.kind === "builtin" && skill.name === MCP_COMMAND.name) {
        const next = `${el.value.slice(0, token.start)}${el.value.slice(token.end).replace(/^\s/, "")}`;
        el.value = next;
        resizeComposer(el);
        mcpInsertAt.current = token.start;
        el.setSelectionRange(token.start, token.start);
        setDraft(next);
        publishDraft(next);
        syncHasText(next);
        setSlash(null);
        openMcpPicker();
        return;
      }
      const sessionFolderCommand =
        skill.kind === "builtin" && skill.name === SESSION_FOLDER_COMMAND.name && !!onPlaceInFolder;
      if (sessionFolderCommand) {
        const next = replaceSlashToken(el.value, token, SESSION_FOLDER_COMMAND.invocation);
        el.value = next;
        resizeComposer(el);
        let cursor = token.start + SESSION_FOLDER_COMMAND.invocation.length + 1;
        if (next[cursor] === " ") cursor += 1;
        el.setSelectionRange(cursor, cursor);
        setDraft(next);
        syncHasText(next);
        setSlash(null);
        setCreatingSkill(false);
        openSessionFolderPicker();
        return;
      }
      const resumeCommand =
        skill.kind === "builtin" && skill.name === RESUME_COMMAND.name && !!onResumeProviderSession;
      if (resumeCommand) {
        // Picking a conversation loads a transcript; it is not a prompt, so the
        // command leaves no text behind in the composer.
        const cleared = `${el.value.slice(0, token.start)}${el.value
          .slice(token.end)
          .replace(/^\s/, "")}`;
        el.value = cleared;
        resizeComposer(el);
        el.setSelectionRange(token.start, token.start);
        setDraft(cleared);
        publishDraft(cleared);
        syncHasText(cleared);
        setSlash(null);
        setCreatingSkill(false);
        onResumeProviderSession();
        return;
      }
      if (skill.kind === "template") {
        // Goes through the same input path as typing, so the draft, the
        // attachment tokens and the highlight all follow.
        const edit = insertTemplateBody(el.value, token.start, token.end, skill.body);
        applyTextareaEdit(el, edit.text, edit.caret);
        setSlash(null);
        setCreatingSkill(false);
        el.focus();
        return;
      }
      const next = replaceSlashToken(el.value, token, skill.invocation);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasText(next);
      setSlash(null);
      setCreatingSkill(false);
      if (skill.kind === "builtin" && skill.name === BTW_COMMAND.name) {
        enterBtwFromPrefix(el);
      }
      el.focus();
    },
    [
      canMutateDraft,
      enterBtwFromPrefix,
      publishDraft,
      onPlaceInFolder,
      openMcpPicker,
      onResumeProviderSession,
      openSessionFolderPicker,
      syncHasText,
    ],
  );

  const pickMention = useCallback(
    (file: ProjectFile) => {
      if (!canMutateDraft()) return;
      const el = ref.current;
      const token = mentionRef.current;
      if (!el || !token) {
        setMention(null);
        return;
      }
      const label =
        remote || isNoteMentionPath(file.path)
          ? file.relative
          : mentionLabel(file, mentionIndexRef.current);
      const next = replaceMentionToken(el.value, token, label);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasText(next);
      setMention(null);
      el.focus();
    },
    [canMutateDraft, syncHasText, remote],
  );

  const lastFocusToken = useRef(focusToken);
  useEffect(() => {
    const requested = lastFocusToken.current !== focusToken;
    lastFocusToken.current = focusToken;
    if (!focused || disabled) return;

    const composer = ref.current?.closest("[data-composer]");
    const activeComposer = document.activeElement?.closest("[data-composer]");
    const activeComposerHidden = activeComposer?.closest('[aria-hidden="true"], [inert]');
    // Inactive workspace tabs stay mounted, so focus can still be sitting in
    // their composer when a new session becomes active. Only preserve focus
    // for another composer that is still visible (for example, a split pane).
    if (!requested && activeComposer && activeComposer !== composer && !activeComposerHidden)
      return;

    if (
      composer?.querySelector(
        "[data-skill-picker], [data-session-folder-picker], [data-mention-picker], [data-mcp-picker], [data-composer-plus], [data-question-form]",
      )
    )
      return;
    // Model/access/branch/settings/file pickers render through a portal into
    // document.body (see Popover.tsx), so they never appear under this
    // composer's own DOM subtree — check the whole document for those.
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-model-settings], [data-file-picker], [data-branch-picker]",
      )
    )
      return;
    ref.current?.focus();
  }, [disabled, focused, question, busy, focusToken]);

  useComposerFileDrop({
    enabled,
    disabled,
    attachmentsSupported,
    boxRef,
    sinkRef: attachmentSink,
    attachmentsRef,
    readDroppedAttachments,
    setPasteError,
  });
  useEffect(() => {
    // Reads begun before files became unsupported must not land on this draft.
    if (!attachmentsSupported) pasteGenerationRef.current += 1;
  }, [attachmentsSupported]);
  const restoreDraft = useCallback(
    (serialized: string, nextAttachments: Attachment[], borrowedIds?: ReadonlySet<string>) => {
      const { text, citations: restoredCitations } = extractChatCitations(serialized);
      replaceCitations(restoredCitations);
      const restoredBorrowedIds = borrowedIds ?? borrowedAttachmentIdsRef.current;
      setDraft(text);
      publishDraft(text);
      if (ref.current) {
        ref.current.value = text;
        ref.current.style.height = "auto";
        ref.current.style.height = `${Math.min(ref.current.scrollHeight, composerMaxHeight(ref.current))}px`;
      }

      const nextIds = new Set(nextAttachments.map((file) => file.id));
      releaseAttachments(attachmentsRef.current, borrowedAttachmentIdsRef.current, nextIds);
      borrowedAttachmentIdsRef.current = new Set(
        nextAttachments.filter((file) => restoredBorrowedIds.has(file.id)).map((file) => file.id),
      );
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
      syncHasText(text);
      ref.current?.focus();
    },
    [publishDraft, syncHasText],
  );

  const exitEditMode = useCallback(() => {
    if (!canMutateDraft()) return;
    draftRevisionRef.current += 1;
    pasteGenerationRef.current += 1;
    clearComposer();
    const previous = attachmentsRef.current;
    releaseAttachments(previous, borrowedAttachmentIdsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    setResendEdited(false);
    setPlusOpen(false);
    setModeOpen(false);
    setSlash(null);
    setMention(null);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    syncHasText("");
    ref.current?.focus();
  }, [clearComposer, setResendEdited, syncHasText]);

  const recallLastTurn = useCallback(() => {
    if (!canMutateDraft()) return;
    if (!editLastTurnSupported || !lastTurnRecall) return;
    if (onRecallLastTurn) {
      onRecallLastTurn(lastTurnRecall);
      return;
    }
    if (resendEdited) {
      exitEditMode();
      return;
    }
    restoreDraft(
      lastTurnRecall.text,
      lastTurnRecall.attachments,
      new Set(lastTurnRecall.attachments.map((file) => file.id)),
    );
    setResendEdited(true);
  }, [
    editLastTurnSupported,
    onRecallLastTurn,
    exitEditMode,
    lastTurnRecall,
    resendEdited,
    restoreDraft,
    setResendEdited,
  ]);

  const applyExternalRecall = useCallback(
    (value: LastTurnRecall) => {
      restoreDraft(
        value.text,
        value.attachments,
        new Set(value.attachments.map((file) => file.id)),
      );
      // Recall is an unsent draft. Place the caret explicitly after the prompt
      // rather than retaining the previous draft's selection.
      ref.current?.setSelectionRange(value.text.length, value.text.length);
      setResendEdited(false);
    },
    [restoreDraft, setResendEdited],
  );
  const recallMessage = useCallback(
    (value: LastTurnRecall) => {
      if (!canMutateDraft()) return;
      applyExternalRecall(value);
    },
    [canMutateDraft, applyExternalRecall],
  );

  const appliedRecallIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recalledMessage || appliedRecallIdRef.current === recalledMessage.id) return;
    appliedRecallIdRef.current = recalledMessage.id;
    applyExternalRecall(recalledMessage.value);
    onRecalledMessageApplied?.(recalledMessage.id);
  }, [onRecalledMessageApplied, applyExternalRecall, recalledMessage]);

  useEffect(() => {
    if (onRecallMessageReady) onRecallMessageReady(recallMessage);
  }, [onRecallMessageReady, recallMessage]);

  useEffect(() => {
    // The edit marker resets with the session during render (useEditingLastTurn);
    // the revision and recalled-history refs can only be retired after commit.
    draftRevisionRef.current += 1;
    historyRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!editLastTurnSupported || !onRecallLastTurnReady) return;
    onRecallLastTurnReady(recallLastTurn);
  }, [editLastTurnSupported, onRecallLastTurnReady, recallLastTurn]);

  const parentChanged = useParentInputClosure(
    {
      kind: "composer-parent",
      sessionId: logicalParentSessionId,
      snapshot: () => ({
        composerSessionId: sessionId,
        text: withChatCitations(ref.current?.value ?? draftTextRef.current, citationsRef.current),
        draftText: withChatCitations(draftTextRef.current, citationsRef.current),
        initialDraft,
        draftResetToken,
        currentDraftResetToken: draftResetTokenRef.current,
        quoteRequest,
        consumedQuoteId: consumedQuoteId.current,
        recalledMessage,
        appliedRecallId: appliedRecallIdRef.current,
        planSelected,
        operatorSelected,
        orchestrationSelected,
        draftSelected,
        sessionFolderSelected,
        resendEdited,
        selectedMcp: selectedMcpRef.current,
        attachments: attachmentsRef.current,
        borrowedAttachmentIds: [...borrowedAttachmentIdsRef.current],
        draftRevision: draftRevisionRef.current,
        pasteGeneration: pasteGenerationRef.current,
        pasteFailures: pasteFailuresRef.current,
        pastePending: !!pasteFlightRef.current,
        sendIntent: sendIntentRef.current,
        submitPending: !!submitLockRef.current,
        submitInput: submitInputRef.current,
        submission,
        creatingSkill,
        createBusy,
        createError,
        sessionFolderOpen,
        mcpPickerOpen,
        mcpLoading,
        mcpError,
        mcpInsertAt: mcpInsertAt.current,
        mcpStatus: [...mcpStatus],
        inboxCard,
        noteCard,
        handoffCard,
        question,
        questionDraftScope,
        harness,
        model,
        modelSettings,
        runtimeMode,
        providerAccountId,
        cwd,
        executionCwd,
        workspaceMode,
        worktreeBase,
        disabled,
        sendHeldReason,
        sendBlockedReason,
        worktreePreparing,
        worktreeRemoved,
      }),
      missingCoverage:
        parentSessionId !== undefined && sessionId !== logicalParentSessionId
          ? ["nested-btw-input-scope", "decision-conservation", "composer-auxiliary-inputs"]
          : ["decision-conservation", "composer-auxiliary-inputs"],
    },
    ref,
  );
  useLayoutEffect(() => {
    parentInputRef.current = parentChanged;
  }, [parentChanged]);
  const submit = (value: string, queue = false) => {
    if (!canMutateDraft()) return;
    if (submitLockRef.current) return;
    if (disabled || worktreeRemoved || workspaceActionBlocked || sendHeldReason) {
      // Enter reaches here without the send button's tooltip; say why nothing was sent.
      setPasteError(
        sendHeldReason ||
          sendBlockedReason ||
          t(
            "The message was not sent. Resolve the conversation or workspace blocker and try again.",
          ),
      );
      return;
    }
    const admitted = parentChanged.admit();
    if (!admitted) return;
    const rawAction = mountedClosure.admitAction();
    if (!rawAction) {
      admitted.finish();
      setPasteError(
        t("The message is kept. Wait for checkpoint preparation to finish before sending."),
      );
      return;
    }
    const token = Symbol();
    const originalIdentity = parentChanged.identity();
    const intent = sendIntentRef.current;
    const generation = pasteGenerationRef.current;
    submitInputRef.current = { text: value, queue };
    parentChanged();
    submitLockRef.current = token;
    setSubmission({ sessionId, action: queue ? "queue" : "send" });
    void admitted.run(async () => {
      try {
        let pending = pasteFlightRef.current;
        while (pending) {
          await pending;
          // Check the original owner before reading refs that a reused view may
          // already have assigned to a different logical session.
          if (parentChanged.identity() !== originalIdentity) return;
          if (pasteGenerationRef.current !== generation || sendIntentRef.current !== intent) {
            // A failed read already explains itself; keep that message.
            setPasteError(
              (current) =>
                current ?? t("The draft changed while it was being prepared. Send it again."),
            );
            return;
          }
          pending = pasteFlightRef.current;
        }
        if (parentChanged.identity() !== originalIdentity) return;
        admitted.apply(() =>
          rawAction.apply(() => submitContinuationRef.current?.(value, queue, admitted)),
        );
      } catch (error) {
        if (parentChanged.identity() === originalIdentity)
          setPasteError(error instanceof Error ? error.message : String(error));
      } finally {
        rawAction.finish();
        if (parentChanged.identity() === originalIdentity && submitLockRef.current === token) {
          submitLockRef.current = null;
          submitInputRef.current = null;
          parentChanged();
          setSubmission(null);
        }
      }
    });
  };
  const completeSubmit = (submittedValue: string, queue = false, original?: ParentAdmission) => {
    const value = ref.current?.value ?? submittedValue;
    if (!canMutateDraft()) return;
    // Preserve public callback arguments while open. Only an actually closed
    // logical root needs the explicit private downstream continuation.
    const continuation = canMutateParentInputs(logicalParentSessionId) ? undefined : original;
    const continuationArgs: [] | [ParentAdmission] = continuation ? [continuation] : [];
    if (disabled || worktreeRemoved || workspaceActionBlocked || sendHeldReason) {
      setPasteError(
        sendHeldReason ||
          t(
            "The message was not sent. Resolve the conversation or workspace blocker and try again.",
          ),
      );
      return;
    }
    if (
      citationsRef.current.length &&
      (isClearSessionCommand(value) ||
        isCompactCommand(value) ||
        isResumeCommand(value) ||
        isMcpCommand(value) ||
        parseShellCommand(value) !== undefined ||
        isNativeCommandPrompt(value, harness))
    ) {
      setPasteError(
        t("Remove quoted replies before running this command. Your draft is preserved."),
      );
      return;
    }
    if (isClearSessionCommand(value)) {
      if (
        busy ||
        onSubmit(value.trim(), [], { intent: "default" }, ...continuationArgs) === false
      ) {
        const blocked = sessionId
          ? getSessions().find((entry) => entry.id === sessionId)
          : undefined;
        setPasteError(
          (blocked && clearConversationBlocker(blocked)) ||
            (busy
              ? t("Stop the current turn before clearing the conversation.")
              : t("The conversation cannot be cleared right now. Try again in a moment.")),
        );
        return;
      }
      pasteGenerationRef.current += 1;
      clearComposer();
      historyRef.current = null;
      borrowedAttachmentIdsRef.current.clear();
      attachmentsRef.current = [];
      setAttachments([]);
      setSelectedMcp([]);
      setPlanSelected(false);
      setOperatorSelected(false);
      setOrchestrationSelected(false);
      setSlash(null);
      setMention(null);
      setResendEdited(false);
      syncHasText("");
      return;
    }
    if (isNewSessionCommand(value) && onNewSession) {
      // Retain attachments and context cards in the old session. Clear only
      // the navigation command before switching tabs so it cannot reappear.
      if (ref.current) ref.current.value = "";
      setDraft("");
      publishDraft("");
      setSlash(null);
      syncHasText("");
      if (continuation) onNewSession(undefined, continuation);
      else onNewSession();
      return;
    }
    if (isResumeCommand(value)) {
      if (remote || !onResumeProviderSession || (harness !== "claude" && harness !== "codex")) {
        setPasteError(
          remote
            ? `Importing terminal conversations from a remote machine is not available yet. Open ${PRODUCT_IDENTITY.displayName} on that machine to import them.`
            : "Terminal conversation import is not available in this composer.",
        );
        return;
      }
      clearComposer();
      setPlusOpen(false);
      setModeOpen(false);
      setSlash(null);
      setMention(null);
      syncHasText("");
      onResumeProviderSession(...continuationArgs);
      return;
    }
    if (isMcpCommand(value)) {
      mcpInsertAt.current = 0;
      clearComposer();
      setSlash(null);
      syncHasText("");
      openMcpPicker();
      return;
    }
    const draftCommand = canSaveDraft
      ? consumeDraftCommand(value)
      : { text: value, matched: false };
    if (draftSelected && (!canSaveDraft || !onSaveDraft)) {
      setPasteError(
        "Saving drafts is unavailable here. Choose another mode explicitly to send this message.",
      );
      return;
    }
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = withChatCitations(draftCommand.text, citationsRef.current);
      if (!text.trim() && files.length === 0) return;
      const input = {
        source: "composer-save-draft-intent",
        composerSessionId: sessionId,
        rawText: value,
        text,
        attachments: files,
        selectedMcp,
      };
      const retained = retainParentInput({
        kind: "composer-parent",
        sessionId: logicalParentSessionId,
        snapshot: () => input,
      });
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
        ...continuationArgs,
      );
      if (accepted === false) {
        retained.release();
        setPasteError(t("The draft was not accepted. Your text and files are kept."));
        return;
      }
      retained.update({ ...input, disposition: "accepted-unknown" });
      if (!ref.current) return;
      pasteGenerationRef.current += 1;
      clearComposer();
      setAttachments([]);
      setDraftSelected(false);
      setSelectedMcp([]);
      setPlusOpen(false);
      setModeOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasText("");
      return;
    }
    const folderCommand = consumeSessionFolderCommand(value);
    const btwCommand = consumeBtwCommand(value);
    if (
      btwCommand.matched &&
      onBtwCommand &&
      attachmentsRef.current.length === 0 &&
      !inboxCard &&
      !noteCard &&
      !handoffCard
    ) {
      const input = {
        source: "composer-btw-intent",
        composerSessionId: sessionId,
        rawText: value,
        text: withChatCitations(btwCommand.text, citationsRef.current),
      };
      const retained = retainParentInput({
        kind: "composer-parent",
        sessionId: logicalParentSessionId,
        snapshot: () => input,
      });
      const accepted = continuation
        ? onBtwCommand(
            withChatCitations(btwCommand.text, citationsRef.current),
            undefined,
            continuation,
          )
        : onBtwCommand(withChatCitations(btwCommand.text, citationsRef.current));
      if (accepted === false) {
        retained.release();
        setPasteError(t("The message was not accepted. Your text and files are kept."));
        return;
      }
      retained.update({ ...input, disposition: "accepted-unknown" });
      pasteGenerationRef.current += 1;
      clearComposer();
      setPlusOpen(false);
      setModeOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasText("");
      return;
    }
    if (folderCommand.matched && onPlaceInFolder && !sessionFolderSelected) {
      openSessionFolderPicker();
      return;
    }

    if (isCompactCommand(value)) {
      if (!onCompactContext?.(...continuationArgs)) return;
      if (!ref.current) return;
      pasteGenerationRef.current += 1;
      clearComposer();
      setPlusOpen(false);
      setModeOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasText("");
      return;
    }

    const command = consumePlanCommand(
      folderCommand.matched && sessionFolderSelected ? folderCommand.text : value,
    );
    // A typed /plan must behave like the disabled Plan button: say why, and
    // keep the draft instead of starting a turn the transport would refuse.
    const planBlocked = planUnavailableReason(harness);
    if ((planSelected || command.planning) && planBlocked) {
      setPasteError(`Plan mode is unavailable: ${planBlocked}`);
      return;
    }
    const orchestratorCommand =
      !remote && !hideTopBar && !command.planning
        ? consumeOrchestratorCommand(command.text)
        : { text: command.text, matched: false };
    const text = isNativeCommandPrompt(orchestratorCommand.text, harness)
      ? orchestratorCommand.text
      : composeInboxMessage(inboxCard, orchestratorCommand.text);
    const submittedCitations = [...citationsRef.current];
    const submittedText = withChatCitations(
      operatorSelected && !consumeOperatorCommand(text).matched ? `/operator ${text}` : text,
      submittedCitations,
    );
    const files = attachmentsRef.current;
    if (!text && submittedCitations.length === 0 && files.length === 0 && !noteCard && !handoffCard)
      return;
    // The files stay in the draft; say why they are not going out.
    if (files.length > 0 && !harnessSupportsAttachments(harness)) {
      setPasteError(
        t("This provider cannot take attachments. They are kept; remove them or switch provider."),
      );
      return;
    }
    // `!command` runs in the shell: it goes out exactly as typed, with none of
    // the context a prompt would carry.
    const shellLine =
      submittedCitations.length === 0 &&
      files.length === 0 &&
      !resendEdited &&
      !inboxCard &&
      !noteCard &&
      !handoffCard &&
      parseShellCommand(value) !== undefined;
    // Clear the parent draft before onSubmit. The app can synchronously remount
    // the composer when the first message leaves an empty session (EmptySession →
    // docked layout). If draftRef still holds the sent text, the new instance
    // resurrects it as initialDraft.
    const resendDraftRevision = draftRevisionRef.current;
    const resendBorrowedAttachmentIds = new Set(borrowedAttachmentIdsRef.current);
    const resendSelectedMcp = selectedMcp;
    const originalParentIdentity = parentChanged.identity();
    const dispatchInput = {
      source: "composer-dispatch-intent",
      disposition: "dispatching",
      composerSessionId: sessionId,
      rawText: value,
      text: submittedText,
      attachments: files,
      selectedMcp: resendSelectedMcp,
      plan: planSelected || command.planning,
      operator: operatorSelected,
      orchestration: orchestrationSelected || orchestratorCommand.matched,
      resendEdited,
      queue,
      busy,
      harness,
      model,
      modelSettings,
      runtimeMode,
      providerAccountId,
      draftRevision: resendDraftRevision,
    };
    const retained = retainParentInput({
      kind: "composer-parent",
      sessionId: logicalParentSessionId,
      snapshot: () => dispatchInput,
      missingCoverage: ["decision-conservation"],
    });
    publishDraft("", false);
    const accepted = onSubmit(
      shellLine
        ? value.trim()
        : mcpContextText(taggedMcpServers(submittedText, selectedMcp), submittedText),
      files,
      {
        // The primary action steers; only the explicit queue action defers.
        ...(busy
          ? {
              followUpBehavior: queue ? ("queue" as const) : ("steer" as const),
            }
          : {}),
        intent: shellLine
          ? "default"
          : planSelected || command.planning
            ? "plan"
            : orchestrationSelected || orchestratorCommand.matched
              ? "orchestrate"
              : "default",
        // Both project preparation and remote reconnect may reject after the
        // composer cleared. A newer draft keeps ownership of the composer.
        onSendRejected: () => {
          retained.update({
            ...dispatchInput,
            disposition: "late-send-rejection",
          });
          if (parentChanged.identity() !== originalParentIdentity) return false;
          // Only into an empty composer: never over what was typed since.
          if (
            !ref.current ||
            ref.current.value ||
            attachmentsRef.current.length ||
            citationsRef.current.length
          )
            return false;
          restoreDraft(
            withChatCitations(text, submittedCitations),
            files,
            resendBorrowedAttachmentIds,
          );
          selectedMcpRef.current = resendSelectedMcp;
          setSelectedMcpState(resendSelectedMcp);
          setPlanSelected(planSelected || command.planning);
          setOperatorSelected(operatorSelected);
          setOrchestrationSelected(orchestrationSelected || orchestratorCommand.matched);
          return true;
        },
        ...(resendEdited
          ? {
              resendEdited: true,
              onResendRejected: ({ providerRewound }) => {
                retained.update({
                  ...dispatchInput,
                  disposition: "late-resend-rejection",
                  providerRewound,
                });
                if (parentChanged.identity() !== originalParentIdentity) return;
                if (draftRevisionRef.current !== resendDraftRevision) return;
                restoreDraft(
                  withChatCitations(text, submittedCitations),
                  files,
                  resendBorrowedAttachmentIds,
                );
                selectedMcpRef.current = resendSelectedMcp;
                setSelectedMcpState(resendSelectedMcp);
                setResendEdited(!providerRewound);
              },
            }
          : {}),
      },
      ...continuationArgs,
    );
    // The app can reject a turn before it is recorded (for example while an
    // orchestration is paused). Keep the user's text, files and selected mode
    // intact so resolving the blocker never destroys their work.
    if (accepted === false) {
      retained.release();
      // Restore the typed text without the inbox prompt (its card is still
      // attached) and bring back the mode the typed /plan or /orchestrate
      // selected, so Enter cannot send a normal turn that may edit files.
      restoreDraft(
        withChatCitations(shellLine ? value : orchestratorCommand.text, submittedCitations),
        files,
      );
      if (command.planning) setPlanSelected(true);
      if (orchestratorCommand.matched) setOrchestrationSelected(true);
      setPasteError(t("The message was not accepted. Your text and files are kept."));
      return;
    }
    retained.update({ ...dispatchInput, disposition: "accepted-unknown" });
    pasteGenerationRef.current += 1;
    historyRef.current = null;
    clearComposer();
    borrowedAttachmentIdsRef.current.clear();
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedMcp([]);
    setResendEdited(false);
    setPlanSelected(false);
    setOperatorSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setPlusOpen(false);
    setModeOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    setPasteError(null);
    syncHasText("");
  };
  useLayoutEffect(() => {
    submitContinuationRef.current = completeSubmit;
  });
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (isImeComposition(e.nativeEvent)) return;
    if (!canMutateDraft()) {
      if (
        busy &&
        onStop &&
        (keybindingPressed(STOP_TURN_COMMAND, e, isDefaultStopChord(e)) ||
          isInterruptChord(e, e.currentTarget.selectionStart !== e.currentTarget.selectionEnd))
      ) {
        e.preventDefault();
        stopPendingSend();
      }
      return;
    }
    if (creatingSkill) return;
    if (
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !(slash || mentionOpen || pickerOpen)
    ) {
      const version = translationHistoryKey(
        currentTranslationHistory(),
        e.currentTarget.value,
        e.key,
      );
      if (version !== undefined) {
        e.preventDefault();
        applyTextareaEdit(e.currentTarget, version, version.length);
        return;
      }
    }
    const escapeArmedAt = escapeArmedRef.current;
    escapeArmedRef.current = null;
    if (e.key === "Enter" && !e.shiftKey && consumeBtwCommand(e.currentTarget.value).matched) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (
      e.key === " " &&
      runsSessionFolderCommandOnSpace({
        text: e.currentTarget.value,
        selectionStart: e.currentTarget.selectionStart,
        selectionEnd: e.currentTarget.selectionEnd,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
    ) {
      e.preventDefault();
      openSessionFolderPicker();
      return;
    }

    if (
      e.key === " " &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      promptTemplates.length > 0 &&
      e.currentTarget.selectionStart === e.currentTarget.selectionEnd
    ) {
      const el = e.currentTarget;
      const hit = templateTriggerAt(el.value, el.selectionStart, promptTemplates);
      if (hit) {
        e.preventDefault();
        const edit = insertTemplateBody(el.value, hit.start, hit.end, hit.template.body);
        applyTextareaEdit(el, edit.text, edit.caret);
        return;
      }
    }

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index + 1) % rankedFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index - 1 + rankedFiles.length) % rankedFiles.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const file = rankedFiles[mentionActive];
        if (file) pickMention(file);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const file = rankedFiles[mentionActive];
        if (file) {
          e.preventDefault();
          pickMention(file);
          return;
        }
        setMention(null);
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (isNewSessionCommand(e.currentTarget.value) ||
        isClearSessionCommand(e.currentTarget.value) ||
        isCompactCommand(e.currentTarget.value) ||
        isResumeCommand(e.currentTarget.value) ||
        isMcpCommand(e.currentTarget.value) ||
        isSessionFolderCommand(e.currentTarget.value))
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive((index) => (index + 1) % rankedSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive((index) => (index - 1 + rankedSkills.length) % rankedSkills.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const skill = rankedSkills[skillActive];
        if (skill) pickSkill(skill);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const skill = rankedSkills[skillActive];
        if (skill) {
          e.preventDefault();
          pickSkill(skill);
          return;
        }
        if (!slash.query) {
          e.preventDefault();
          return;
        }
        setSlash(null);
      }
    }

    // Claude Code keys: Esc (rebindable) or Ctrl+C with nothing selected stops
    // the running turn; when idle, Esc leaves edit mode and Esc Esc on an
    // empty composer recalls the last message for editing.
    if (!(slash || mentionOpen || pickerOpen)) {
      const el = e.currentTarget;
      if (
        busy &&
        onStop &&
        (keybindingPressed(STOP_TURN_COMMAND, e, isDefaultStopChord(e)) ||
          isInterruptChord(e, el.selectionStart !== el.selectionEnd))
      ) {
        e.preventDefault();
        stopPendingSend();
        return;
      }
      if (!busy && isDefaultStopChord(e)) {
        const now = performance.now();
        const action = composerEscapeAction({
          editingLastTurn: resendEdited,
          empty: navigationEmpty,
          canRecall: editLastTurnSupported && !!lastTurnRecall,
          armedAt: escapeArmedAt,
          now,
        });
        if (action) e.preventDefault();
        if (action === "exit-edit") exitEditMode();
        else if (action === "recall") recallLastTurn();
        else if (action === "arm") escapeArmedRef.current = now;
        if (action) return;
      }
    }

    // Shift+Tab (rebindable) queues the message behind the running turn.
    // With nothing to queue it does nothing: the key stays in the composer
    // either way, so a press between turns never throws focus onto the toolbar.
    if (
      keybindingPressed(QUEUE_MESSAGE_COMMAND, e, isDefaultQueueChord(e)) &&
      !(slash || mentionOpen || pickerOpen)
    ) {
      e.preventDefault();
      if (
        queueShortcutApplies({
          busy,
          backgroundOnly,
          allowBusySubmit,
          disabled: disabled || worktreeRemoved,
          popupOpen: false,
          draftMode: draftActive,
          text: withChatCitations(e.currentTarget.value, citationsRef.current),
          attachmentCount: attachmentsRef.current.length,
        })
      ) {
        submit(e.currentTarget.value, true);
      }
      return;
    }

    // Plain arrows browse prompt history; Esc Esc owns conversation rewind.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const el = e.currentTarget;
      const result = historyKey({
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        text: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
        composerEmpty: navigationEmpty,
        menuOpen: !!slash || mentionOpen || pickerOpen,
        entries: promptHistory?.() ?? [],
        browse: historyRef.current,
      });
      historyRef.current = result.browse;
      if (result.text !== undefined) {
        e.preventDefault();
        applyTextareaEdit(el, result.text, result.text.length);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e.currentTarget.value);
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (
      !draftWorkspace ||
      !onWorkspaceModeChange ||
      !enabled ||
      busy ||
      isImeComposition(e.nativeEvent) ||
      !isWorkspaceModeShortcut(e)
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next = workspaceCreation.mode === "current" ? "worktree" : "current";
    if (next === "worktree" && !resolvedWorktreeBase) return;
    if (!canMutateDraft()) return;
    mutateParentInput(parentChanged, () =>
      onWorkspaceModeChange(next, next === "worktree" ? resolvedWorktreeBase : undefined),
    );
    ref.current?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canMutateDraft()) {
      e.preventDefault();
      return;
    }
    setPasteError(null);
    const messageFiles = messageFilesFromClipboard(e.clipboardData);
    if (messageFiles) {
      e.preventDefault();
      const captured = captureDraft(e.currentTarget);
      const text = e.clipboardData.getData("text/plain");
      if (captured) insertRestoredText(captured, text);
      if (!attachmentsSupported) {
        setPasteError(t("This conversation does not accept attachments."));
        return;
      }
      rememberAttachmentRead((accepted) =>
        attachmentsFromFiles(messageFiles).then((pasted) =>
          accepted.apply(() => {
            if (!accepted.isCurrent()) {
              pasted.forEach(revokeAttachment);
              return;
            }
            addAttachments(pasted);
            const skipped = skippedPastedFiles(messageFiles, pasted);
            if (skipped) setPasteError(skipped);
          }),
        ),
      );
      return;
    }
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) {
      // A webview reports a paste as text only, so a screenshot or a file
      // copied in a file manager arrives with nothing to attach; both live on
      // the native clipboard.
      if (!attachmentsSupported) {
        // A screenshot arrives with no text; say it was not taken.
        if (!e.clipboardData.getData("text/plain"))
          setPasteError(t("This conversation does not accept attachments."));
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      // Prose and whitespace alike are the webview's to insert.
      if (text && !isFileReferenceText(text)) return;
      // A file URI becomes a chip, so it is kept out of the draft; with no text
      // at all the paste carried an image the webview cannot see.
      e.preventDefault();
      // Captured before the read crosses an IPC hop. Send and draft reset bump
      // the generation, so a finished read cannot attach onto a draft that is gone.
      const captured = isFileReferenceText(text) ? captureDraft(e.currentTarget) : null;
      rememberAttachmentRead((accepted) =>
        nativeClipboardAttachments(text)
          .then(({ files: pasted, warning }) =>
            accepted.apply(() => {
              if (!accepted.isCurrent()) {
                pasted.forEach(revokeAttachment);
                return;
              }
              if (pasted.length) {
                // WebKit can insert the URI after preventDefault. The chip
                // replaces it, so the draft must not keep that text.
                if (captured) dropPastedText(captured, text);
                addAttachments(pasted);
              } else if (captured) insertRestoredText(captured, text);
              if (warning) setPasteError(warning);
            }),
          )
          .catch((reason: unknown) => {
            if (!accepted.isCurrent()) return;
            accepted.fail(reason);
            setPasteError(reason instanceof Error ? reason.message : String(reason));
          }),
      );
      return;
    }
    e.preventDefault();
    if (!attachmentsSupported) {
      setPasteError(t("This conversation does not accept attachments."));
      return;
    }
    rememberAttachmentRead((accepted) =>
      attachmentsFromFiles(files).then((pasted) =>
        accepted.apply(() => {
          if (!accepted.isCurrent()) {
            pasted.forEach(revokeAttachment);
            return;
          }
          addAttachments(pasted);
          const skipped = skippedPastedFiles(files, pasted);
          if (skipped) setPasteError(skipped);
        }),
      ),
    );
  };

  const insertDictation = (text: string) => {
    if (ref.current && canMutateDraft()) insertAtCaret(ref.current, text);
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported || !canMutateDraft()) return;
    const selection = retainAttachmentPickerSelection();
    setPasteError(null);
    rememberAttachmentRead((accepted) =>
      pickAttachments(selection).then((files) =>
        accepted.apply(() => {
          if (!accepted.isCurrent() || !attachmentSink.current.attachmentsSupported) {
            files.forEach(revokeAttachment);
            return;
          }
          attachmentSink.current.addAttachments(files);
          ref.current?.focus();
        }),
      ),
    );
  };

  const focusFromComposerSpace = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [tabindex], [contenteditable="true"]',
      )
    )
      return;
    event.preventDefault();
    onFocus();
    ref.current?.focus({ preventScroll: true });
  };

  const sessionDirectoryPicker =
    showSessionDirs && sessionId ? (
      <SessionDirsPicker
        sessionId={sessionId}
        project={cwd ?? executionCwd}
        workingDirectory={executionCwd}
        recents={recents}
        onProjectChange={
          hideProjectPicker || hideTopBar
            ? undefined
            : (...args) => mutateParentInput(parentChanged, () => onCwdChange(...args))
        }
        enabled={enabled}
        onClose={() => ref.current?.focus()}
      />
    ) : null;

  // Operation modes are separate from adding context to the message.
  const modeChoices = [
    ...(!remote || remoteFeatures?.plan
      ? [
          {
            kind: "item" as const,
            id: "plan",
            label: t("Plan mode"),
            icon: <AiIdea />,
            checked: planActive,
            disabled: !!planUnavailableReason(harness),
            title: planUnavailableReason(harness),
            description: planUnavailableReason(harness)
              ? t("Unavailable: {p0}", { p0: planUnavailableReason(harness) })
              : t("Review a plan before building"),
          },
        ]
      : []),
    ...(!remote
      ? [
          {
            kind: "item" as const,
            id: "operator",
            label: t("Operator"),
            icon: <Bot />,
            checked: operatorActive,
            description: t("Give this thread access to") + " " + PRODUCT_IDENTITY.displayName,
          },
        ]
      : []),
    ...(!remote && !hideTopBar
      ? [
          {
            kind: "item" as const,
            id: "orchestrator",
            label: t("Orchestrator"),
            icon: <Share />,
            badge: "v1",
            checked: orchestrationActive,
            description: t("Plan and coordinate agent work"),
          },
        ]
      : []),
    ...(canSaveDraft && onSaveDraft
      ? [
          {
            kind: "item" as const,
            id: "draft",
            label: t("Draft"),
            icon: <CircleDashed />,
            checked: draftActive,
            description: t("Save this message without starting the agent"),
          },
        ]
      : []),
  ];

  // Reading mode tucks the workspace row away unless it has something to say.
  const workspaceNeedsAttention =
    !!workspaceCreationError || workspaceCreation.pending || !!worktreeRemoved;

  // The project picker belongs to the execution context under the writing
  // surface, beside workspace and branch, not inside the box.
  const projectContextPicker =
    !hideTopBar && !remote && !hideProjectPicker ? (
      <div data-composer-context className="flex min-w-0 items-center">
        <CwdPicker
          cwd={cwd}
          recents={recents}
          projectLogoPath={projectLogoPath}
          enabled={enabled}
          onCwdChange={(...args) => mutateParentInput(parentChanged, () => onCwdChange(...args))}
          onNewTerminal={worktreeRemoved ? undefined : onNewTerminal}
          onClose={() => ref.current?.focus()}
        />
      </div>
    ) : null;

  return (
    <div
      data-composer
      data-usage-guide="composer"
      data-usage-guide-active={hotkeys ? "true" : undefined}
      data-composer-reading={reading ? "true" : undefined}
      className={`relative shrink-0 ${shell || compact ? "" : "p-1.5 pt-0"}`}
      onMouseDown={disabled ? undefined : onFocus}
      onKeyDownCapture={disabled ? undefined : onComposerKeyDown}
    >
      {question && onQuestionReply ? (
        <QuestionForm
          prompt={question}
          parentSessionId={logicalParentSessionId}
          draftScope={questionDraftScope ?? sessionId}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      ) : null}
      {parentClosed ? (
        <p role="status" className="px-3 text-ui-micro text-(--ui-text-secondary)">
          {t("Preparing session checkpoint. Your draft is kept.")}
        </p>
      ) : null}
      {children}
      {sessionId ? <WorkspaceRewindPreviewHost sessionId={sessionId} /> : null}
      {sessionId && !draftWorkspace ? (
        <SessionWorkspaceActions
          key={`workspace-actions:${sessionId}`}
          sessionId={sessionId}
          cwd={cwd}
          enabled={enabled}
        />
      ) : null}
      {draftWorkspace && workspaceCreationError && (hideTopBar || hideBranchPicker) ? (
        <div className="px-3 py-2">
          <WorkspaceCreationStatus
            pending={false}
            error={workspaceCreationError}
            onRetry={workspaceCreation.refresh}
            onUseCurrentCheckout={
              workspaceHostUpdateRequired && enabled && !busy && onWorkspaceModeChange
                ? () => onWorkspaceModeChange("current")
                : undefined
            }
          />
        </div>
      ) : null}
      <TranscriptSelectionMenu
        selection={translationSelection.selection}
        onDismiss={translationSelection.dismissSelection}
        onTranslate={(target) => {
          if (!canMutateDraft()) return;
          const selection = translationSelection.selection;
          if (selection) setTranslationRequest({ selection, target });
        }}
      />
      {translationRequest ? (
        <TranslationResultDialog
          text={translationRequest.selection.text}
          surroundingText={repromptReference(
            translationRequest.selection.value,
            translationRequest.selection.start,
            translationRequest.selection.end,
          )}
          target={translationRequest.target}
          context={translationContext}
          onClose={() => setTranslationRequest(null)}
          onApply={(translation) => {
            if (!canMutateDraft()) throw new Error("Composer input is temporarily closed.");
            const el = ref.current;
            const selected = translationRequest.selection;
            if (!el || el.value !== selected.value) throw new Error("Draft changed");
            const history = translatedSelection(
              selected.value,
              selected.start,
              selected.end,
              translation,
            );
            translationHistoryRef.current = { epoch: translationScope.epoch, history };
            applyTextareaEdit(el, history.translated, selected.start + translation.length);
            el.focus();
          }}
        />
      ) : null}
      {usageLimit ? (
        <UsageLimitNotice
          limit={usageLimit}
          provider={accountProvider}
          accountId={providerAccountId}
          onResume={
            onUsageLimitResume
              ? () => {
                  mutateParentInput(parentChanged, onUsageLimitResume);
                }
              : undefined
          }
          onResumeAtReset={
            onUsageLimitResumeAtReset
              ? (...args) => {
                  mutateParentInput(parentChanged, () => onUsageLimitResumeAtReset(...args));
                }
              : undefined
          }
          onSwitchAccount={
            accountProvider && onSelectProviderAccount
              ? (accountId) => {
                  mutateParentInput(parentChanged, () =>
                    onSelectProviderAccount(accountProvider, accountId),
                  );
                }
              : undefined
          }
          onSwitchModel={() => setModelPickerRequest((count) => count + 1)}
          onDismiss={
            onUsageLimitDismiss
              ? () => {
                  mutateParentInput(parentChanged, onUsageLimitDismiss);
                }
              : undefined
          }
        />
      ) : null}
      <DeliveryProgressNotice sessionId={sessionId} messages={queuedMessages} />
      <MessageQueue
        parentSessionId={logicalParentSessionId}
        key={sessionId}
        sessionId={sessionId}
        messages={queuedMessages}
        status={queueStatus}
        canAttach={attachmentsSupported}
        remote={remote && !remoteFeatures?.steer}
        busy={busy}
        runningTarget={remote ? undefined : { harness, model, modelSettings, runningModelTarget }}
        steerSupported={remote ? !!remoteFeatures?.steer : canSteerHarness(harness)}
        onDelete={onDeleteQueuedMessage}
        onEdit={onEditQueuedMessage}
        onEditingChange={onQueuedMessageEditingChange}
        onReorder={onReorderQueuedMessages}
        onSteer={onSteerQueuedMessage}
        onResume={onResumeQueue}
      />
      <div className="relative overflow-visible">
        {mcpPickerOpen ? (
          <ComposerSuggestions anchor={boxRef} below={shell}>
            <McpServerPicker
              connections={mcpCatalog.connections}
              harness={harness}
              claudeStatus={mcpStatus}
              loading={mcpLoading}
              error={mcpError}
              onPick={(server) => {
                if (!canMutateDraft()) return;
                const el = ref.current;
                if (!el) return;
                const previous = selectedMcp.find(
                  (item) =>
                    item.server.provider === server.provider &&
                    item.server.name === server.name &&
                    item.server.scope === server.scope &&
                    item.server.configPath === server.configPath,
                );
                const tag = previous ?? newMcpTag(server, selectedMcp);
                if (!previous) setSelectedMcp((current) => [...current, tag]);
                if (!previous || !taggedMcpServers(el.value, [tag]).length) {
                  const at = Math.min(mcpInsertAt.current ?? el.selectionStart, el.value.length);
                  const before = el.value.slice(0, at);
                  const after = el.value.slice(at);
                  const leading = before && !/\s$/.test(before) ? " " : "";
                  const trailing = after && /^\s/.test(after) ? "" : " ";
                  const insertion = `${leading}${tag.token}${trailing}`;
                  const next = before + insertion + after;
                  el.value = next;
                  resizeComposer(el);
                  el.setSelectionRange(at + insertion.length, at + insertion.length);
                  draftRevisionRef.current += 1;
                  setDraft(next);
                  syncHasText(next);
                  setMention(null);
                }
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                el.focus();
              }}
              onManage={() => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                window.dispatchEvent(new Event("bycoda:open-mcp-settings"));
              }}
              onDismiss={(reason) => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                if (reason === "escape") ref.current?.focus();
              }}
            />
          </ComposerSuggestions>
        ) : sessionFolderOpen ? (
          <ComposerSuggestions anchor={boxRef} below={shell}>
            <SessionFolderPicker
              folders={sessionFolders}
              onPick={(target) => {
                if (!canMutateDraft()) return;
                setSessionFolderOpen(false);
                setSessionFolderSelected(true);
                onPlaceInFolder?.(target);
                const el = ref.current;
                if (!el) return;
                const cursor = el.selectionStart ?? el.value.length;
                if (/^\s*\/add-to-folder$/i.test(el.value)) {
                  el.value = `${el.value} `;
                  resizeComposer(el);
                  setDraft(el.value);
                  syncHasText(el.value);
                  el.setSelectionRange(el.value.length, el.value.length);
                } else {
                  el.setSelectionRange(cursor, cursor);
                }
                requestAnimationFrame(() => el.focus());
              }}
              onDismiss={() => {
                setSessionFolderOpen(false);
                ref.current?.focus();
              }}
            />
          </ComposerSuggestions>
        ) : skillPickerOpen ? (
          <ComposerSuggestions anchor={boxRef} below={shell}>
            <SkillPicker
              parentSessionId={logicalParentSessionId}
              skills={rankedSkills}
              prefix={slash?.trigger ?? "/"}
              showCreate={slash?.trigger !== "$"}
              query={slash?.query ?? ""}
              active={skillActive}
              creating={creatingSkill}
              cwd={executionCwd}
              error={createError}
              busy={createBusy}
              onActive={setSkillActive}
              onPick={pickSkill}
              onStartCreate={() => {
                if (!canMutateDraft()) return;
                setCreatingSkill(true);
                setCreateError(null);
              }}
              onCancelCreate={() => {
                setCreatingSkill(false);
                setCreateError(null);
                const el = ref.current;
                if (el) syncTokensFromTextarea(el);
                el?.focus();
              }}
              onCreate={(name, scope) => {
                if (!canMutateDraft()) return;
                let parentAttempt = parentInputRef.current?.admit() ?? null;
                if (!parentAttempt) return;
                const initialParentAttempt = parentAttempt;
                setCreateBusy(true);
                setCreateError(null);
                let createdPath: string | undefined;
                void mountedClosure
                  .prepare(async (accepted) => {
                    if (parentAttempt!.settled) parentAttempt = parentAttempt!.resume();
                    const attempt = parentAttempt;
                    if (!attempt) throw new Error("Parent preparation owner changed.");
                    void accepted.whenSettled?.().then(attempt.finish, attempt.finish);
                    // A successful file creation is never repeated merely because
                    // its later mounted capture/Native draft ACK needs retry.
                    createdPath ??= await createBlankSkill({
                      cwd: executionCwd,
                      name,
                      scope,
                    });
                    const path = createdPath;
                    attempt.apply(() =>
                      accepted.apply(() => {
                        const el = ref.current;
                        const token = slashRef.current;
                        if (el && token) {
                          const rest = el.value.slice(token.end).replace(/^\s/, "");
                          const next = `${el.value.slice(0, token.start)}${rest}`;
                          el.value = next;
                          resizeComposer(el);
                          el.setSelectionRange(token.start, token.start);
                          setDraft(next);
                          syncHasText(next);
                        }
                        setCreatingSkill(false);
                        setSlash(null);
                        setCreateError(null);
                        void skillCatalog.refresh({ refresh: true }).catch((error) => {
                          console.warn("Composer operation failed", error);
                        });
                        onOpenFile?.(path);
                        el?.focus();
                      }),
                    );
                  })
                  .catch((err: unknown) => {
                    initialParentAttempt.finish();
                    setCreateError(err instanceof Error ? err.message : String(err));
                  })
                  .finally(() => {
                    initialParentAttempt.finish();
                    setCreateBusy(false);
                  });
              }}
            />
          </ComposerSuggestions>
        ) : null}
        {mentionOpen && !pickerOpen ? (
          <ComposerSuggestions anchor={boxRef} below={shell}>
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={looksLikeProject(executionCwd) && peekProjectFiles(executionCwd) == null}
              includeNotes={notesEnabled}
              onActive={setMentionActive}
              onPick={pickMention}
            />
          </ComposerSuggestions>
        ) : null}
        <div
          ref={boxRef}
          data-composer-box
          data-ui-focus-group=""
          data-ui-focus-quiet=""
          onPointerDown={focusFromComposerSpace}
          data-composer-editing={resendEdited ? "" : undefined}
          // z-10: in-pane stacking above sibling layers; no in-pane layer scale exists, so the literal stays.
          className={`relative z-10 rounded-xl border ${resendEdited ? "edit-last-turn-composer" : ""}`}
        >
          <ComposerCitations
            citations={citations}
            disabled={parentClosed || !!submission}
            onChange={(next) => {
              if (!canMutateDraft()) return;
              parentChanged();
              replaceCitations(next);
              draftRevisionRef.current += 1;
              publishDraft(ref.current?.value ?? draftTextRef.current);
            }}
          />
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((file, index) => (
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  token={tokens[index]}
                  onInsertToken={() => insertAttachmentToken(file.id)}
                  onRemove={() => removeAttachment(file.id)}
                />
              ))}
            </div>
          ) : null}

          {pasteError ? (
            <Alert tone="danger" role="alert">
              {pasteError}
            </Alert>
          ) : null}

          {inboxCard ? (
            <InboxMiniCard
              card={inboxCard}
              onDismiss={
                onInboxCardDismiss
                  ? () => mutateParentInput(parentChanged, onInboxCardDismiss)
                  : undefined
              }
            />
          ) : null}

          {noteCard ? (
            <NoteMiniCard
              card={noteCard}
              onDismiss={
                onNoteCardDismiss
                  ? () => mutateParentInput(parentChanged, onNoteCardDismiss)
                  : undefined
              }
            />
          ) : null}

          {handoffCard ? (
            <HandoffMiniCard
              card={handoffCard}
              onDismiss={
                onHandoffCardDismiss
                  ? () => mutateParentInput(parentChanged, onHandoffCardDismiss)
                  : undefined
              }
            />
          ) : null}

          <div className="relative">
            {!plainDraft ? (
              <div
                ref={highlightRef}
                aria-hidden
                style={{ textIndent: modeIndent }}
                className={`composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap wrap-break-word px-3 text-ui-body leading-5.5 text-(--ui-tone-neutral-fg) font-sans ${
                  shell ? "py-4" : "py-3"
                }`}
              >
                <ComposerHighlight
                  text={draft}
                  mode={leadingMode}
                  names={skillNames}
                  mentions={mentionIndex.labels}
                  mcpTags={selectedMcp}
                  attachments={attachments}
                />
              </div>
            ) : null}
            <textarea
              ref={ref}
              readOnly={parentClosed}
              data-ui-focus="group"
              data-composer-empty={navigationEmpty ? "true" : undefined}
              data-composer-plain={plainDraft ? "true" : undefined}
              style={{ textIndent: modeIndent }}
              rows={reading ? 1 : 2}
              spellCheck={spelling}
              autoCorrect={spelling ? "on" : "off"}
              defaultValue={mountDraft}
              placeholder={
                worktreeRemoved
                  ? t("Select a branch or worktree to continue…")
                  : inboxCard
                    ? t("Add a note, or send to start…")
                    : noteCard
                      ? t("Add a message, or send…")
                      : handoffCard
                        ? t("Add context, or send to continue…")
                        : (placeholder ??
                          (harness === "codex"
                            ? t("Ask, build, / for commands, $ for skills, @ for references...")
                            : t(
                                "Ask, build, / for commands and skills, @ for references, ! to run a command... ",
                              )))
              }
              aria-label={inputAriaLabel}
              disabled={disabled}
              className={`composer-field scrollbar-none relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-transparent px-3 text-ui-body leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
                shell ? "py-4" : "py-3"
              }`}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => syncHighlightScroll(e.currentTarget)}
              onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
              onKeyUp={(e) => syncTokensFromTextarea(e.currentTarget)}
              onSelect={(e) => syncTokensFromTextarea(e.currentTarget)}
              onInput={(e) => {
                if (!parentChanged.canMutate()) {
                  parentChanged();
                  return;
                }
                const el = e.currentTarget;
                const history = currentTranslationHistory();
                if (history && el.value !== history.original && el.value !== history.translated)
                  translationHistoryRef.current = null;
                // A user edit that took a token out of the text takes its
                // attachment with it; the rest renumber like a chip removal.
                const before = userEditBeforeRef.current;
                userEditBeforeRef.current = null;
                if (before !== null) {
                  const files = attachmentsRef.current;
                  for (const index of attachmentsDroppedByEdit(before, el.value, files)) {
                    removeAttachment(files[index].id);
                  }
                }
                if (enterBtwFromPrefix(el)) return;
                inputResize.schedule(el);
                draftRevisionRef.current += 1;
                setDraft(el.value);
                setSelectedMcp((current) => {
                  const retained = current.filter(
                    (tag) => taggedMcpServers(el.value, [tag]).length > 0,
                  );
                  return retained.length === current.length ? current : retained;
                });
                setPasteError(null);
                if (sessionFolderSelected && !consumeSessionFolderCommand(el.value).matched) {
                  setSessionFolderSelected(false);
                }
                syncHasText(el.value);
                syncTokensFromTextarea(el);
              }}
            />
          </div>

          <div className="composer-controls flex items-center gap-1 px-2 pb-2">
            <div
              data-composer-model-controls
              data-usage-guide="model-controls"
              className="composer-toolbar flex min-w-0 flex-1 items-center"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <ModelPicker
                  harness={harness}
                  model={model}
                  values={modelSettings}
                  allowedHarnesses={allowedModelHarnesses}
                  project={cwd}
                  showEffortSummary
                  hotkeys={hotkeys && enabled}
                  openRequest={modelPickerRequest}
                  accountId={providerAccountId}
                  accountChoices={Boolean(onSelectProviderAccount)}
                  extrasDisabled={disabled || !onModelSettingsChange}
                  onChange={(...args) =>
                    mutateParentInput(parentChanged, () => onModelChange(...args))
                  }
                  onSettingsChange={(settings) =>
                    mutateParentInput(parentChanged, () => onModelSettingsChange?.(settings))
                  }
                  onClose={() => ref.current?.focus()}
                />
                {!compact && harness !== "fx" ? (
                  <AccessPicker
                    value={runtimeMode}
                    busy={busy}
                    unavailable={unavailableRuntimeModes(harness)}
                    onChange={(...args) =>
                      mutateParentInput(parentChanged, () => onRuntimeModeChange(...args))
                    }
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                {!compact && modeChoices.length > 0 ? (
                  <div className="relative flex shrink-0">
                    <Button
                      ref={modeRef}
                      size="sm"
                      variant="ghost"
                      iconOnly
                      label={t("Mode")}
                      tooltip={t("Mode")}
                      selected={modeOpen}
                      aria-haspopup="menu"
                      aria-expanded={modeOpen}
                      data-composer-mode-trigger
                      onClick={() => setModeOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setModeOpen(true);
                        }
                      }}
                    >
                      <SlidersHorizontal className="icon-sm" />
                    </Button>
                    {modeOpen ? (
                      <DropdownMenu
                        anchor={modeRef}
                        returnFocusRef={modeRef}
                        label={t("Mode")}
                        side="top"
                        align="start"
                        width={280}
                        onClose={() => setModeOpen(false)}
                        data-composer-mode-menu
                        items={[
                          {
                            kind: "group",
                            id: "mode",
                            label: t("Mode"),
                            items: modeChoices,
                          },
                        ]}
                        onPick={(id) => {
                          if (!canMutateDraft()) return;
                          if (id === "plan") {
                            setPlanSelected(!planActive);
                            if (planActive) clearLeadingMode(PLAN_COMMAND.name);
                            setOperatorSelected(false);
                            setOrchestrationSelected(false);
                            setDraftSelected(false);
                          } else if (id === "operator") {
                            setOperatorSelected(!operatorActive);
                            if (operatorActive) clearLeadingMode(OPERATOR_COMMAND.name);
                            setPlanSelected(false);
                            setOrchestrationSelected(false);
                            setDraftSelected(false);
                          } else if (id === "orchestrator") {
                            setOrchestrationSelected(!orchestrationActive);
                            if (orchestrationActive) clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                            setPlanSelected(false);
                            setOperatorSelected(false);
                            setDraftSelected(false);
                          } else if (id === "draft") {
                            setDraftSelected(!draftActive);
                            if (draftActive) clearLeadingMode(DRAFT_COMMAND.name);
                            setPlanSelected(false);
                            setOperatorSelected(false);
                            setOrchestrationSelected(false);
                          }
                          ref.current?.focus();
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
                {hideTopBar || hideBranchPicker ? sessionDirectoryPicker : null}
              </div>
            </div>
            {/* Without the context row below, the tip sits with the trailing
                actions instead of adding an extra row inside the writing surface. */}
            {hideTopBar || hideBranchPicker ? <ComposerTips active={focused && !disabled} /> : null}
            <div className={compact ? "hidden" : "relative flex shrink-0"}>
              <Button
                ref={plusRef}
                variant="ghost"
                iconOnly
                label={t("Add files or skills")}
                tooltip={t("Add files or skills")}
                data-usage-guide="composer-plus"
                selected={plusOpen}
                aria-haspopup="menu"
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setPlusOpen(true);
                  }
                }}
              >
                <Plus className="icon-sm" />
              </Button>
              {plusOpen ? (
                <DropdownMenu
                  anchor={plusRef}
                  returnFocusRef={plusRef}
                  label={t("Add files or skills")}
                  side="top"
                  align="end"
                  width={280}
                  onClose={() => setPlusOpen(false)}
                  data-composer-plus
                  items={[
                    {
                      kind: "group",
                      id: "add",
                      label: t("Add to message"),
                      items: [
                        {
                          kind: "item",
                          id: "upload",
                          label: t("Upload file"),
                          icon: <FilePlus />,
                          disabled: !attachmentsSupported,
                          description: attachmentsSupported
                            ? undefined
                            : remote && !remoteFeatures?.attachments
                              ? t("Update this machine’s host to attach files")
                              : t("{p0} does not support attachments", {
                                  p0: HARNESS_TITLE[harness],
                                }),
                        },
                        ...(!remote
                          ? [
                              {
                                kind: "item" as const,
                                id: "skills",
                                label: t("Skills"),
                                icon: <CursorMagicSelection />,
                                description:
                                  harness === "codex"
                                    ? t("Choose a skill or type $name")
                                    : t("Choose a skill or type /name"),
                              },
                            ]
                          : []),
                      ],
                    },
                  ]}
                  onPick={(id) => {
                    if (!canMutateDraft()) return;
                    if (id === "upload") {
                      attachFromPicker();
                      return;
                    }
                    if (id === "skills") {
                      const el = ref.current;
                      if (!el) return;
                      const prefix = harness === "codex" ? "$" : "/";
                      const lead = el.value && !/\s$/.test(el.value) ? " " : "";
                      const start = el.value.length + lead.length;
                      const next = el.value + lead + prefix;
                      el.value = next;
                      el.setSelectionRange(next.length, next.length);
                      resizeComposer(el);
                      setDraft(next);
                      syncHasText(next);
                      setSlash({
                        start,
                        end: next.length,
                        query: "",
                        ...(prefix === "$" ? { trigger: "$" as const } : {}),
                      });
                      setSkillActive(0);
                      el.focus();
                      return;
                    }
                    ref.current?.focus();
                  }}
                />
              ) : null}
            </div>
            {!compact && operatorActive ? (
              <ModeCommandPill
                name={OPERATOR_COMMAND.name}
                onClear={() => {
                  if (!canMutateDraft()) return;
                  setOperatorSelected(false);
                  clearLeadingMode(OPERATOR_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {!compact && orchestrationActive ? (
              <ModeCommandPill
                name={ORCHESTRATOR_COMMAND.name}
                onClear={() => {
                  if (!canMutateDraft()) return;
                  setOrchestrationSelected(false);
                  clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {!compact && planActive ? (
              <ModeCommandPill
                name={PLAN_COMMAND.name}
                onClear={() => {
                  if (!canMutateDraft()) return;
                  setPlanSelected(false);
                  clearLeadingMode(PLAN_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {!compact && draftActive ? (
              <ModeCommandPill
                name={DRAFT_COMMAND.name}
                onClear={() => {
                  setDraftSelected(false);
                  clearLeadingMode(DRAFT_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}

            {resendEdited ? (
              <Button
                variant="ghost"
                type="button"
                tooltip={t("Stop editing last message")}
                shortcut="Esc"
                aria-label={t("Stop editing last message")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={exitEditMode}
                className="shrink-0"
              >
                <X className="icon-xs" />
                <span>{t("Cancel edit")}</span>
              </Button>
            ) : null}
            {editLastTurnSupported &&
            lastTurnRecall &&
            !busy &&
            !resendEdited &&
            navigationEmpty ? (
              <Button
                variant="ghost"
                motion="none"
                iconOnly
                label={t("Rewind and edit")}
                shortcut="Esc Esc"
                onMouseDown={(event) => event.preventDefault()}
                onClick={recallLastTurn}
                disabled={disabled || worktreeRemoved}
              >
                <Undo2 className="icon-sm" />
              </Button>
            ) : null}
            <div
              className="composer-send-controls flex shrink-0 items-center gap-1"
              data-usage-guide="send-controls"
            >
              {!hideTopBar ? (
                <ContextMeter
                  usage={context}
                  contextBlocks={contextBlocks}
                  empty={contextEmpty}
                  sessionUsage={sessionUsage}
                  onCompact={
                    compactSupported && !worktreeRemoved && onCompactContext
                      ? () => mutateParentInput(parentChanged, onCompactContext)
                      : undefined
                  }
                  compactDisabled={busy}
                  working={busy && enabled}
                />
              ) : null}
              <DictationButton
                disabled={disabled}
                onText={insertDictation}
                onError={setPasteError}
              />
              <ComposerAction
                busy={busy}
                submitting={submission?.sessionId === sessionId ? submission?.action : null}
                disabled={disabled || workspaceActionBlocked}
                hasValue={hasValue && !worktreeRemoved}
                allowBusySubmit={allowBusySubmit}
                label={draftActive ? t("Save draft") : t("Send")}
                busyLabel={
                  draftActive
                    ? undefined
                    : t(
                        !(remote ? remoteFeatures?.steer : canSteerHarness(harness)) ||
                          resolveFollowUpRoute({
                            busy,
                            worktreePreparing,
                            intent: planActive
                              ? "plan"
                              : orchestrationActive
                                ? "orchestrate"
                                : "default",
                            operatorCommand: operatorActive,
                            backgroundTaskCount,
                            backgroundOnly,
                            requested: "steer",
                          }) === "queue"
                          ? "Queue message"
                          : "Steer",
                      )
                }
                blockedReason={
                  sendHeldReason ??
                  sendBlockedReason ??
                  (workspaceActionBlocked
                    ? workspaceCreationError || t("Checking workspace policy…")
                    : undefined)
                }
                onSend={() => submit(ref.current?.value ?? "")}
                onQueue={
                  queueShortcutApplies({
                    busy,
                    backgroundOnly,
                    allowBusySubmit,
                    disabled: disabled || worktreeRemoved || workspaceSendBlocked,
                    popupOpen: false,
                    draftMode: draftActive,
                    text: withChatCitations(draft, citations),
                    attachmentCount: attachments.length,
                  })
                    ? () => submit(ref.current?.value ?? "", true)
                    : undefined
                }
                queueShortcut={queueShortcut}
                stopShortcut={stopShortcut ? `${stopShortcut} / Ctrl+C` : "Ctrl+C"}
                stopping={stopping}
                onStop={stopPendingSend}
              />
            </div>
          </div>
        </div>
        {!hideTopBar && hideBranchPicker && projectContextPicker ? (
          <div
            data-composer-secondary=""
            data-composer-attention={workspaceNeedsAttention ? "" : undefined}
            role="group"
            aria-label={t("Chat workspace")}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 pt-1.5"
          >
            {projectContextPicker}
          </div>
        ) : null}
        {!hideTopBar && !hideBranchPicker ? (
          <div
            data-composer-workspace
            data-composer-secondary=""
            data-composer-attention={workspaceNeedsAttention ? "" : undefined}
            onPointerDown={focusFromComposerSpace}
            role="group"
            aria-label={t("Chat workspace")}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 pt-1.5"
          >
            <div
              data-composer-workspace-controls
              className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-x-3 gap-y-1"
            >
              {projectContextPicker}
              {draftWorkspace && onWorkspaceModeChange && onWorktreeBaseChange ? (
                <>
                  {workspaceCreationError ? (
                    <WorkspaceIdentity worktree={workspaceCreation.mode === "worktree"} />
                  ) : (
                    <WorkspacePicker
                      alignBase="inline"
                      cwd={executionCwd}
                      mode={workspaceCreation.mode}
                      base={resolvedWorktreeBase}
                      enabled={enabled && !busy && !workspaceCreation.pending}
                      onModeChange={(...args) =>
                        mutateParentInput(parentChanged, () => onWorkspaceModeChange?.(...args))
                      }
                      onBaseChange={(...args) =>
                        mutateParentInput(parentChanged, () => onWorktreeBaseChange?.(...args))
                      }
                      onSelectWorktree={
                        onWorktreeChange
                          ? async (...args) => {
                              const result = mutateParentInput(parentChanged, () =>
                                onWorktreeChange(...args),
                              );
                              if (result === false)
                                throw new Error("Session input is temporarily closed.");
                              return await result;
                            }
                          : undefined
                      }
                      onOpenSettings={onManageWorktrees}
                      onClose={() => ref.current?.focus()}
                    />
                  )}
                  {workspaceCreation.mode === "current" ? (
                    <div className="flex min-w-0 justify-end">
                      <BranchPicker
                        cwd={executionCwd}
                        branch={branch}
                        enabled={enabled && !busy}
                        onChange={
                          onBranchChange
                            ? () => {
                                mutateParentInput(parentChanged, onBranchChange);
                              }
                            : undefined
                        }
                        onClose={() => ref.current?.focus()}
                      />
                    </div>
                  ) : null}
                </>
              ) : worktreeRemoved && onWorktreeChange ? (
                <>
                  <WorktreePicker
                    cwd={cwd}
                    executionCwd={executionCwd}
                    enabled={enabled && !busy}
                    onSelect={async (...args) => {
                      const select = onWorktreeChange;
                      if (!select) throw new Error("Worktree selection is unavailable.");
                      const result = mutateParentInput(parentChanged, () => select(...args));
                      if (result === false) throw new Error("Session input is temporarily closed.");
                      return await result;
                    }}
                    worktreeRemoved={worktreeRemoved}
                    onBranchChange={
                      onBranchChange
                        ? () => {
                            mutateParentInput(parentChanged, onBranchChange);
                          }
                        : undefined
                    }
                    onManage={onManageWorktrees}
                    onClose={() => ref.current?.focus()}
                  />
                </>
              ) : (
                <>
                  {onWorktreeChange ? (
                    <WorkspaceIdentity worktree={pathKey(cwd) !== pathKey(executionCwd)} />
                  ) : null}
                  <div className="flex min-w-0 justify-end">
                    <BranchPicker
                      cwd={executionCwd}
                      branch={branch}
                      enabled={enabled && !busy}
                      onChange={
                        onBranchChange
                          ? () => {
                              mutateParentInput(parentChanged, onBranchChange);
                            }
                          : undefined
                      }
                      onClose={() => ref.current?.focus()}
                    />
                  </div>
                </>
              )}
              {sessionDirectoryPicker ? (
                <div data-composer-directories className="flex min-w-0 justify-end">
                  {sessionDirectoryPicker}
                </div>
              ) : null}
            </div>
            <ComposerTips active={focused && !disabled} />
            {draftWorkspace ? (
              <div className="basis-full pb-1">
                <WorkspaceCreationStatus
                  preview={
                    workspaceCreation.mode === "worktree" ? workspaceCreation.preview : undefined
                  }
                  pending={workspaceCreation.pending && !workspaceCreationError}
                  error={workspaceCreationError}
                  onRetry={workspaceCreation.refresh}
                  onUseCurrentCheckout={
                    workspaceHostUpdateRequired && enabled && !busy && onWorkspaceModeChange
                      ? () => onWorkspaceModeChange("current")
                      : undefined
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function ComposerHighlight({
  text,
  mode,
  names,
  mentions,
  mcpTags,
  attachments,
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
  attachments: Attachment[];
}) {
  useLocale();
  const rest = mode ? text.slice(mode.end) : text;
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      <ComposerAttachmentHighlight
        text={rest}
        attachments={attachments}
        renderText={(text) =>
          skillTextParts(text, names).map((part, index) =>
            part.skill ? (
              <span key={index} className="text-skill">
                {part.text}
              </span>
            ) : (
              // Skill tokens always end on whitespace, so each remaining run still
              // starts on a boundary `@mention` matching can rely on.
              <MentionRuns key={index} text={part.text} mentions={mentions} mcpTags={mcpTags} />
            ),
          )
        }
      />
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}

function MentionRuns({
  text,
  mentions,
  mcpTags,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  useLocale();
  return (
    <>
      {mcpTagParts(text, mcpTags).map((part, index) =>
        part.tag ? (
          <span key={index} className="text-mention" data-mcp-tag={part.tag.token}>
            {part.text}
          </span>
        ) : (
          <FileMentionRuns key={index} text={part.text} mentions={mentions} />
        ),
      )}
    </>
  );
}

function FileMentionRuns({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
}) {
  useLocale();
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="text-mention">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              {/* `indent-0`: a leading mode command indents the first line,
                  and this box would otherwise inherit that indent. */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 indent-0">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="icon-sm" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon name={part.file.name} isDir={Boolean(part.file.isDir)} size="sm" />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export function ComposerAction({
  busy,
  submitting = null,
  disabled = false,
  hasValue,
  allowBusySubmit = true,
  label: labelProp,
  busyLabel,
  blockedReason,
  onSend,
  onQueue,
  queueShortcut,
  stopShortcut = "Esc",
  stopping = false,
  onStop,
}: {
  busy: boolean;
  /** Submission can wait for attachments independently of the running turn. */
  submitting?: "send" | "queue" | null;
  disabled?: boolean;
  hasValue: boolean;
  allowBusySubmit?: boolean;
  label?: string;
  /** Describes the existing follow-up route without changing send behavior. */
  busyLabel?: string;
  /** Shown instead of the label while Send cannot reach its destination. */
  blockedReason?: string;
  onSend: () => void;
  /** Queue the message behind the running turn; only offered while one runs. */
  onQueue?: () => void;
  queueShortcut?: string | null;
  stopShortcut?: string | null;
  /** Stop was requested and the provider has not confirmed yet. */
  stopping?: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const label = labelProp ?? t("Send");
  if (disabled && !busy && !submitting) {
    return (
      <Button
        variant="primary"
        tone="accent"
        motion="none"
        iconOnly
        label={blockedReason ? `${label}. ${blockedReason}` : label}
        tooltip={blockedReason ?? label}
        shortcut={blockedReason ? null : "Enter"}
        aria-description={blockedReason}
        disabled
      >
        <ArrowUp className="icon-sm" strokeWidth={2} />
      </Button>
    );
  }
  if (busy) {
    return (
      <>
        {(hasValue && allowBusySubmit && !disabled) || submitting ? (
          <>
            {onQueue ? (
              <Button
                motion="none"
                iconOnly
                label={t("Queue message")}
                tooltip={t("Queue message for when this turn finishes")}
                shortcut={queueShortcut}
                data-usage-guide="queue-button"
                loading={submitting === "queue"}
                loadingLabel={t("Sending…")}
                disabled={submitting === "send"}
                onClick={onQueue}
              >
                <ListEnd className="icon-sm" strokeWidth={1.75} />
              </Button>
            ) : null}
            <Button
              variant="primary"
              tone="accent"
              motion="none"
              iconOnly={!busyLabel}
              label={label}
              tooltip={busyLabel ?? label}
              shortcut="Enter"
              aria-description={busyLabel}
              loading={submitting === "send"}
              loadingLabel={t("Sending…")}
              disabled={submitting === "queue"}
              startIcon={busyLabel ? <ArrowUp className="icon-sm" strokeWidth={2} /> : undefined}
              onClick={onSend}
            >
              {busyLabel ? (
                <span>{busyLabel}</span>
              ) : (
                <ArrowUp className="icon-sm" strokeWidth={2} />
              )}
            </Button>
          </>
        ) : null}
        <Button
          variant="primary"
          tone="danger"
          motion="none"
          iconOnly
          label={t("Stop")}
          shortcut={stopShortcut}
          data-usage-guide="stop-button"
          loading={stopping}
          loadingLabel={t("Stopping…")}
          onClick={onStop}
        >
          <Square className="size-2.5 fill-current stroke-none" />
        </Button>
      </>
    );
  }

  return (
    <Button
      variant="primary"
      tone="accent"
      motion="none"
      iconOnly
      label={blockedReason ? `${label}. ${blockedReason}` : label}
      tooltip={blockedReason ?? label}
      shortcut={blockedReason ? null : "Enter"}
      disabled={!hasValue && !submitting}
      loading={submitting !== null}
      loadingLabel={t("Sending…")}
      onClick={onSend}
      aria-description={blockedReason}
    >
      <ArrowUp className="icon-sm" strokeWidth={2} />
    </Button>
  );
}
