import { errorText } from "../../../shared/lib/errors";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import {
  isAdoptedTurnStopping,
  subscribeAdoptedStopping,
} from "../../connections/public/adoptedStopping";
import {
  expandSkillGroupTokens,
  isSkillGroupPickerItem,
  skillGroupInsertion,
} from "../../skills/public/skillGroups";
import { SessionSubagentsMenu } from "./SessionSubagentsMenu";
import type { DockAgent } from "../model/activityDock";
import { ComposerAction } from "./ComposerAction";
import { Text } from "../../../shared/ui/Text";
export { ComposerAction } from "./ComposerAction";
import { MessageQueue } from "./MessageQueue";
import { ComposerHighlight } from "./ComposerHighlight";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerInlineEditor } from "./ComposerInlineEditor";
import { composerInputFocused } from "./composerInlineInput";
import { mayHaveComposerMarkdown } from "./ComposerMarkdown";
import { registerVoiceDraftReader } from "../../voice/model/voiceDraftContext";
import { DeliveryProgressIndicator } from "./DeliveryProgressNotice";
import { useClearComposerDraft } from "../hooks/useClearComposerDraft";
import { hasForeignMachineAttachment } from "../../connections/public/sessionMachineTarget";
import { useMountedComposerClosure } from "../hooks/useMountedComposerClosure";
import type { MountedComposerAction } from "../data/composerClosure";
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
import { chatCitationTokens, removeCitationFromText } from "../model/citationTokens";
import {
  extractChatCitations,
  withChatCitations,
  type ComposerCitation,
} from "../model/chatCitation";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { releaseAttachments } from "../model/releaseAttachments";
import { useT } from "../../../shared/i18n";
import { isVoiceSetupError, VoiceRecoveryAction } from "../../voice/ui/MicrophoneRecoveryAction";
import type { QueueAction } from "../model/queueAction";
import { useComposerSpelling } from "../../settings/public/composerSpelling";
import { ComposerTips } from "./ComposerTips";
import { useWorkspaceCreation } from "../../workspaces/model/workspaceCreation";
import {
  bundledHostWaitsForSessions,
  useBundledHostStatus,
} from "../../connections/public/bundledHostStatus";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { WorkspaceCreationStatus } from "../../workspaces/ui/WorkspaceCreationStatus";
import { SessionWorkspaceActions } from "../../workspaces/ui/SessionWorkspaceActions";
import { WorkspaceRewindPreviewHost } from "../../workspaces/ui/WorkspaceRewindPreview";
import "./chat-controls.css";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  AiIdea,
  CircleDashed,
  CursorMagicSelection,
  Share,
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
  type CSSProperties,
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
import { collectSkippedAttachments } from "../model/attachmentSkips";
import {
  attachmentDraftTokens,
  compactAttachmentDraftTokens,
  expandAttachmentDraftTokens,
  attachmentsDroppedByEdit,
  deleteTokenAtCaret,
  insertAtSelection,
  removeAttachmentFromText,
  tokensForIncoming,
} from "../model/attachmentTokens";
import { COMPOSER_MAX_HEIGHT, composerMaxHeight, resizeComposer } from "../model/composerResize";
import { createComposerResizeFrame } from "./composerResizeFrame";
import {
  clipboardTextWithAttachments,
  copyMessage,
  isFileReferenceText,
  messageFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import { editDraftText } from "../model/queuedMessageEdit";
import type { ContextUsage } from "../model/contextUsage";
import type { Block } from "../model/session";
import type { SessionUsage } from "../model/sessionUsage";
import { peekProjectFiles } from "../../files/public/fileIndex";
import {
  mentionLabel,
  mentionTokenAt,
  replaceMentionToken,
  type MentionIndex,
  type MentionToken,
} from "../../files/public/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { composeInboxMessage, type InboxComposerCard } from "../../inbox/model/githubTasks";
import type { HandoffComposerCard } from "../model/handoff";
import {
  isLocalProject,
  looksLikeProject,
  type RecentProject,
} from "../../projects/public/recents";
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
import { isProjectlessCwd } from "../model/recentSessions";
import { clearConversationBlocker } from "../model/clearConversation";
import { getSessions } from "../model/sessionsStore";
import {
  canSteerHarness,
  isHarnessTurnStopping,
  subscribeHarnessStopping,
} from "../../../integrations/harness/core/registry";
import {
  HARNESS_TITLE,
  harnessSupportsAttachments,
  planUnavailableReason,
  unavailableRuntimeModes,
} from "../model/session";
import { resolveFollowUpRoute } from "../model/messageQueue";
import type { UserQuestionPrompt, UserQuestionReply } from "../model/userQuestion";
import { historyKey, type HistoryBrowse } from "../model/composerHistory";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { captureDraft, dropPastedText, insertRestoredText } from "../../../shared/lib/draftRestore";
import {
  capturePastedTextAttachment,
  insertPastedTextReference,
} from "../model/pastedTextAttachment";
import {
  createBlankSkill,
  dollarTokenAt,
  rankSkills,
  hasNativeCommands,
  isNativeCommandPrompt,
  replaceSlashToken,
  slashTokenAt,
  skillTextParts,
  skillInvocationTokens,
  type Skill,
  type SlashToken,
} from "../../skills/model/skills";
import { AccessPicker } from "./AccessPicker";
import { ContextMeter } from "./ContextMeter";
import { AttachmentChip } from "./AttachmentChip";
import { BranchPicker } from "../../source-control/public/BranchPicker";
import { WorktreePicker } from "../../source-control/public/WorktreePicker";
import {
  isWorkspaceModeShortcut,
  WorkspaceIdentity,
  WorkspacePicker,
} from "../../workspace/ui/WorkspacePicker";
import type { Worktree } from "../../source-control";
import { CwdPicker } from "../../projects/public/CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { McpServerPicker } from "./McpServerPicker";
import { InboxMiniCard } from "../../inbox/ui/InboxMiniCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import { ModelControlPills, ModelPicker } from "./ModelPicker";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Button } from "../../../shared/ui/Button";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";
import { ComposerQuestionForm } from "./ComposerQuestionForm";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { SkillPicker } from "../../skills/ui/SkillPicker";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../model/quoteDraft";
import { useTabGroupLogos } from "../../projects/public/useTabGroupLogos";
import { useProjectBranchesState } from "../../source-control/public/useProjectBranches";
import {
  keybindingPressed,
  loadModelControls,
  loadNotesEnabled,
  subscribeModelControls,
  subscribeNotesEnabled,
} from "../../settings/public/settings";
import { isNoteMentionPath, type NoteComposerCard } from "../../notes";
import { useResolvedTabGroupLogo } from "../../workspace/model/tabGroups";
import { ComposerNotices, type ComposerFeedback } from "./ComposerNotices";
import {
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { consumePlanCommand, PLAN_COMMAND } from "../model/plan";
import { consumeOperatorCommand, OPERATOR_COMMAND } from "../model/operatorCommand";
import { consumeOrchestratorCommand, ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { consumeDraftCommand, DRAFT_COMMAND } from "../model/draftCommand";
import {
  ComposerModePicker,
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
} from "./modeCommands";
import { observeResize } from "../../../shared/lib/observeResize";
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
import {
  canOrganizeSessions,
  organizationFoldersForProject,
} from "../model/sessionOrganizationOperations";
import {
  cachedSessionOrganization,
  hydrateSessionOrganization,
  NATIVE_SESSION_ORGANIZATION_ACTIVE,
  subscribeSessionOrganization,
} from "../model/sessionOrganizationStore";
import type { SessionOrganizationResult } from "../model/sessionOrganizationStore";
import { SessionFolderPicker } from "./SessionFolderPicker";
import { MCP_COMMAND, isMcpCommand } from "../model/mcpCommand";
import { mcpContextText, newMcpTag, taggedMcpServers, type McpTag } from "../model/mcpPicker";
import { COMPOSER_PICKER_SELECTOR } from "../model/composerPickerSelector";
import { tokenSyncUnchanged, type TokenSyncSnapshot } from "../model/composerTokenSync";
import {
  getComposerAttachments,
  getComposerMcpTags,
  getComposerDraftMode,
  setComposerAttachments,
  setComposerDraftMode,
  setComposerDraftSnapshot,
  setComposerMcpTags,
  takeComposerNotice,
} from "../model/draftCache";
import type { LastTurnRecall } from "../model/editLastTurn";
import {
  isDefaultQueueChord,
  QUEUE_MESSAGE_COMMAND,
  queueChordConsumesKey,
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
import { useComposerMentionSources, usePendingMentionPick } from "./useComposerMentionSources";
import { workItemMentionOf } from "../model/workItemMentionRows";
import { CREWS_MENTION_SCOPE, crewMentionOf } from "../model/crewMentions";
import {
  composerMentionScopeHintOf,
  deleteScopedMentionAtCaret,
  scopedNoteMentionLabel,
} from "../model/composerMentionScopes";
import {
  parseServerMentionQuery,
  serverMentionAliasHint,
  serverMentionOf,
} from "../model/serverMentions";
import { rememberWorkItemMention } from "../../inbox/public/workItemMentions";
import { WorkItemMentionCwd } from "./WorkItemMentionChip";
import { keepEqualToken } from "./keepEqualToken";
import { useComposerWorkMode } from "./useComposerWorkMode";
import { useComposerSlashInventory } from "./useComposerSlashInventory";
import {
  applyTextareaEdit,
  applyUndoableTextareaEdit,
  selectedComposerAttachments,
  applyMentionDeletion,
  insertDictatedText,
} from "./composerTextareaEdit";
import { installAttachmentSelectionPolicy } from "./attachmentSelectionPolicy";
import { DictationButton } from "../../voice/ui/DictationButton";
import { useEditingLastTurn } from "./useEditingLastTurn";
import {
  useAttachmentSink,
  useComposerAttachmentLifecycle,
  useComposerAttachmentReads,
  releaseOverLimit,
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
  /** This session's subagents, past and running; the top-right control is hidden when empty. */
  subagents?: readonly DockAgent[];
  onOpenSubagent?: (agent: DockAgent) => void;
  inputAriaLabel?: string;
  disabled?: boolean;
  allowedModelHarnesses?: readonly HarnessId[];
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  cwd?: string;
  executionCwd: string;
  /** The Host has admitted a provider session in this projectless execution directory. */
  indexScratchFiles?: boolean;
  sessionId?: string;
  /** Nested composers keep their own draft ID; null means no known logical root. */
  parentSessionId?: string | null;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  machinePicker?: (locked: boolean) => ReactNode;
  machineEnvironmentId?: string;
  hideTopBar?: boolean;
  /** Embedded conversations show their fixed execution identity in the panel header. */
  hideIdentityControls?: boolean;
  /** Keeps Orchestrator mode and /orchestrator out of conversations that cannot run it. */
  hideOrchestrator?: boolean;
  /** Routes discovery to the host; local-only app modes remain unavailable. */
  remoteSession?: boolean;
  adoptedSteerSupported?: boolean;
  remoteFeatures?: {
    attachments: boolean;
    questionAttachments?: boolean;
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
  /** The turn has ended and delegated subagents still run; Queue waits for them. */
  subagentsRunning?: boolean;
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
  /** Recovery lives with the transcript failure when that block is available. */
  usageLimitInTranscript?: boolean;
  modelPickerOpenRequest?: number;
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
  ) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  onCompactContext?: (parentAdmission?: ParentAdmission) => boolean | Promise<boolean>;
  onNewSession?: (options?: NewSessionOptions, parentAdmission?: ParentAdmission) => void;
  onPlaceInFolder?: (
    target: SessionFolderTarget,
  ) => void | false | Promise<void | SessionOrganizationResult>;
  /** Open the picker of conversations Claude Code stored for this project. */
  onResumeProviderSession?: (parentAdmission?: ParentAdmission) => void;
  onDeleteQueuedMessage?: (messageId: string) => import("../model/queueAction").QueueRemoval;
  onEditQueuedMessage?: (
    messageId: string,
    text: string,
    attachments: Attachment[],
  ) => boolean | void;
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
  /** Pane-level notices rendered first in the one notice stack above the card. */
  notices?: ReactNode;
  children?: ReactNode;
};
type SubmissionRun = {
  admitted: ParentAdmission;
  rawAction: MountedComposerAction;
  parentChanged: ParentInputHandle;
  originalIdentity: unknown;
  intent: number;
  generation: number;
  token: symbol;
  value: string;
  queue: boolean;
  pasteFlightRef: { current: Promise<void> | null };
  pasteGenerationRef: { current: number };
  sendIntentRef: { current: number };
  submitLockRef: { current: symbol | null };
  submitInputRef: { current: { text: string; queue: boolean } | null };
  submitContinuationRef: {
    current: ((value: string, queue: boolean, original: ParentAdmission) => void) | null;
  };
  setPasteError: (value: SetStateAction<ComposerFeedback>) => void;
  setSubmission: (value: null) => void;
  t: (key: string) => string;
};

/** Waits out the in-flight paste, then hands the draft to the send continuation and releases the lock. */
async function awaitSubmission(run: SubmissionRun): Promise<void> {
  const { admitted, rawAction, parentChanged, originalIdentity, intent, generation, token } = run;
  try {
    let pending = run.pasteFlightRef.current;
    while (pending) {
      await pending;
      // Check the original owner before reading refs that a reused view may
      // already have assigned to a different logical session.
      if (parentChanged.identity() !== originalIdentity) return;
      if (run.pasteGenerationRef.current !== generation || run.sendIntentRef.current !== intent) {
        // A failed read already explains itself; keep that message.
        run.setPasteError(
          (current) =>
            current ?? run.t("The draft changed while it was being prepared. Send it again."),
        );
        return;
      }
      pending = run.pasteFlightRef.current;
    }
    if (parentChanged.identity() !== originalIdentity) return;
    admitted.apply(() =>
      rawAction.apply(() => run.submitContinuationRef.current?.(run.value, run.queue, admitted)),
    );
  } catch (error) {
    if (parentChanged.identity() === originalIdentity) {
      run.setPasteError({
        title: run.t("Could not prepare the message."),
        detail: errorText(error),
      });
    }
  } finally {
    rawAction.finish();
    if (parentChanged.identity() === originalIdentity && run.submitLockRef.current === token) {
      run.submitLockRef.current = null;
      run.submitInputRef.current = null;
      parentChanged();
      run.setSubmission(null);
    }
  }
}

/**
 * Cards already carried by a send that is still starting. The session keeps them
 * until the turn commits, and a remounted composer must not send them again.
 */
const dispatchedCards = new WeakSet<object>();
const undispatched = <T extends object>(card: T | undefined) =>
  card && !dispatchedCards.has(card) ? card : undefined;

export const Composer = memo(function Composer({
  enabled = true,
  focused,
  focusToken,
  hotkeys = false,
  shell = false,
  compact = false,
  reading = false,
  placeholder,
  subagents,
  onOpenSubagent,
  inputAriaLabel,
  disabled = false,
  harness,
  model,
  allowedModelHarnesses,
  modelSettings = NO_MODEL_SETTINGS,
  runtimeMode,
  cwd = "~",
  executionCwd,
  sessionId,
  parentSessionId,
  branch,
  recents = [],
  hideProjectPicker = false,
  hideBranchPicker = false,
  machinePicker,
  machineEnvironmentId,
  hideTopBar = false,
  hideIdentityControls = false,
  hideOrchestrator = false,
  remoteSession = false,
  adoptedSteerSupported,
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
  subagentsRunning = false,
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
  usageLimitInTranscript,
  modelPickerOpenRequest,
  onFocus,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  draftWorkspace: allowDraftWorkspace = false,
  indexScratchFiles = false,
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
  notices,
  children,
}: Props) {
  const t = useT();
  const logicalParentSessionId =
    parentSessionId === null ? undefined : (parentSessionId ?? sessionId);
  const parentClosed = useParentInputsClosed(logicalParentSessionId);
  const parentInputRef = useRef<ParentInputHandle | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [inlineAttachments, setInlineAttachments] = useState<ReadonlySet<string> | null>(null);
  const inlineActive = inlineAttachments !== null;
  const [initial] = useState(() => {
    const value = extractChatCitations(initialDraft ?? "");
    return {
      ...value,
      text: expandAttachmentDraftTokens(
        value.text,
        sessionId ? getComposerAttachments(sessionId) : [],
      ),
    };
  });
  const [citations, setCitationsState] = useState(initial.citations);
  const citationsRef = useRef<ComposerCitation[]>(citations);
  const draftTextRef = useRef(initial.text);
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
  const subagentList = onOpenSubagent && subagents?.length ? subagents : undefined;
  const composerRoot = useRef<HTMLDivElement>(null);
  const composerControls = useRef<HTMLDivElement>(null);
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
  const attachmentCutHistory = useRef<
    {
      generation: number;
      before: { text: string; attachments: Attachment[]; start: number; end: number };
      after: { text: string; attachments: Attachment[]; start: number; end: number };
      borrowed: ReadonlySet<string>;
      native: boolean;
    }[]
  >([]);
  const applyingAttachmentCut = useRef(false);
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
  const harnessStopping = useSyncExternalStore(
    subscribeHarnessStopping,
    () => (sessionId ? isHarnessTurnStopping(sessionId) : false),
    () => false,
  );
  const adoptedStopping = useSyncExternalStore(
    subscribeAdoptedStopping,
    () => (sessionId ? isAdoptedTurnStopping(sessionId) : false),
    () => false,
  );
  const stopping = harnessStopping || adoptedStopping;
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
  /** The text, caret and skill list the slash/dollar/mention parse last ran for. */
  const tokenSyncRef = useRef<TokenSyncSnapshot | null>(null);
  const escapeArmedRef = useRef<number | null>(null);
  const citationCommentDrafts = useRef(new Map<string, string>());
  const replaceCitations = useCallback((next: ComposerCitation[]) => {
    if (JSON.stringify(citationsRef.current) === JSON.stringify(next)) return;
    for (const id of citationCommentDrafts.current.keys()) {
      if (!next.some((citation) => citation.id === id)) citationCommentDrafts.current.delete(id);
    }
    citationsRef.current = next;
    setCitationsState(next);
    mountedClosureRef.current?.changed();
  }, []);
  const [draft, setDraftState] = useState(initial.text);
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
  const [mountDraft] = useState(() => (initialDraft === undefined ? undefined : initial.text));
  const hasProject = looksLikeProject(cwd) && !isProjectlessCwd(cwd);
  const draftWorkspace = allowDraftWorkspace && hasProject;
  const indexMentionFiles = (hasProject || indexScratchFiles) && looksLikeProject(executionCwd);
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
    draftWorkspace && enabled && hasProject,
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
    hasProject &&
    draftWorkspace &&
    (workspaceCreation.pending || (!!workspaceCreationError && workspaceMode === "worktree"));
  const resolvedWorktreeBase =
    workspaceCreation.base || branch || draftBranches?.current || undefined;
  const [hasText, setHasText] = useState(
    () => extractChatCitations(initialDraft ?? "").text.trim().length > 0,
  );
  // Says so when a restored draft lost an attachment whose file is gone.
  const [pasteError, setPasteError] = useState<ComposerFeedback>(
    () => (sessionId ? takeComposerNotice(sessionId) : undefined) ?? null,
  );
  const [plusOpen, setPlusOpen] = useState(false);
  const [narrowSettings, setNarrowSettings] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  // The model panel is portaled, so it needs the width decision from the composer container query.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- follows the container query through a ResizeObserver.
  useLayoutEffect(() => {
    const root = composerRoot.current;
    const controls = composerControls.current;
    if (!root || !controls) return;
    let previous: boolean | undefined;
    const sync = () => {
      const narrow =
        getComputedStyle(controls).getPropertyValue("--composer-settings-in-picker").trim() === "1";
      if (narrow === previous) return;
      previous = narrow;
      setModeOpen(false);
      setNarrowSettings(narrow);
    };
    sync();
    return observeResize(root, sync);
  }, []);
  const workMode = useComposerWorkMode(sessionId);
  const [planSelected, setPlanSelected] = workMode.plan;
  const [operatorSelected, setOperatorSelected] = workMode.operator;
  const [orchestrationSelected, setOrchestrationSelected] = workMode.orchestration;
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
  const [sessionFolderError, setSessionFolderError] = useState<ComposerFeedback>(null);
  const folderLoadFailed = useStableCallback((error: unknown) =>
    setSessionFolderError({
      title: t("Could not refresh the session folders."),
      detail: errorText(error),
    }),
  );
  const [sessionFolderPending, setSessionFolderPending] = useState(false);
  const [sessionFolderSaving, setSessionFolderSaving] = useState(false);
  const sessionFolderLoading = useRef(false);
  const [sessionFolderMutationBlocked, setSessionFolderMutationBlocked] = useState(false);
  const latestCwd = useStableCallback(() => cwd);
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
  // Named handle*: runs when the closure gate reopens, never during render.
  const handleReopened = () => {
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
  };
  const mountedClosure = useMountedComposerClosure({
    sessionId,
    input: ref,
    snapshot: () => ({
      text: withChatCitations(ref.current?.value ?? draftTextRef.current, citationsRef.current),
      attachments: attachmentsRef.current,
      mcpTags: selectedMcpRef.current,
      ...(draftModeRef.current ? { mode: "save" as const } : {}),
    }),
    reopened: handleReopened,
  });
  useLayoutEffect(() => {
    mountedClosureRef.current = mountedClosure;
  }, [mountedClosure]);
  const mcpInsertAt = useRef<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const remote = remoteSession;
  const steerSupported = remote
    ? !!remoteFeatures?.steer
    : (adoptedSteerSupported ?? canSteerHarness(runningModelTarget?.harness ?? harness));
  // Remote panes cannot see the delegated subagents, so only local sessions wait on them.
  const localSubagentsRunning = subagentsRunning && !remote;
  // Workspace APIs route remote:// paths to their owning machine.
  const localCwd = executionCwd;
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const extrasBeside = useSyncExternalStore(subscribeModelControls, loadModelControls) === "beside";
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
  const projectLogoPath = useResolvedTabGroupLogo(projectKey(cwd), groupLogos);
  useLayoutEffect(() => {
    slashRef.current = slash;
    mentionRef.current = mention;
    attachmentsRef.current = attachments;
  }, [slash, mention, attachments]);
  const mentionOpen =
    mention !== null &&
    (looksLikeProject(executionCwd) ||
      (!remote &&
        (notesEnabled ||
          serverMentionAliasHint(mention.query) !== undefined ||
          parseServerMentionQuery(mention.query) !== null)));
  const tokens = useMemo(() => attachmentDraftTokens(attachments), [attachments]);
  const navigationEmpty =
    draft.length === 0 &&
    citations.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const skillPickerOpen = creatingSkill || slash !== null;
  const canUseSessionFolders = hasProject && !!onPlaceInFolder && canOrganizeSessions(cwd);
  const pickerOpen =
    skillPickerOpen ||
    (canUseSessionFolders && (sessionFolderOpen || sessionFolderPending)) ||
    mcpPickerOpen;
  const {
    skillCatalog,
    promptTemplates,
    dollarSkills,
    rankedSkills: slashInventory,
    skillNames,
    skillGroups,
    skillDetails,
  } = useComposerSlashInventory({
    harness,
    executionCwd: localCwd,
    sessionId,
    pickerOpen,
    remote,
    remotePlan: !!remoteFeatures?.plan,
    hideOrchestrator: hideTopBar || hideOrchestrator,
    canStartNewSession: !!onNewSession,
    canSaveDraft: canSaveDraft && !!onSaveDraft,
    canResumeProviderSession: !!onResumeProviderSession,
    slashTrigger: slash?.trigger,
    slashQuery: slash?.query ?? "",
  });
  const rankedSkills = canUseSessionFolders
    ? slashInventory
    : slashInventory.filter(
        (skill) => skill.kind !== "builtin" || skill.name !== SESSION_FOLDER_COMMAND.name,
      );
  const hasGroupToken =
    skillGroups.length > 0 && expandSkillGroupTokens(draft, skillGroups) !== draft;
  const sessionDirsHarness =
    harness === "claude" || harness === "codex" || harness === "antigravity";
  const showSessionDirs =
    !remote && !compact && sessionDirsHarness && isLocalProject(cwd ?? executionCwd);
  const attachmentsSupported =
    (!remote || !!remoteFeatures?.attachments) && harnessSupportsAttachments(harness);
  const leadingMode = leadingModeCommand(draft, skillNames, { shell: true });
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  const composerPlaceholder = worktreeRemoved
    ? t("Select a branch or worktree to continue…")
    : inboxCard
      ? t("Add a note, or send to start…")
      : noteCard
        ? t("Add a message, or send…")
        : handoffCard
          ? t("Add context, or send to continue…")
          : (placeholder ?? t("Message"));
  // No token can be styled without one of these introducers. Plain drafts use
  // the native text once, avoiding a second full wrapping layout in the overlay.
  const plainDraft =
    !leadingMode &&
    !mayHaveComposerMarkdown(draft) &&
    !/[/@$]/.test(draft) &&
    !((attachments.length || citations.length) && draft.includes("["));
  const showClearText = draft.length > 0 && !shell && !disabled && !parentClosed;
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
  const {
    mentionIndex,
    rankedFiles,
    fileRankingPending,
    scope: mentionScope,
    scopeLoading: mentionScopeLoading,
    filesFailed,
    filesIndexNotice,
    retryFiles,
    workItemsLoading,
    workItemsScoped,
    workItemsAvailable,
    workItemsFailure,
    serversScoped,
    serversAvailable,
    serversLoading,
    serversFailed,
    retryServers,
  } = useComposerMentionSources({
    executionCwd,
    indexFiles: indexMentionFiles,
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
      const focused = composerInputFocused(el);
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
    (
      incoming: Attachment[],
      notice?: string | null,
      insertCopiedText?: (attachments: Attachment[]) => boolean,
    ) => {
      if (!canMutateDraft()) return;
      if (!harnessSupportsAttachments(harness)) return;
      if (incoming.length === 0) {
        // Nothing to add, but the files a read left out are still said.
        if (notice) setPasteError(notice);
        return;
      }
      const previous = attachmentsRef.current;
      const next = mergeAttachments(previous, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      const said = [releaseOverLimit(previous, next, incoming), notice].filter(Boolean).join(" ");
      draftRevisionRef.current += 1;
      // Skipped duplicates are not in `next`, so they get no token either.
      if (!insertCopiedText?.(next))
        insertIntoDraft(tokensForIncoming(previous, next.slice(previous.length)));
      syncHasText(ref.current?.value ?? "");
      // Said after the token insertion: that edit's input event clears the notice line.
      // Files the full draft left out, and blobs a read skipped, are said, not silently dropped.
      setPasteError(said || null);
      ref.current?.focus();
    },
    [canMutateDraft, harness, insertIntoDraft, syncHasText],
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
      insertIntoDraft(attachmentDraftTokens(attachmentsRef.current)[index]);
      ref.current?.focus();
    },
    [canMutateDraft, insertIntoDraft],
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
    [canMutateDraft, syncHasText],
  );
  // IPC listener registration is asynchronous; changing providers must not
  // detach it or leave it reading obsolete capabilities and callbacks.
  const attachmentSink = useAttachmentSink({ attachmentsSupported, remote, addAttachments });
  const { rememberAttachmentRead, readDroppedAttachments } = useComposerAttachmentReads({
    attachmentsRef,
    parentInputRef,
    mountedClosure,
    sinkRef: attachmentSink,
    attachmentApplyDepth,
    pasteGenerationRef,
    pasteFailuresRef,
    pasteFlightRef,
    setPasteError,
  });

  // Only native edits remove attachments; programmatic draft replacement does not.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const removeSelectionPolicy = installAttachmentSelectionPolicy(
      el,
      () => attachmentsRef.current,
    );
    const onBeforeInput = (event: InputEvent) => {
      userEditBeforeRef.current = el.value;
      const back = event.inputType === "deleteContentBackward";
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (!back && event.inputType !== "deleteContentForward") ||
        el.selectionStart !== el.selectionEnd
      ) {
        return;
      }
      const direction = back ? "back" : "forward";
      const mentionEdit =
        event.cancelable && canMutateDraft()
          ? deleteScopedMentionAtCaret(
              el.value,
              el.selectionStart,
              direction,
              mentionRef.current !== null,
            )
          : null;
      if (mentionEdit) {
        event.preventDefault();
        applyMentionDeletion(el, mentionEdit);
        return;
      }
      const edit = deleteTokenAtCaret(
        el.value,
        el.selectionStart,
        direction,
        attachmentsRef.current,
        chatCitationTokens(citationsRef.current.length),
        skillInvocationTokens(el.value).filter((token) => skillNames.has(token.name)),
      );
      if (!edit) return;
      event.preventDefault();
      applyTextareaEdit(el, edit.text, edit.caret);
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => {
      removeSelectionPolicy();
      el.removeEventListener("beforeinput", onBeforeInput);
    };
  }, [canMutateDraft, skillNames]);

  // An accepted external draft takes the same projection path as a native edit:
  // the textarea stays the authority and writes first, then the draft text,
  // Send/placeholder state and token menus follow it. Echoes of the current
  // text only refresh the ref, and nothing is written during an IME composition.
  const applyExternalDraft = (el: HTMLTextAreaElement, serialized: string) => {
    const { text: rawText, citations: incomingCitations } = extractChatCitations(serialized);
    const text = expandAttachmentDraftTokens(rawText, attachmentsRef.current);
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
    if (resizeComposer(el)) return;
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

  /**
   * `skipUnchanged` is for events that trail an input (select, keyup): the
   * input already parsed this text and caret, so they parse only when the
   * caret or the skill list moved. Input and click always parse.
   */
  const syncTokensFromTextarea = (el: HTMLTextAreaElement, skipUnchanged = false) => {
    if (creatingSkill) return;
    // A recalled "/plan" must not pop the menu over the next Up press.
    if (historyRef.current?.text === el.value) return;
    const { selectionStart, selectionEnd } = el;
    const cursor = selectionStart === selectionEnd ? selectionStart : null;
    const snapshot = { value: el.value, cursor, context: [dollarSkills, harness] };
    if (skipUnchanged && tokenSyncUnchanged(tokenSyncRef.current, snapshot)) return;
    tokenSyncRef.current = snapshot;
    if (cursor === null) {
      setSlash(null);
      setMention(null);
      return;
    }
    const token = slashTokenAt(el.value, cursor, hasNativeCommands(harness));
    // `$name` opens only while some Codex skill matches, so `$HOME` stays text.
    const dollar = token ? null : dollarTokenAt(el.value, cursor);
    setSlash(
      keepEqualToken(
        token ?? (dollar && rankSkills(dollarSkills, dollar.query, 1).length > 0 ? dollar : null),
      ),
    );
    setMention(keepEqualToken(token ? null : mentionTokenAt(el.value, cursor)));
  };

  const openSessionFolderPicker = useCallback(() => {
    if (!canUseSessionFolders) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      if (sessionFolderLoading.current) return;
      sessionFolderLoading.current = true;
      setSessionFolderPending(true);
      setSessionFolderError(null);
      void hydrateSessionOrganization()
        .then((state) => {
          if (latestCwd() !== cwd) return;
          setSessionFolders(organizationFoldersForProject(state, cwd));
          setSessionFolderOpen(true);
        })
        .catch((error: unknown) => {
          if (latestCwd() === cwd) folderLoadFailed(error);
        })
        .finally(() => {
          sessionFolderLoading.current = false;
          setSessionFolderPending(false);
        });
      return;
    }
    setSessionFolders(loadSessionFolders(cwd));
    setSessionFolderOpen(true);
  }, [canUseSessionFolders, cwd, latestCwd, folderLoadFailed]);

  useEffect(() => {
    if (!NATIVE_SESSION_ORGANIZATION_ACTIVE || !canUseSessionFolders || !sessionFolderOpen) return;
    return subscribeSessionOrganization(() => {
      const snapshot = cachedSessionOrganization();
      if (!snapshot) return;
      try {
        setSessionFolders(organizationFoldersForProject(snapshot, cwd));
      } catch (error) {
        folderLoadFailed(error);
      }
    }, folderLoadFailed);
  }, [canUseSessionFolders, cwd, sessionFolderOpen, folderLoadFailed]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !quoteRequest) return;

    // The caret survives blur; a never-placed caret (0 in a non-empty draft) means the end.
    const at = el.selectionStart || el.value.length;
    const result = consumeQuoteRequest(
      withChatCitations(el.value, citationsRef.current),
      consumedQuoteId.current,
      quoteRequest,
      { start: at, end: el.selectionStart ? el.selectionEnd : at },
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
      const caret = result.caret ?? incoming.text.length;
      el.setSelectionRange(caret, caret);
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
        canUseSessionFolders &&
        skill.kind === "builtin" &&
        skill.name === SESSION_FOLDER_COMMAND.name;
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
      if (isSkillGroupPickerItem(skill)) {
        const original = el.value;
        void skillGroupInsertion(
          skill.groupId,
          { harness, cwd: executionCwd, sessionId },
          token.trigger ?? "/",
        )
          .then((body) => {
            if (
              !body ||
              !canMutateDraft() ||
              ref.current !== el ||
              el.value !== original ||
              slashRef.current !== token
            )
              return;
            const spacer = el.value.slice(token.end).startsWith(" ") ? "" : " ";
            const edit = insertTemplateBody(el.value, token.start, token.end, body + spacer);
            applyTextareaEdit(el, edit.text, edit.caret + (spacer ? 0 : 1));
            setSlash(null);
            setCreatingSkill(false);
            el.focus();
          })
          .catch(() => setPasteError(t("Could not insert skill group")));
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
      executionCwd,
      harness,
      sessionId,
      t,
      publishDraft,
      canUseSessionFolders,
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
      const workItem = workItemMentionOf(file);
      const server = serverMentionOf(file);
      const scopeHint = composerMentionScopeHintOf(file);
      const crew = crewMentionOf(file);
      const hint = Boolean(scopeHint || workItem?.kind === "hint" || server?.hint);
      if (workItem?.kind === "item") rememberWorkItemMention(workItem.item);
      const label =
        workItem?.token ??
        server?.token ??
        scopeHint ??
        (crew ? `${CREWS_MENTION_SCOPE}${crew.token}` : undefined) ??
        (isNoteMentionPath(file.path)
          ? scopedNoteMentionLabel(file.relative)
          : remote
            ? file.relative
            : mentionLabel(file, mentionIndexRef.current));
      const next = replaceMentionToken(el.value, token, label, !hint);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (!hint && next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasText(next);
      setMention(
        hint ? { start: token.start, end: token.start + label.length + 1, query: label } : null,
      );
      el.focus();
    },
    [canMutateDraft, syncHasText, remote],
  );

  const pickPendingMention = usePendingMentionPick(
    executionCwd,
    sessionId,
    mentionOpen ? mention : null,
    fileRankingPending,
    rankedFiles[mentionActive],
    pickMention,
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
        `${COMPOSER_PICKER_SELECTOR}, [data-composer-plus], [data-question-form]`,
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
  }, [canMutateDraft, clearComposer, setResendEdited, setSelectedMcp, syncHasText]);

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
    canMutateDraft,
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
    void admitted.run(() =>
      awaitSubmission({
        admitted,
        rawAction,
        parentChanged,
        originalIdentity,
        intent,
        generation,
        token,
        value,
        queue,
        pasteFlightRef,
        pasteGenerationRef,
        sendIntentRef,
        submitLockRef,
        submitInputRef,
        submitContinuationRef,
        setPasteError,
        setSubmission,
        t,
      }),
    );
  };
  const completeSubmit = (submittedValue: string, queue = false, original?: ParentAdmission) => {
    const value = ref.current?.value ?? submittedValue;
    if (!canMutateDraft()) return;
    if (
      machinePicker &&
      hasForeignMachineAttachment(attachmentsRef.current, machineEnvironmentId)
    ) {
      setPasteError(
        t("This file belongs to another machine. Remove it or switch back before sending."),
      );
      return;
    }
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
      releaseAttachments(attachmentsRef.current, borrowedAttachmentIdsRef.current);
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
            ? t(
                "Importing terminal conversations from another machine is not available yet. Open {p0} on that machine to import them.",
                { p0: PRODUCT_IDENTITY.displayName },
              )
            : t("Terminal conversation import is not available in this composer."),
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
        t(
          "Saving drafts is unavailable here. Choose another mode explicitly to send this message.",
        ),
      );
      return;
    }
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = withChatCitations(
        compactAttachmentDraftTokens(draftCommand.text, files),
        citationsRef.current,
      );
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
      const revision = draftRevisionRef.current;
      const identity = parentChanged.identity();
      const finishDraftSave = (accepted: boolean | void) => {
        const isCurrent =
          parentChanged.identity() === identity && draftRevisionRef.current === revision;
        if (accepted === false) {
          retained.release();
          if (isCurrent)
            setPasteError(t("The draft was not accepted. Your text and files are kept."));
          return;
        }
        retained.update({ ...input, disposition: "accepted-unknown" });
        if (!isCurrent || !ref.current) return;
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
      };
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
        ...continuationArgs,
      );
      if (accepted instanceof Promise)
        void accepted.then(finishDraftSave, () => finishDraftSave(false));
      else finishDraftSave(accepted);
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
    if (folderCommand.matched && canUseSessionFolders && !sessionFolderSelected) {
      openSessionFolderPicker();
      return;
    }

    if (isCompactCommand(value)) {
      const revision = draftRevisionRef.current;
      const identity = parentChanged.identity();
      const clearAcceptedCommand = (accepted: boolean) => {
        if (
          !accepted ||
          !ref.current ||
          draftRevisionRef.current !== revision ||
          parentChanged.identity() !== identity
        )
          return;
        pasteGenerationRef.current += 1;
        clearComposer();
        setPlusOpen(false);
        setModeOpen(false);
        setSlash(null);
        setMention(null);
        setCreatingSkill(false);
        setCreateError(null);
        syncHasText("");
      };
      const accepted = onCompactContext?.(...continuationArgs);
      if (accepted instanceof Promise)
        void accepted.then(clearAcceptedCommand).catch((error) => {
          console.warn("Compaction could not start", error);
        });
      else clearAcceptedCommand(!!accepted);
      return;
    }

    // A group stays one chip in the draft; providers get its member invocations.
    const command = consumePlanCommand(
      expandSkillGroupTokens(
        compactAttachmentDraftTokens(
          folderCommand.matched && canUseSessionFolders && sessionFolderSelected
            ? folderCommand.text
            : value,
          attachmentsRef.current,
        ),
        skillGroups,
      ),
    );
    // A typed /plan must behave like the disabled Plan button: say why, and
    // keep the draft instead of starting a turn the transport would refuse.
    const planBlocked = planUnavailableReason(harness);
    if ((planSelected || command.planning) && planBlocked) {
      setPasteError(t("Plan mode is unavailable: {p0}", { p0: planBlocked }));
      return;
    }
    const orchestratorCommand =
      !remote && !hideTopBar && !hideOrchestrator && !command.planning
        ? consumeOrchestratorCommand(command.text)
        : { text: command.text, matched: false };
    const nativePrompt = isNativeCommandPrompt(orchestratorCommand.text, harness);
    const sendingInboxCard = undispatched(inboxCard);
    const sendingNoteCard = undispatched(noteCard);
    const sendingHandoffCard = undispatched(handoffCard);
    const text = nativePrompt
      ? orchestratorCommand.text
      : composeInboxMessage(sendingInboxCard, orchestratorCommand.text);
    const submittedCitations = [...citationsRef.current];
    const submittedText = withChatCitations(
      operatorSelected && !consumeOperatorCommand(text).matched ? `/operator ${text}` : text,
      submittedCitations,
    );
    const files = attachmentsRef.current;
    if (
      !text &&
      submittedCitations.length === 0 &&
      files.length === 0 &&
      !sendingNoteCard &&
      !sendingHandoffCard
    )
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
    // resurrects it as initialDraft. The attachment cache is read on mount too.
    const savedDraftAttachments = sessionId ? getComposerAttachments(sessionId) : [];
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
    if (sessionId && savedDraftAttachments.length > 0) {
      mountedClosure.publishCache(() => setComposerAttachments(sessionId, []));
    }
    publishDraft("", false);
    // A native command or shell line leaves its cards attached for the next message.
    const sentCards: object[] =
      nativePrompt || shellLine
        ? []
        : [sendingInboxCard, sendingNoteCard, sendingHandoffCard].flatMap((card) =>
            card ? [card] : [],
          );
    let sendRejected = false;
    const releaseSentCards = () => {
      sendRejected = true;
      sentCards.forEach((card) => dispatchedCards.delete(card));
    };
    const accepted = onSubmit(
      shellLine
        ? value.trim()
        : mcpContextText(taggedMcpServers(submittedText, selectedMcp), submittedText),
      files,
      {
        // The primary action steers; only the explicit queue action defers.
        ...(busy || queue
          ? {
              followUpBehavior: queue || !steerSupported ? ("queue" as const) : ("steer" as const),
            }
          : {}),
        intent: shellLine
          ? "default"
          : planSelected || command.planning
            ? "plan"
            : orchestrationSelected || orchestratorCommand.matched
              ? "orchestrate"
              : "default",
        // The session still holds these until the earlier send commits.
        ...(noteCard && !sendingNoteCard ? { noteCard: undefined } : {}),
        ...(handoffCard && !sendingHandoffCard ? { handoffCard: undefined } : {}),
        // Both project preparation and remote reconnect may reject after the
        // composer cleared. A newer draft keeps ownership of the composer.
        onSendRejected: () => {
          releaseSentCards();
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
      releaseSentCards();
      retained.release();
      if (sessionId && savedDraftAttachments.length > 0) {
        mountedClosure.publishCache(() => setComposerAttachments(sessionId, savedDraftAttachments));
      }
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
    if (!sendRejected) sentCards.forEach((card) => dispatchedCards.add(card));
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key)) {
      const undo = e.key.toLowerCase() === "z" && !e.shiftKey;
      const el = e.currentTarget;
      const cut = findAttachmentCut(undo, el.value);
      if (cut && !cut.native) {
        e.preventDefault();
        const version = undo ? cut.before : cut.after;
        restoreCutAttachments(version.attachments, cut.borrowed);
        applyTextareaEdit(el, version.text, version.start);
        el.setSelectionRange(version.start, version.end);
        return;
      }
    }
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
    const field = e.currentTarget;
    if (
      inlineActive &&
      (e.key === "Backspace" || e.key === "Delete") &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      field.selectionStart === field.selectionEnd
    ) {
      const edit = deleteScopedMentionAtCaret(
        field.value,
        field.selectionStart,
        e.key === "Backspace" ? "back" : "forward",
        mentionRef.current !== null,
      );
      if (edit) {
        e.preventDefault();
        userEditBeforeRef.current = field.value;
        applyMentionDeletion(field, edit);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && consumeBtwCommand(e.currentTarget.value).matched) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (
      e.key === " " &&
      canUseSessionFolders &&
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
        else pickPendingMention(e.currentTarget);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const file = rankedFiles[mentionActive];
        if (file) {
          e.preventDefault();
          pickMention(file);
          return;
        }
        if (fileRankingPending && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          pickPendingMention(e.currentTarget);
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
        (canUseSessionFolders && isSessionFolderCommand(e.currentTarget.value)))
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

    // Shift+Tab (rebindable) queues the message behind the running turn. It only
    // takes the key while something can be queued; otherwise Shift+Tab keeps its
    // native job of moving focus backwards so keyboard users are never trapped.
    // Open slash/mention/picker popups own Tab above and are excluded here.
    if (
      keybindingPressed(QUEUE_MESSAGE_COMMAND, e, isDefaultQueueChord(e)) &&
      !(slash || mentionOpen || pickerOpen)
    ) {
      const applies = queueShortcutApplies({
        busy,
        backgroundOnly,
        subagentsRunning: localSubagentsRunning,
        allowBusySubmit,
        disabled: disabled || worktreeRemoved,
        popupOpen: false,
        draftMode: draftActive,
        text: withChatCitations(e.currentTarget.value, citationsRef.current),
        attachmentCount: attachmentsRef.current.length,
      });
      if (queueChordConsumesKey(e, applies)) {
        e.preventDefault();
        if (applies) submit(e.currentTarget.value, true);
        return;
      }
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

  const findAttachmentCut = (undo: boolean, previous: string, next?: string) =>
    attachmentCutHistory.current.find((cut) => {
      const current = undo ? cut.after : cut.before;
      const target = undo ? cut.before : cut.after;
      return (
        cut.generation === pasteGenerationRef.current &&
        current.text === previous &&
        (next === undefined || target.text === next) &&
        current.attachments.length === attachmentsRef.current.length &&
        current.attachments.every((file, index) => file.id === attachmentsRef.current[index].id)
      );
    });

  const restoreCutAttachments = (files: Attachment[], borrowed: ReadonlySet<string>) => {
    const current = new Map(attachmentsRef.current.map((file) => [file.id, file]));
    const next = files.map((file) => current.get(file.id) ?? { ...file, previewUrl: undefined });
    releaseAttachments(
      attachmentsRef.current,
      borrowedAttachmentIdsRef.current,
      new Set(files.map((file) => file.id)),
    );
    borrowedAttachmentIdsRef.current = new Set(
      files.filter((file) => borrowed.has(file.id)).map((file) => file.id),
    );
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const selectedAttachments = (value: string, selectionStart: number, selectionEnd: number) => {
    return selectedComposerAttachments(value, selectionStart, selectionEnd, attachmentsRef.current);
  };

  const copyAttachmentSelection = (event: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    const el = event.currentTarget;
    const { value, selectionStart, selectionEnd } = el;
    const selection = selectedAttachments(value, selectionStart, selectionEnd);
    if (!selection) return;
    event.preventDefault();
    if (!canMutateDraft()) return;
    const { attachments, selected, text, start, end } = selection;
    const revision = draftRevisionRef.current;
    const generation = pasteGenerationRef.current;
    const isCurrent = () =>
      ref.current === el && el.isConnected && generation === pasteGenerationRef.current;
    void copyMessage(text, selected)
      .then(() => {
        if (
          !cut ||
          !isCurrent() ||
          revision !== draftRevisionRef.current ||
          el.value !== value ||
          el.selectionStart !== selectionStart ||
          el.selectionEnd !== selectionEnd ||
          !canMutateDraft()
        )
          return;
        const edit = editDraftText(
          { text: value, attachments },
          value.slice(0, start) + value.slice(end),
          start,
        );
        const borrowed = borrowedAttachmentIdsRef.current;
        const entry = {
          generation,
          before: { text: value, attachments, start, end },
          after: { ...edit.draft, start: edit.caret, end: edit.caret },
          borrowed,
          native: false,
        };
        attachmentCutHistory.current = [
          entry,
          ...attachmentCutHistory.current.filter((item) => item.generation === generation),
        ].slice(0, 12);
        restoreCutAttachments(edit.draft.attachments, borrowed);
        userEditBeforeRef.current = null;
        entry.native = applyUndoableTextareaEdit(
          el,
          edit.draft.text,
          edit.caret,
          applyingAttachmentCut,
        );
      })
      .catch((error: unknown) => {
        if (isCurrent())
          setPasteError({ title: t("Could not copy the selection."), detail: errorText(error) });
      });
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canMutateDraft()) {
      e.preventDefault();
      return;
    }
    setPasteError(null);
    const message = messageFromClipboard(e.clipboardData);
    if (message) {
      e.preventDefault();
      const el = e.currentTarget;
      const captured = captureDraft(el);
      if (captured && message.text) insertRestoredText(captured, message.text);
      const revision = draftRevisionRef.current;
      const expected = el.value;
      const pasteEnd = message.text
        ? captured && captured.start + message.text.length
        : captured?.end;
      if (!attachmentsSupported) {
        setPasteError(t("This conversation does not accept attachments."));
        return;
      }
      rememberAttachmentRead((accepted) => {
        const skips = collectSkippedAttachments();
        return attachmentsFromFiles(message.files, {
          onSkipped: skips.onSkipped,
          capacity: accepted.capacity,
        }).then((pasted) =>
          accepted.apply(() => {
            if (!accepted.isCurrent()) {
              pasted.forEach(revokeAttachment);
              return;
            }
            const canReplace = draftRevisionRef.current === revision;
            addAttachments(pasted, skips.notice(accepted.capacity), (attachments) => {
              if (
                !captured ||
                pasteEnd == null ||
                ref.current !== el ||
                !canReplace ||
                el.value !== expected ||
                (message.text && expected.slice(captured.start, pasteEnd) !== message.text)
              )
                return false;
              const text = clipboardTextWithAttachments(message, pasted, attachments);
              if (text === undefined) return false;
              applyTextareaEdit(
                el,
                expected.slice(0, captured.start) + text + expected.slice(pasteEnd),
                captured.start + text.length,
              );
              return true;
            });
          }),
        );
      });
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
      const paste =
        !shell && !isFileReferenceText(text)
          ? capturePastedTextAttachment(e.currentTarget, text)
          : undefined;
      if (paste) {
        e.preventDefault();
        rememberAttachmentRead(async (accepted) => {
          const skips = collectSkippedAttachments();
          const incoming = await attachmentsFromFiles([paste.file], {
            onSkipped: skips.onSkipped,
            capacity: accepted.capacity,
          });
          accepted.apply(() => {
            const el = ref.current;
            if (!accepted.isCurrent() || !el) {
              incoming.forEach(revokeAttachment);
              return;
            }
            addAttachments(incoming, skips.notice(accepted.capacity), (attachments) => {
              const index = attachments.findIndex((file) => file.id === incoming[0]?.id);
              if (index >= 0 && el === paste.field) {
                const edit = insertPastedTextReference(
                  el.value,
                  paste.range(el.value),
                  attachmentDraftTokens(attachments)[index],
                );
                applyTextareaEdit(el, edit.text, edit.caret);
              }
              return true;
            });
          });
        });
        return;
      }
      // Prose and whitespace alike are the webview's to insert.
      if (text && !isFileReferenceText(text)) return;
      // A file URI becomes a chip, so it is kept out of the draft; with no text
      // at all the paste carried an image the webview cannot see.
      e.preventDefault();
      // Captured before the read crosses an IPC hop. Send and draft reset bump
      // the generation, so a finished read cannot attach onto a draft that is gone.
      const captured = isFileReferenceText(text) ? captureDraft(e.currentTarget) : null;
      rememberAttachmentRead((accepted) =>
        nativeClipboardAttachments(text, accepted.capacity)
          .then(({ files: pasted, warning }) =>
            accepted.apply(() => {
              if (!accepted.isCurrent()) {
                pasted.forEach(revokeAttachment);
                return;
              }
              if (
                pasted.length ||
                warning ||
                accepted.capacity.notice() ||
                accepted.capacity.matchedPendingPath
              ) {
                // WebKit can insert the URI after preventDefault. The chip
                // replaces it, so the draft must not keep that text.
                if (captured) dropPastedText(captured, text);
                addAttachments(pasted);
              } else if (captured) insertRestoredText(captured, text);
              const notice = warning ?? accepted.capacity.notice();
              if (notice) setPasteError(notice);
            }),
          )
          .catch((reason: unknown) => {
            if (!accepted.isCurrent()) return;
            accepted.fail(reason);
            setPasteError({ title: t("Could not read attachments."), detail: errorText(reason) });
          }),
      );
      return;
    }
    e.preventDefault();
    if (!attachmentsSupported) {
      setPasteError(t("This conversation does not accept attachments."));
      return;
    }
    rememberAttachmentRead((accepted) => {
      const skips = collectSkippedAttachments();
      return attachmentsFromFiles(files, {
        onSkipped: skips.onSkipped,
        capacity: accepted.capacity,
      }).then((pasted) =>
        accepted.apply(() => {
          if (!accepted.isCurrent()) {
            pasted.forEach(revokeAttachment);
            return;
          }
          addAttachments(pasted, skips.notice(accepted.capacity));
        }),
      );
    });
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported || !canMutateDraft()) return;
    const selection = retainAttachmentPickerSelection();
    setPasteError(null);
    rememberAttachmentRead((accepted) =>
      pickAttachments(selection, accepted.capacity).then((files) =>
        accepted.apply(() => {
          if (!accepted.isCurrent() || !attachmentSink.current.attachmentsSupported) {
            files.forEach(revokeAttachment);
            return;
          }
          attachmentSink.current.addAttachments(files, accepted.capacity.notice());
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
            icon: <CursorMagicSelection />,
            checked: operatorActive,
            description: t("Give this thread access to") + " " + PRODUCT_IDENTITY.displayName,
          },
        ]
      : []),
    ...(!remote && !hideTopBar && !hideOrchestrator
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
    hasProject && (!!workspaceCreationError || workspaceCreation.pending || !!worktreeRemoved);

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

  // Typing re-renders this component; stable callbacks let the memoized picker skip it.
  const onPickerModelChange = useStableCallback((...args: Parameters<typeof onModelChange>) =>
    mutateParentInput(parentChanged, () => onModelChange(...args)),
  );
  const onPickerSettingsChange = useStableCallback((settings: Record<string, string>) =>
    mutateParentInput(parentChanged, () => onModelSettingsChange?.(settings)),
  );
  const onPickerAccessChange = useStableCallback((mode: RuntimeMode) =>
    mutateParentInput(parentChanged, () => onRuntimeModeChange(mode)),
  );
  const onPickerClose = useStableCallback(() => ref.current?.focus());
  const settingsInModelPicker = narrowSettings && !hideIdentityControls;
  const selectComposerMode = (id: string) => {
    if (!canMutateDraft()) return;
    if (id === "plan" && planActive) clearLeadingMode(PLAN_COMMAND.name);
    if (id === "operator" && operatorActive) clearLeadingMode(OPERATOR_COMMAND.name);
    if (id === "orchestrator" && orchestrationActive) clearLeadingMode(ORCHESTRATOR_COMMAND.name);
    if (id === "draft" && draftActive) clearLeadingMode(DRAFT_COMMAND.name);
    setPlanSelected(id === "plan" && !planActive);
    setOperatorSelected(id === "operator" && !operatorActive);
    setOrchestrationSelected(id === "orchestrator" && !orchestrationActive);
    setDraftSelected(id === "draft" && !draftActive);
    if (!settingsInModelPicker) ref.current?.focus();
  };
  const modeControl =
    !compact && modeChoices.length > 0 ? (
      <ComposerModePicker
        choices={modeChoices}
        onPick={selectComposerMode}
        open={modeOpen}
        onOpenChange={setModeOpen}
        settings={settingsInModelPicker}
      />
    ) : null;
  const changeCitations = (next: ComposerCitation[], removed?: number) => {
    if (!canMutateDraft()) return;
    parentChanged();
    const el = ref.current;
    replaceCitations(next);
    draftRevisionRef.current += 1;
    const text = el ? removeCitationFromText(el.value, citations.length, removed ?? -1) : "";
    if (el && text !== el.value)
      applyTextareaEdit(el, text, Math.min(el.selectionStart, text.length));
    else publishDraft(el?.value ?? draftTextRef.current);
  };

  const draftActions =
    showClearText || subagentList ? (
      <div className="ms-1 me-1.5 flex shrink-0 items-center gap-0.5">
        {showClearText ? (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            label={t("Clear text")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const field = ref.current;
              if (!field?.value || !canMutateDraft() || composingRef.current) return;
              field.focus();
              userEditBeforeRef.current = null;
              applyUndoableTextareaEdit(field, "", 0, applyingAttachmentCut);
            }}
          >
            <X className="icon-xs" />
          </Button>
        ) : null}
        {subagentList && onOpenSubagent ? (
          <SessionSubagentsMenu agents={subagentList} onOpen={onOpenSubagent} />
        ) : null}
      </div>
    ) : null;

  return (
    <div
      ref={composerRoot}
      data-composer
      data-usage-guide="composer"
      data-usage-guide-active={hotkeys ? "true" : undefined}
      data-composer-reading={reading ? "true" : undefined}
      style={{ "--composer-draft-max-height": `${COMPOSER_MAX_HEIGHT}px` } as CSSProperties}
      className={`relative shrink-0 ${shell || compact ? "" : "p-1.5 pt-0"}`}
      onMouseDown={disabled ? undefined : onFocus}
      onKeyDownCapture={disabled ? undefined : onComposerKeyDown}
    >
      <ComposerQuestionForm
        checkpointNoticeOwned
        question={question}
        sessionId={sessionId}
        parentSessionId={logicalParentSessionId}
        draftScope={questionDraftScope}
        onReply={onQuestionReply}
        onInteraction={onQuestionInteraction}
        attachmentsSupported={attachmentsSupported}
        remoteFeatures={remoteFeatures}
        remote={remote}
      />
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
      {hasProject &&
      draftWorkspace &&
      workspaceCreationError &&
      (hideTopBar || hideBranchPicker) ? (
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
        allowReprompt
        selection={translationSelection.selection}
        onDismiss={translationSelection.dismissSelection}
        onCopy={async () => {
          const selection = translationSelection.selection;
          if (!selection || ref.current?.value !== selection.value || !canMutateDraft())
            throw new Error("The selected draft text is no longer available.");
          const copied = selectedAttachments(selection.value, selection.start, selection.end);
          await copyMessage(copied?.text ?? selection.text, copied?.selected);
        }}
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
      <ComposerNotices
        leading={notices}
        usageLimit={usageLimitInTranscript ? undefined : usageLimit}
        accountProvider={accountProvider}
        providerAccountId={providerAccountId}
        guard={(run) => mutateParentInput(parentChanged, run)}
        onUsageLimitResume={onUsageLimitResume}
        usageLimitResumeDisabled={busy || disabled}
        onUsageLimitResumeAtReset={onUsageLimitResumeAtReset}
        onUsageLimitDismiss={onUsageLimitDismiss}
        onSelectProviderAccount={onSelectProviderAccount}
        onSwitchModel={
          hideIdentityControls ? undefined : () => setModelPickerRequest((count) => count + 1)
        }
        pasteError={
          typeof pasteError === "string" && isVoiceSetupError(pasteError)
            ? t("Dictation setup is needed")
            : pasteError
        }
        pasteErrorAction={
          typeof pasteError === "string" ? <VoiceRecoveryAction message={pasteError} /> : undefined
        }
        sessionFolderError={sessionFolderError}
        sessionFolderMutationBlocked={sessionFolderMutationBlocked}
        onSessionFolderRecovered={(message) => {
          if (!message) setSessionFolderMutationBlocked(false);
          setSessionFolderError(message);
        }}
      />
      <MessageQueue
        parentSessionId={logicalParentSessionId}
        key={sessionId}
        sessionId={sessionId}
        messages={queuedMessages}
        references={{
          names: skillNames,
          skillParts: skillTextParts,
          skillGroups,
          skillDetails,
          mentions: mentionIndex.labels,
          mcpTags: selectedMcp,
          onOpenFile,
        }}
        suggestions={{
          harness,
          executionCwd,
          sessionId,
          remote,
          remotePlan: !!remoteFeatures?.plan,
          notesEnabled,
        }}
        status={queueStatus}
        canAttach={attachmentsSupported}
        remote={remote && !remoteFeatures?.steer}
        busy={busy}
        waitingOnSubagents={!busy && localSubagentsRunning}
        runningTarget={remote ? undefined : { harness, model, modelSettings, runningModelTarget }}
        account={{ harness, providerAccountId }}
        steerSupported={steerSupported}
        onDelete={onDeleteQueuedMessage}
        onEdit={onEditQueuedMessage}
        onEditingChange={onQueuedMessageEditingChange}
        onReorder={onReorderQueuedMessages}
        onSteer={onSteerQueuedMessage}
        onResume={onResumeQueue}
      />
      <div className="relative overflow-visible">
        {mcpPickerOpen ? (
          <ComposerSuggestions
            anchor={boxRef}
            below={shell}
            dialog={{
              label: t("Choose an MCP server"),
              onDismiss: (reason) => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                if (reason === "escape") ref.current?.focus();
              },
            }}
          >
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
        ) : canUseSessionFolders && sessionFolderOpen ? (
          <ComposerSuggestions
            anchor={boxRef}
            below={shell}
            dialog={{
              label: t("Choose a session folder"),
              onDismiss: () => {
                setSessionFolderOpen(false);
                ref.current?.focus();
              },
            }}
          >
            <SessionFolderPicker
              folders={sessionFolders}
              saving={sessionFolderSaving}
              onPick={(target) => {
                if (
                  !canMutateDraft() ||
                  sessionFolderLoading.current ||
                  sessionFolderMutationBlocked
                )
                  return;
                sessionFolderLoading.current = true;
                setSessionFolderPending(true);
                setSessionFolderSaving(true);
                setSessionFolderError(null);
                void (async () => {
                  const result = await onPlaceInFolder?.(target);
                  if (result === false) return;
                  if (result && result.state === "unknown") {
                    setSessionFolderMutationBlocked(true);
                    setSessionFolderError(
                      t("Folder change outcome is unknown: {p0}", { p0: result.operationId }),
                    );
                    return;
                  }
                  if (result && result.state === "conflict") {
                    setSessionFolderError(t("Folder change conflicted; refresh before retrying."));
                    return;
                  }
                  if (result && result.state === "applied-unavailable") {
                    setSessionFolderMutationBlocked(true);
                    setSessionFolderError(
                      t("Folder change was applied, but refresh failed: {p0}", {
                        p0: result.operationId,
                      }),
                    );
                  }
                  setSessionFolderOpen(false);
                  setSessionFolderSelected(true);
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
                })()
                  .catch((error: unknown) =>
                    setSessionFolderError({
                      title: t("Could not change the session folder."),
                      detail: errorText(error),
                    }),
                  )
                  .finally(() => {
                    sessionFolderLoading.current = false;
                    setSessionFolderPending(false);
                    setSessionFolderSaving(false);
                  });
              }}
              onDismiss={() => {
                setSessionFolderOpen(false);
                ref.current?.focus();
              }}
            />
          </ComposerSuggestions>
        ) : canUseSessionFolders && sessionFolderPending ? (
          <ComposerSuggestions anchor={boxRef} below={shell} solid>
            <Text as="p" size="caption" tone="secondary" className="px-3 py-2">
              {t("Loading folders…")}
            </Text>
          </ComposerSuggestions>
        ) : skillPickerOpen ? (
          <ComposerSuggestions anchor={boxRef} below={shell} matchComposer>
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
                    if (createdPath == null) {
                      createdPath = await createBlankSkill({
                        cwd: executionCwd,
                        name,
                        scope,
                      });
                    }
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
                    setCreateError(presentRemoteError(err, { explicit: true }));
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
          <ComposerSuggestions anchor={boxRef} below={shell} solid matchComposer>
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={
                serversLoading ||
                workItemsLoading ||
                mentionScopeLoading ||
                fileRankingPending ||
                (!serversScoped &&
                  !workItemsScoped &&
                  !mentionScope &&
                  indexMentionFiles &&
                  peekProjectFiles(executionCwd) == null)
              }
              workItemsScoped={workItemsScoped}
              scope={mentionScope}
              serversScoped={serversScoped}
              includeServers={serversAvailable}
              includeWorkItems={workItemsAvailable}
              workItemsFailure={workItemsFailure}
              failed={serversScoped ? serversFailed : filesFailed}
              indexNotice={filesIndexNotice}
              onRetry={serversScoped ? retryServers : retryFiles}
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
          {...surfaceAttributes(
            { variant: "floating" },
            `relative z-(--layer-pane-sheet) rounded-xl border ${resendEdited ? "edit-last-turn-composer" : ""}`,
          )}
        >
          <ComposerCitations
            citations={citations}
            disabled={parentClosed || !!submission}
            onChange={changeCitations}
            drafts={citationCommentDrafts}
            inlineText={inlineActive ? draft : undefined}
          />
          {attachments.length > 0 ? (
            // Draft actions take the chip row's top-right corner so the text keeps its full width.
            <div className={`flex items-start ps-3 pt-1.5 ${draftActions ? "" : "pe-3"}`}>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 pt-0.5">
                {attachments.map((file, index) => (
                  <AttachmentChip
                    key={file.id}
                    attachment={file}
                    token={tokens[index]}
                    draft={{ projectRoot: executionCwd }}
                    onInsertToken={
                      !shell && inlineAttachments?.has(file.id)
                        ? undefined
                        : () => insertAttachmentToken(file.id)
                    }
                    onRemove={() => removeAttachment(file.id)}
                  />
                ))}
              </div>
              {draftActions}
            </div>
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

          <div className="flex items-start">
            <div className="relative min-w-0 flex-1">
              {!plainDraft && !inlineActive ? (
                <div
                  ref={highlightRef}
                  aria-hidden
                  style={{ textIndent: modeIndent }}
                  className={`composer-highlight pointer-events-none absolute inset-0 max-h-(--composer-draft-max-height) overflow-hidden whitespace-pre-wrap wrap-break-word px-3 text-ui-body leading-5.5 text-(--ui-tone-neutral-fg) font-sans ${
                    shell ? "py-4" : "py-3"
                  }`}
                >
                  <WorkItemMentionCwd value={cwd}>
                    <ComposerHighlight
                      text={draft}
                      mode={leadingMode}
                      names={skillNames}
                      skillParts={skillTextParts}
                      skillGroups={skillGroups}
                      skillDetails={skillDetails}
                      mentions={mentionIndex.labels}
                      mcpTags={selectedMcp}
                      attachments={attachments}
                      citations={citations.length}
                      citationSources={citations}
                      field={ref}
                      onOpenFile={onOpenFile}
                    />
                  </WorkItemMentionCwd>
                </div>
              ) : null}
              <ComposerInlineEditor
                field={ref}
                text={draft}
                attachmentProjectRoot={executionCwd}
                references={{
                  names: skillNames,
                  skillParts: skillTextParts,
                  skillGroups,
                  skillDetails,
                  mentions: mentionIndex.labels,
                  mcpTags: selectedMcp,
                  attachments,
                  citations: citations.length,
                  citationSources: citations,
                  modeEnd: leadingMode?.end ?? 0,
                  onOpenFile,
                }}
                label={inputAriaLabel ?? t("Message")}
                placeholder={composerPlaceholder}
                readOnly={parentClosed}
                disabled={disabled}
                spellCheck={spelling}
                onInlineAttachments={setInlineAttachments}
                onRemoveAttachment={removeAttachment}
                citationCommentDrafts={citationCommentDrafts}
                onChangeCitations={changeCitations}
              />
              {/* ui-drift-ignore: raw-native-control -- bespoke composer editor: overlay highlight, auto-resize, mention/skill keyboard */}
              <textarea
                ref={ref}
                hidden={inlineActive}
                aria-hidden={inlineActive || undefined}
                readOnly={parentClosed}
                data-ui-focus="group"
                data-composer-empty={navigationEmpty ? "true" : undefined}
                data-composer-plain={plainDraft ? "true" : undefined}
                style={{ textIndent: modeIndent }}
                rows={reading ? 1 : 2}
                // A group chip hides its source slug, which the spellchecker would still underline.
                spellCheck={spelling && !hasGroupToken}
                autoCorrect={spelling ? "on" : "off"}
                defaultValue={mountDraft}
                placeholder={composerPlaceholder}
                aria-label={inputAriaLabel ?? t("Message")}
                disabled={disabled}
                className={`composer-field relative max-h-(--composer-draft-max-height) w-full resize-none overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-transparent px-3 text-ui-body leading-5.5 placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
                  shell ? "py-4" : "py-3"
                }`}
                onFocus={onFocus}
                onKeyDown={onKeyDown}
                onCopy={(event) => copyAttachmentSelection(event, false)}
                onCut={(event) => copyAttachmentSelection(event, true)}
                onPaste={onPaste}
                onScroll={(e) => syncHighlightScroll(e.currentTarget)}
                onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
                onKeyUp={(e) => syncTokensFromTextarea(e.currentTarget, true)}
                onSelect={(e) => syncTokensFromTextarea(e.currentTarget, true)}
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
                  const { inputType } = e.nativeEvent as InputEvent;
                  const undo = inputType === "historyUndo";
                  const cut =
                    (undo || inputType === "historyRedo") &&
                    findAttachmentCut(undo, before ?? draftTextRef.current, el.value);
                  if (cut) {
                    const version = undo ? cut.before : cut.after;
                    restoreCutAttachments(version.attachments, cut.borrowed);
                    el.setSelectionRange(version.start, version.end);
                  } else if (before !== null && !applyingAttachmentCut.current) {
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
            {draftActions && attachments.length === 0 ? (
              <div className="mt-1.5">{draftActions}</div>
            ) : null}
          </div>

          <div
            ref={composerControls}
            className="composer-controls flex items-center gap-1 px-2 pb-2"
            data-busy={busy || undefined}
          >
            {queuedMessages.length === 0 ? (
              <DeliveryProgressIndicator sessionId={sessionId} />
            ) : null}
            <div
              data-composer-model-controls
              data-usage-guide="model-controls"
              className="composer-toolbar flex min-w-0 flex-1 items-center"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {!hideIdentityControls ? (
                  <MemoModelPicker
                    harness={harness}
                    model={model}
                    values={modelSettings}
                    allowedHarnesses={allowedModelHarnesses}
                    project={cwd}
                    compactIdentity
                    showEffortSummary
                    hotkeys={hotkeys && enabled}
                    openRequest={(modelPickerOpenRequest ?? 0) + modelPickerRequest}
                    closeOnPick={Boolean(usageLimit)}
                    accountId={providerAccountId}
                    accountChoices={Boolean(onSelectProviderAccount)}
                    accessMode={settingsInModelPicker && harness !== "fx" ? runtimeMode : undefined}
                    accessBusy={settingsInModelPicker && busy}
                    onAccessModeChange={onPickerAccessChange}
                    modeControl={settingsInModelPicker ? modeControl : undefined}
                    extrasDisabled={disabled || !onModelSettingsChange}
                    extrasDisabledReason={
                      disabled
                        ? "Settings are locked while this conversation is updating."
                        : onModelSettingsChange
                          ? undefined
                          : "Settings can't be changed here."
                    }
                    onChange={onPickerModelChange}
                    onSettingsChange={onPickerSettingsChange}
                    onClose={onPickerClose}
                  />
                ) : null}
                {/* Chat settings "Extras summary"; the menu stays complete. */}
                {extrasBeside &&
                !hideIdentityControls &&
                !compact &&
                !disabled &&
                onModelSettingsChange ? (
                  <ModelControlPills
                    harness={harness}
                    model={model}
                    values={modelSettings}
                    omitEffort
                    onSettingsChange={onPickerSettingsChange}
                    onClose={onPickerClose}
                  />
                ) : null}
                {!hideIdentityControls && !settingsInModelPicker && !compact && harness !== "fx" ? (
                  <AccessPicker
                    value={runtimeMode}
                    busy={busy}
                    iconOnly
                    unavailable={unavailableRuntimeModes(harness)}
                    onChange={onPickerAccessChange}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                {settingsInModelPicker ? null : modeControl}
                {hideTopBar || hideBranchPicker ? sessionDirectoryPicker : null}
              </div>
            </div>
            {/* Without the context row below, the tip sits with the trailing
                actions instead of adding an extra row inside the writing surface. */}
            {hideTopBar || hideBranchPicker ? <ComposerTips active={focused && !disabled} /> : null}
            <ComposerAddMenu
              open={plusOpen}
              onOpenChange={setPlusOpen}
              className={compact ? "hidden" : undefined}
              usageGuide="composer-plus"
              uploadUnavailable={
                attachmentsSupported
                  ? undefined
                  : remote && !remoteFeatures?.attachments
                    ? t("Update this machine’s host to attach files")
                    : t("{p0} does not support attachments", { p0: HARNESS_TITLE[harness] })
              }
              skillPrefix={remote ? undefined : harness === "codex" ? "$" : "/"}
              onUpload={() => {
                if (canMutateDraft()) attachFromPicker();
              }}
              onSkills={() => {
                if (!canMutateDraft()) return;
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
              }}
            />
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
                shortcut="Esc"
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
                disabledReason={
                  worktreeRemoved
                    ? t("Select a branch or worktree to continue…")
                    : t("Action unavailable.")
                }
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
                sessionId={sessionId}
                projectId={projectKey(cwd)}
                editorRef={ref}
                disabled={disabled}
                onText={(text, final, run) => {
                  if (ref.current && canMutateDraft())
                    insertDictatedText(ref.current, text, final, run);
                }}
                onError={setPasteError}
              />
              <ComposerAction
                busy={busy}
                submitting={submission?.sessionId === sessionId ? submission?.action : null}
                disabled={disabled || workspaceActionBlocked}
                hasValue={hasValue && !worktreeRemoved}
                allowBusySubmit={allowBusySubmit}
                label={draftActive ? t("Save draft") : t("Send")}
                followUpAction={
                  draftActive
                    ? undefined
                    : !steerSupported ||
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
                      ? "queue"
                      : "steer"
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
                    subagentsRunning: localSubagentsRunning,
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
        {!hideTopBar && hideBranchPicker && (machinePicker || projectContextPicker) ? (
          <div
            data-composer-secondary=""
            data-composer-attention={workspaceNeedsAttention ? "" : undefined}
            role="group"
            aria-label={t("Chat workspace")}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 pt-1.5"
          >
            {machinePicker?.(!!submission || busy)}
            {projectContextPicker}
          </div>
        ) : null}
        {!hideTopBar && !hideBranchPicker ? (
          <Text
            as="div"
            size="inherit"
            tone="secondary"
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
              {machinePicker?.(!!submission || busy)}
              {projectContextPicker}
              {hasProject && draftWorkspace && onWorkspaceModeChange && onWorktreeBaseChange ? (
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
                        hideWithoutRepository
                        enabled={enabled && !busy}
                        onChange={
                          onBranchChange
                            ? () => {
                                mutateParentInput(parentChanged, onBranchChange);
                              }
                            : undefined
                        }
                        onSelectWorktree={
                          onWorktreeChange
                            ? async (...args) => {
                                const result = mutateParentInput(parentChanged, () =>
                                  onWorktreeChange(...args),
                                );
                                if (result === false)
                                  throw new Error("Session input is temporarily closed.");
                                await result;
                              }
                            : undefined
                        }
                        onClose={() => ref.current?.focus()}
                      />
                    </div>
                  ) : null}
                </>
              ) : hasProject && worktreeRemoved && onWorktreeChange ? (
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
              ) : hasProject ? (
                <>
                  {onWorktreeChange ? (
                    <WorkspaceIdentity worktree={pathKey(cwd) !== pathKey(executionCwd)} />
                  ) : null}
                  <div className="flex min-w-0 justify-end">
                    <BranchPicker
                      cwd={executionCwd}
                      branch={branch}
                      hideWithoutRepository
                      enabled={enabled && !busy}
                      onChange={
                        onBranchChange
                          ? () => {
                              mutateParentInput(parentChanged, onBranchChange);
                            }
                          : undefined
                      }
                      worktreeLocked
                      onClose={() => ref.current?.focus()}
                    />
                  </div>
                </>
              ) : null}
              {hasProject && sessionDirectoryPicker ? (
                <div data-composer-directories className="flex min-w-0 justify-end">
                  {sessionDirectoryPicker}
                </div>
              ) : null}
            </div>
            <ComposerTips active={focused && !disabled} />
            {hasProject && draftWorkspace ? (
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
          </Text>
        ) : null}
      </div>
    </div>
  );
});

const MemoModelPicker = memo(ModelPicker);
// A stable default keeps the memoized picker from re-rendering on every keystroke.
const NO_MODEL_SETTINGS: Record<string, string> = {};
import { surfaceAttributes } from "../../../shared/ui/Surface";
