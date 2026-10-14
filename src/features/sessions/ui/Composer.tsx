import { useClearComposerDraft } from "../hooks/useClearComposerDraft";
import {
  useComposerTranslationSelection,
  type ComposerTranslationSelection,
} from "../hooks/useComposerTranslationSelection";
import { canOfferTranslation, type TranslationTarget } from "../model/translation";
import {
  translatedSelection,
  translationHistoryKey,
  type TranslationHistory,
} from "../model/translationHistory";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { registerBrowserComposer } from "../../host-tools/browserComposer";
import { registerLogsComposer } from "../../host-tools/logsComposer";
import { releaseAttachments } from "../model/releaseAttachments";
import { t, useLocale } from "../../../shared/i18n";
import { useComposerSpelling } from "../../settings/model/composerSpelling";
import { ComposerTips } from "./ComposerTips";
import "./chat-controls.css";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  ArrowUp,
  AiIdea,
  Check,
  CircleDashed,
  CornerDownRight,
  CursorMagicSelection,
  FilePlus,
  ListEnd,
  Pause,
  Pencil,
  Play,
  Plus,
  Share,
  Square,
  StickyNote,
  Trash2,
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
  type ReactNode,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  attachmentsFromFiles,
  MAX_ATTACHMENTS,
  attachmentsFromPaths,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
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
import { COMPOSER_MAX_HEIGHT, resizeComposer } from "../model/composerResize";
import { createComposerResizeFrame } from "./composerResizeFrame";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../../../shared/lib/drag";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import type { ContextUsage } from "../model/contextUsage";
import type { SessionUsage } from "../model/sessionUsage";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../files/model/fileIndex";
import {
  buildMentionIndex,
  fileMentionParts,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
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
  QueuedMessage,
  UsageLimit,
  RuntimeMode,
  WorkspaceMode,
  ComposerTurnOptions,
} from "../model/session";
import { parseShellCommand } from "../model/shellRun";
import { canSteerHarness } from "../../../integrations/harness/core/registry";
import {
  HARNESS_TITLE,
  harnessSupportsAttachments,
  planUnavailableReason,
  unavailableRuntimeModes,
} from "../model/session";
import { hasMissingAttachment } from "../model/queuePersistence";
import { moveQueuedMessage, resolveFollowUpRoute } from "../model/messageQueue";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
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
import { QuestionForm } from "./QuestionForm";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { SkillPicker } from "../../skills/ui/SkillPicker";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../model/quoteDraft";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  keybindingPressed,
  keybindingShortcutLabel,
  loadNotesEnabled,
  loadFollowUpBehavior,
  subscribeFollowUpBehavior,
  FOLLOW_UP_BEHAVIOR_DEFAULT,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import {
  isNoteMentionPath,
  loadNoteSummaries,
  peekNoteSummaries,
  rankNoteFiles,
  notesAsProjectFiles,
  type NoteSummary,
  type NoteComposerCard,
} from "../../notes";
import { resolveTabGroupLogo } from "../../workspace/model/tabGroups";
import { useCliCommands } from "./useCliCommands";
import { useComposerSkills } from "./useComposerSkills";
import { Popover } from "../../../shared/ui/Popover";
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
import { BTW_COMMAND, consumeBtwCommand, consumeBtwPrefix, supportsBtwHarness } from "../model/btw";
import { COMPACT_COMMAND, isCompactCommand } from "../model/compact";
import { NEW_SESSION_COMMAND, isNewSessionCommand } from "../model/newSessionCommand";
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
  setComposerAttachments,
  setComposerMcpTags,
  takeComposerNotice,
} from "../model/draftCache";
import { type McpConnection } from "../../settings/model/mcp";
import {
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  type McpSettingsSnapshot,
} from "../../settings/model/mcpSettingsCache";
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
import {
  insertTemplateBody,
  loadPromptTemplates,
  subscribePromptTemplates,
  templateSkill,
  templateTriggerAt,
} from "../model/promptTemplates";
import { SessionDirsPicker } from "./SessionDirsPicker";
import { IS_MAC } from "../../../platform/tauri/platform";

type Props = {
  enabled?: boolean;
  focused: boolean;
  /** Bump to force a refocus even when `focused` was already true (e.g. window regains OS focus). */
  focusToken?: number;
  shell?: boolean;
  compact?: boolean;
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
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  /** Routes discovery to the host; local-only app modes remain unavailable. */
  remoteSession?: boolean;
  remoteFeatures?: { attachments: boolean; plan: boolean; draft: boolean; steer?: boolean };
  /** Why Send cannot reach its destination right now; Send stays usable and tries again. */
  sendBlockedReason?: string;
  /** Send is refused while set (another computer is mid-turn on this session). */
  sendHeldReason?: string;
  context?: ContextUsage;
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
  /** Allow typed text to replace Stop with Send while a turn is running. */
  allowBusySubmit?: boolean;
  editLastTurnSupported?: boolean;
  lastTurnRecall?: LastTurnRecall | null;
  /** The session's own messages, newest first, for Up/Down in an empty composer. */
  promptHistory?: () => string[];
  queuedMessages?: QueuedMessage[];
  queueStatus?: MessageQueueStatus;
  usageLimit?: UsageLimit;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onWorktreeChange?: (tree: Worktree) => Promise<void>;
  draftWorkspace?: boolean;
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
  onQuestionInteraction?: (requestId: number) => void;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  /** `draft` opens the side question with the text unsent, for a typed `/btw `. */
  onBtwCommand?: (text: string, options?: { draft?: boolean }) => boolean | void;
  canSaveDraft?: boolean;
  onSaveDraft?: (text: string, attachments: Attachment[]) => boolean | void;
  onStop?: () => void;
  onCompactContext?: () => boolean;
  onNewSession?: () => void;
  onPlaceInFolder?: (target: SessionFolderTarget) => void;
  /** Open the picker of conversations Claude Code stored for this project. */
  onResumeProviderSession?: () => void;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onEditQueuedMessage?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onQueuedMessageEditingChange?: (messageId?: string) => void;
  /** The queue in its new order, as ids; resolved against the live queue by the owner. */
  onReorderQueuedMessages?: (messageIds: string[]) => void;
  onSteerQueuedMessage?: (messageId: string) => void;
  onResumeQueue?: () => void;
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
  onEditingLastTurnChange?: (editing: boolean) => void;
  children?: ReactNode;
};

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md ${
        active
          ? "bg-selection-emphasis text-content"
          : "bg-selection text-content/50 hover:bg-selection-hover hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/50`}
    >
      {children}
    </button>
  );
}

function MessageQueue({
  messages,
  status,
  onDelete,
  canAttach,
  remote = false,
  busy = false,
  steerSupported = false,
  onEdit,
  onEditingChange,
  onReorder,
  onSteer,
  onResume,
}: {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  canAttach: boolean;
  /** The turn runs on another machine: it cannot be steered, and the queue is this app's. */
  remote?: boolean;
  busy?: boolean;
  steerSupported?: boolean;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onEditingChange?: (messageId?: string) => void;
  onReorder?: (messageIds: string[]) => void;
  onSteer?: (messageId: string) => void;
  onResume?: () => void;
}) {
  useLocale();
  const sortable = useAnimatedReorder(
    messages.map((message) => message.id),
    (ids) => onReorder?.(ids),
    "y",
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
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const next = moveQueuedMessage(messages, id, index + (event.key === "ArrowUp" ? -1 : 1));
    if (next === messages) return;
    refocus.current = id;
    onReorder?.(next.map((message) => message.id));
  };
  const [editingId, setEditingId] = useState<string>();
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
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
  if (messages.length === 0) return null;
  const paused = status === "paused";
  const restored = status === "restored";
  const canSend = (message: QueuedMessage) =>
    !hasMissingAttachment(message) &&
    (!busy || (steerSupported && message.intent !== "plan" && message.intent !== "orchestrate"));

  const startEdit = (message: QueuedMessage) => {
    setEditingId(message.id);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    setEditingId(undefined);
    onEditingChange?.();
  };

  return (
    <div className="px-2 text-content/55" data-message-queue data-usage-guide="queue">
      <div
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
        data-message-queue-card
        ref={card}
      >
        {paused ? (
          <div className="flex h-7 items-center gap-2 border-b border-stroke text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {t("Queue paused because you interrupted")}
            </span>
            <button
              type="button"
              onClick={onResume}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              {t("Resume")}
            </button>
          </div>
        ) : null}
        {restored ? (
          <div className="flex h-7 items-center gap-2 border-b border-stroke text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {messages.length === 1
                ? t("1 queued message restored")
                : t("{p0} queued messages restored", { p0: messages.length })}
            </span>
            <button
              type="button"
              disabled={!canSend(messages[0])}
              onClick={() => onSteer?.(messages[0].id)}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content disabled:opacity-30"
            >
              <Play className="size-3.5" />
              {t("Send next")}
            </button>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const attachmentGone = hasMissingAttachment(message);
          const label =
            message.text.trim() ||
            `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
          return (
            <div
              key={message.id}
              ref={(node) => sortable.setItemRef(message.id, node)}
              className={`reorder-item flex min-h-7 items-center gap-2 text-[12px] data-[dragging]:rounded-md data-[dragging]:bg-background-base data-[dragging]:shadow-lg ${
                index > 0 ? "border-t border-stroke" : ""
              }`}
            >
              {messages.length > 1 ? (
                <button
                  type="button"
                  data-queue-handle={message.id}
                  title={t("Drag to reorder")}
                  aria-label={t("Reorder queued message")}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onPointerDown={(event) => sortable.onItemPointerDown(message.id, event)}
                  onKeyDown={(event) => moveByKey(event, message.id, index)}
                  className="grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md hover:bg-content/10 hover:text-content active:cursor-grabbing"
                >
                  <ListEnd className="size-3.5" />
                </button>
              ) : (
                <ListEnd className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-content/80">{label}</span>
              {attachmentGone ? (
                <span
                  className="shrink-0 text-warning"
                  title={t(
                    "An attached file is gone. Edit this message to drop it, or remove the message.",
                  )}
                >
                  {t("Attachment missing")}
                </span>
              ) : null}
              {remote ? null : (
                <button
                  type="button"
                  disabled={!canSend(message)}
                  title={
                    busy && (message.intent === "plan" || message.intent === "orchestrate")
                      ? t("New messages wait until this turn finishes. Stop pauses the queue.")
                      : undefined
                  }
                  onClick={() => onSteer?.(message.id)}
                  className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content disabled:opacity-30"
                >
                  <CornerDownRight className="size-3.5" />
                  {t("Steer")}
                </button>
              )}
              <button
                type="button"
                title={t("Edit queued message")}
                aria-label={t("Edit queued message")}
                onClick={() => startEdit(message)}
                className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("Remove queued message")}
                aria-label={t("Remove queued message")}
                onClick={() => onDelete?.(message.id)}
                className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
        {remote ? (
          <div className="border-t border-stroke py-1 text-[11px] text-content/40">
            {t("Sent one at a time when the host finishes this turn, while {p0} is open.", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
          </div>
        ) : null}
      </div>
      {editingMessage ? (
        <QueuedMessageEditDialog
          key={editingMessage.id}
          message={editingMessage}
          canAttach={canAttach}
          onSave={(text, attachments) => {
            onEdit?.(editingMessage.id, text, attachments);
            setEditingId(undefined);
          }}
          onRemove={() => onDelete?.(editingMessage.id)}
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
  usageLimit,
  onFocus,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  draftWorkspace = false,
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
  onEditingLastTurnChange,
  children,
}: Props) {
  useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const translationContext = useMemo(
    () => ({ cwd: executionCwd, harness, model, modelSettings, providerAccountId }),
    [executionCwd, harness, model, modelSettings, providerAccountId],
  );
  const translationSelection = useComposerTranslationSelection(
    ref,
    !disabled && canOfferTranslation(translationContext),
  );
  const [translationRequest, setTranslationRequest] = useState<{
    selection: ComposerTranslationSelection;
    target: TranslationTarget;
  } | null>(null);
  const translationHistoryRef = useRef<TranslationHistory | null>(null);
  useEffect(() => {
    translationHistoryRef.current = null;
    setTranslationRequest(null);
  }, [sessionId, draftResetToken]);
  const [inputResize] = useState(createComposerResizeFrame);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const accountProvider = supportsProviderAccounts(harness) ? harness : undefined;
  useEffect(() => () => inputResize.cancel(), [inputResize]);
  const boxRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // A remount (or a restart) starts from the attachments the draft was saved with.
  const attachmentsRef = useRef<Attachment[]>(sessionId ? getComposerAttachments(sessionId) : []);
  const borrowedAttachmentIdsRef = useRef(new Set<string>());
  const attachmentLifecycleRef = useRef(0);
  const consumedQuoteId = useRef<number | null>(null);
  const draftRevisionRef = useRef(0);
  const userEditBeforeRef = useRef<string | null>(null);
  const draftResetTokenRef = useRef(draftResetToken);
  /** Bumped when the draft is cleared, so a late paste cannot land on the next one. */
  const pasteGenerationRef = useRef(0);
  /** Pasted and dropped files still reading when Send is pressed. */
  const pasteFlightRef = useRef<Promise<void> | null>(null);
  const submitLockRef = useRef(false);
  const positionedInitialDraft = useRef(false);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  /** Set while the text is an unedited entry recalled with Up/Down. */
  const historyRef = useRef<HistoryBrowse | null>(null);
  const escapeArmedRef = useRef<number | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const clearComposer = useClearComposerDraft(ref, setDraft, onDraftChange);
  // Updating defaultValue rewrites WebKit's text node and commits an active IME.
  // Apply later external drafts through the existing synchronization effect.
  const [mountDraft] = useState(initialDraft);
  const { branches: draftBranches } = useProjectBranchesState(
    executionCwd,
    draftWorkspace && enabled && !busy,
  );
  const resolvedWorktreeBase =
    worktreeBase && worktreeBase !== "HEAD"
      ? worktreeBase
      : branch || draftBranches?.current || worktreeBase || undefined;
  useEffect(() => {
    if (
      draftWorkspace &&
      workspaceMode === "worktree" &&
      worktreeBase === "HEAD" &&
      draftBranches?.current
    ) {
      onWorktreeBaseChange?.(draftBranches.current);
    }
  }, [draftBranches?.current, draftWorkspace, onWorktreeBaseChange, workspaceMode, worktreeBase]);
  const [hasValue, setHasValue] = useState(
    () =>
      (initialDraft ?? "").trim().length > 0 ||
      attachmentsRef.current.length > 0 ||
      !!inboxCard ||
      !!noteCard ||
      !!handoffCard,
  );
  const [attachments, setAttachments] = useState<Attachment[]>(() => attachmentsRef.current);
  // Says so when a restored draft lost an attachment whose file is gone.
  const [pasteError, setPasteError] = useState<string | null>(
    () => (sessionId ? takeComposerNotice(sessionId) : undefined) ?? null,
  );
  const [fileDrag, setFileDrag] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [planSelected, setPlanSelected] = useState(false);
  const [operatorSelected, setOperatorSelected] = useState(false);
  const [orchestrationSelected, setOrchestrationSelected] = useState(false);
  const [draftSelected, setDraftSelected] = useState(false);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillActive, setSkillActive] = useState(0);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [sessionFolderOpen, setSessionFolderOpen] = useState(false);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>([]);
  const [sessionFolderSelected, setSessionFolderSelected] = useState(false);
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Map<string, string>>(new Map());
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [selectedMcp, setSelectedMcp] = useState<McpTag[]>(() =>
    sessionId ? getComposerMcpTags(sessionId) : [],
  );
  const mcpInsertAt = useRef<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const remote = remoteSession;
  // Workspace APIs route remote:// paths to their owning machine.
  const localCwd = executionCwd;
  const [files, setFiles] = useState<ProjectFile[]>(() => peekProjectFiles(localCwd) ?? []);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const spelling = useComposerSpelling();
  const followUpBehavior = useSyncExternalStore(
    subscribeFollowUpBehavior,
    loadFollowUpBehavior,
    () => FOLLOW_UP_BEHAVIOR_DEFAULT,
  );
  const promptTemplates = useSyncExternalStore(
    subscribePromptTemplates,
    loadPromptTemplates,
    () => [],
  );
  const [notes, setNotes] = useState<NoteSummary[]>(() => peekNoteSummaries() ?? []);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [resendEdited, setResendEdited] = useState(false);
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  slashRef.current = slash;
  mentionRef.current = mention;

  attachmentsRef.current = attachments;

  const mentionOpen =
    mention !== null && (looksLikeProject(executionCwd) || (!remote && notesEnabled));
  const tokens = useMemo(() => attachmentTokens(attachments), [attachments]);
  const navigationEmpty =
    draft.length === 0 && attachments.length === 0 && !inboxCard && !noteCard && !handoffCard;
  const skillPickerOpen = creatingSkill || slash !== null;
  const pickerOpen = skillPickerOpen || sessionFolderOpen || mcpPickerOpen;
  const skillCatalog = useComposerSkills({
    harness,
    executionCwd: localCwd,
    sessionId,
    pickerOpen,
  });
  const skills = skillCatalog.skills;
  const templateItems = useMemo(() => promptTemplates.map(templateSkill), [promptTemplates]);
  // The CLI's own commands never replace a Bycoda command or a skill that
  // Bycoda already lists under the same name.
  const takenNames = useMemo(
    () =>
      new Set([
        ...[
          PLAN_COMMAND,
          COMPACT_COMMAND,
          NEW_SESSION_COMMAND,
          SESSION_FOLDER_COMMAND,
          MCP_COMMAND,
          OPERATOR_COMMAND,
          ORCHESTRATOR_COMMAND,
          DRAFT_COMMAND,
          BTW_COMMAND,
          RESUME_COMMAND,
        ].map((command) => command.name),
        "mono",
        "bycoda",
        ...skills.map((skill) => skill.name),
      ]),
    [skills],
  );
  const cliCommands = useCliCommands({
    harness,
    localCwd,
    sessionId,
    menuOpen: pickerOpen,
    taken: takenNames,
    files: skills,
  });
  const slashItems = useMemo(
    () => [
      ...(onNewSession ? [NEW_SESSION_COMMAND] : []),
      ...(remote
        ? [
            ...(remoteFeatures?.plan ? [PLAN_COMMAND] : []),
            COMPACT_COMMAND,
            ...skills.filter(
              (skill) =>
                skill.name !== NEW_SESSION_COMMAND.name &&
                (skill.kind === "file" || skill.kind === "native"),
            ),
            ...cliCommands.slashCommands,
          ]
        : [
            SESSION_FOLDER_COMMAND,
            MCP_COMMAND,
            OPERATOR_COMMAND,
            ...(hideTopBar ? [] : [ORCHESTRATOR_COMMAND]),
            PLAN_COMMAND,
            ...(canSaveDraft && onSaveDraft ? [DRAFT_COMMAND] : []),
            COMPACT_COMMAND,
            ...(supportsBtwHarness(harness) ? [BTW_COMMAND] : []),
            // Reading and replaying stored conversations is written against
            // Claude Code's own on-disk format, so the command only exists
            // where it works.
            ...((harness === "claude" || harness === "codex") && onResumeProviderSession
              ? [RESUME_COMMAND]
              : []),
            ...skills.filter(
              (skill) =>
                ![NEW_SESSION_COMMAND.name, OPERATOR_COMMAND.name, "mono", "bycoda"].includes(
                  skill.name,
                ) &&
                (skill.kind === "native" ||
                  (skill.name !== PLAN_COMMAND.name &&
                    skill.name !== COMPACT_COMMAND.name &&
                    skill.name !== SESSION_FOLDER_COMMAND.name &&
                    skill.name !== MCP_COMMAND.name &&
                    skill.name !== ORCHESTRATOR_COMMAND.name &&
                    skill.name !== DRAFT_COMMAND.name &&
                    skill.name !== RESUME_COMMAND.name &&
                    skill.name !== BTW_COMMAND.name)),
            ),
            ...cliCommands.slashCommands,
          ]),
      ...templateItems,
    ],
    [
      harness,
      templateItems,
      skills,
      cliCommands.slashCommands,
      remote,
      remoteFeatures?.plan,
      hideTopBar,
      canSaveDraft,
      onSaveDraft,
      onResumeProviderSession,
      onNewSession,
    ],
  );
  const skillLimit = hasNativeCommands(harness) ? Number.POSITIVE_INFINITY : undefined;
  const rankedSkills = useMemo(
    () =>
      rankSkills(
        slash?.trigger === "$" ? cliCommands.dollarSkills : slashItems,
        slash?.query ?? "",
        slash?.trigger === "$" ? undefined : skillLimit,
      ),
    [cliCommands.dollarSkills, slash?.trigger, slash?.query, slashItems, skillLimit],
  );
  const sessionDirsHarness =
    harness === "claude" || harness === "codex" || harness === "antigravity";
  const showSessionDirs =
    !remote && !compact && sessionDirsHarness && isLocalProject(cwd ?? executionCwd);
  const attachmentsSupported =
    (!remote || !!remoteFeatures?.attachments) && harnessSupportsAttachments(harness);
  const skillNames = useMemo(
    () =>
      new Set(
        [...slashItems, ...cliCommands.dollarSkills]
          .filter((skill) => skill.kind !== "template")
          .map((skill) => skill.invocation),
      ),
    [slashItems, cliCommands.dollarSkills],
  );
  const leadingMode = leadingModeCommand(draft, skillNames, { shell: true });
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  useLayoutEffect(() => {
    // The indent can rewrap the first line after the input already resized.
    if (ref.current) resizeComposer(ref.current);
  }, [modeIndent]);
  const mentionFiles = useMemo(
    () => (!remote && notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files),
    [files, notes, notesEnabled, remote],
  );
  const mentionIndex = useMemo(() => buildMentionIndex(mentionFiles), [mentionFiles]);
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  mentionIndexRef.current = mentionIndex;
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(files, mention?.query ?? "", recentOpenedFiles(executionCwd))
      : [];
    const noteHits = !remote && notesEnabled ? rankNoteFiles(notes, mention?.query ?? "") : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [...noteHits, ...fileHits.filter((file) => !seen.has(file.path))];
  }, [executionCwd, files, mention?.query, mentionOpen, notes, notesEnabled, remote]);

  const syncHasValue = useCallback(
    (text: string, files: Attachment[]) => {
      setHasValue(
        text.trim().length > 0 || files.length > 0 || !!inboxCard || !!noteCard || !!handoffCard,
      );
    },
    [inboxCard, noteCard, handoffCard],
  );

  // A leading mode command in the text shows the same pill as picking the mode.
  const operatorActive = operatorSelected || leadingMode?.name === OPERATOR_COMMAND.name;
  const orchestrationActive =
    orchestrationSelected || leadingMode?.name === ORCHESTRATOR_COMMAND.name;
  const draftActive = draftSelected || leadingMode?.name === DRAFT_COMMAND.name;
  const planActive = planSelected || leadingMode?.name === PLAN_COMMAND.name;

  /** Turning a mode off also drops its leading command from the text. */
  const clearLeadingMode = (name: string) => {
    const el = ref.current;
    if (!el || leadingModeCommand(el.value, skillNames)?.name !== name) return;
    const next = el.value.replace(/^\/[a-z]+\s?/, "");
    el.value = next;
    resizeComposer(el);
    el.setSelectionRange(0, 0);
    setDraft(next);
    onDraftChange?.(next);
    syncHasValue(next, attachmentsRef.current);
  };

  const openMcpPicker = useCallback(() => {
    setMcpConnections([]);
    setMcpStatus(new Map());
    setMcpError("");
    setMcpLoading(true);
    setMcpPickerOpen(true);
  }, []);

  useEffect(() => {
    if (!mcpPickerOpen) return;
    const apply = (snapshot: McpSettingsSnapshot) => {
      setMcpConnections(snapshot.servers);
      setMcpStatus(
        new Map(
          snapshot.servers
            .filter((server) => server.provider === "claude")
            .map((server) => [server.name, server.status]),
        ),
      );
      setMcpError(snapshot.error);
      setMcpLoading(false);
    };
    const stop = subscribeMcpSettings(executionCwd, apply);
    const cached = getCachedMcpSettings(executionCwd);
    if (cached) apply(cached);
    void loadMcpSettings(executionCwd, false, {
      claudeHealth: harness === "claude",
    });
    return stop;
  }, [executionCwd, harness, mcpPickerOpen]);

  useEffect(() => {
    setMcpPickerOpen(false);
  }, [executionCwd, harness, sessionId]);

  useEffect(() => {
    if (sessionId) setComposerMcpTags(sessionId, selectedMcp);
  }, [sessionId, selectedMcp]);

  useEffect(() => {
    // Object URLs die with this pane, so the saved copy keeps none.
    if (sessionId) {
      setComposerAttachments(
        sessionId,
        attachments.map(({ previewUrl: _preview, ...file }) => file),
      );
    }
  }, [sessionId, attachments]);

  useEffect(() => {
    syncHasValue(ref.current?.value ?? "", attachmentsRef.current);
  }, [inboxCard, noteCard, handoffCard, syncHasValue]);

  /** Text goes at the caret when the input has focus, otherwise at the end. */
  const insertIntoDraft = useCallback((insertion: string) => {
    const el = ref.current;
    if (!el || !insertion) return;
    const focused = document.activeElement === el;
    const edit = insertAtSelection(
      el.value,
      focused ? { start: el.selectionStart, end: el.selectionEnd } : null,
      insertion,
    );
    applyTextareaEdit(el, edit.text, edit.caret);
  }, []);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!harnessSupportsAttachments(harness) || incoming.length === 0) return;
      const previous = attachmentsRef.current;
      const next = mergeAttachments(previous, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      setPasteError(null);
      draftRevisionRef.current += 1;
      // Skipped duplicates are not in `next`, so they get no token either.
      insertIntoDraft(tokensForIncoming(previous, next.slice(previous.length)));
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [harness, insertIntoDraft, syncHasValue],
  );

  useEffect(() => {
    if (!sessionId || !cwd || disabled) return;
    return registerBrowserComposer(cwd, sessionId, (file) => {
      if (!attachmentsSupported || attachmentsRef.current.length >= MAX_ATTACHMENTS) return false;
      addAttachments([file]);
      return attachmentsRef.current.some((entry) => entry.id === file.id);
    });
  }, [cwd, sessionId, disabled, attachmentsSupported, addAttachments]);

  useEffect(() => {
    if (!sessionId || !cwd || disabled) return;
    return registerLogsComposer(cwd, sessionId, (text) => {
      if (!ref.current || !text) return false;
      draftRevisionRef.current += 1;
      const next = `${ref.current.value}${ref.current.value ? "\n\n" : ""}${text}`;
      applyTextareaEdit(ref.current, next, next.length);
      syncHasValue(ref.current.value, attachmentsRef.current);
      ref.current.focus();
      return true;
    });
  }, [cwd, sessionId, disabled, syncHasValue]);

  const insertAttachmentToken = useCallback(
    (id: string) => {
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
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue],
  );
  // IPC listener registration is asynchronous; changing providers must not
  // detach it or leave it reading obsolete capabilities and callbacks.
  const fileDropStateRef = useRef({
    attachmentsSupported,
    remote,
    addAttachments,
  });
  fileDropStateRef.current = { attachmentsSupported, remote, addAttachments };

  const rememberAttachmentRead = useCallback((work: Promise<void>) => {
    const flight = work.then(
      () => undefined,
      () => undefined,
    );
    const previous = pasteFlightRef.current;
    const joined = previous ? previous.then(() => flight) : flight;
    pasteFlightRef.current = joined;
    void joined.finally(() => {
      if (pasteFlightRef.current === joined) pasteFlightRef.current = null;
    });
  }, []);

  const readDroppedAttachments = useCallback(
    (read: () => Promise<Attachment[]>) => {
      const generation = pasteGenerationRef.current;
      setPasteError(null);
      rememberAttachmentRead(
        Promise.resolve()
          .then(read)
          .then((incoming) => {
            if (
              pasteGenerationRef.current !== generation ||
              !fileDropStateRef.current.attachmentsSupported
            ) {
              incoming.forEach(revokeAttachment);
              return;
            }
            if (incoming.length === 0) {
              setPasteError(
                "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
              );
              return;
            }
            fileDropStateRef.current.addAttachments(incoming);
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(reason instanceof Error ? reason.message : String(reason));
          }),
      );
    },
    [rememberAttachmentRead],
  );

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

  useEffect(() => {
    const lifecycle = ++attachmentLifecycleRef.current;
    return () => {
      queueMicrotask(() => {
        if (attachmentLifecycleRef.current !== lifecycle) return;
        pasteGenerationRef.current += 1;
        releaseAttachments(attachmentsRef.current, borrowedAttachmentIdsRef.current);
        attachmentsRef.current = [];
        borrowedAttachmentIdsRef.current.clear();
      });
    };
  }, []);

  useEffect(() => {
    if (harnessSupportsAttachments(harness)) return;
    const previous = attachmentsRef.current;
    if (previous.length === 0) return;
    releaseAttachments(previous, borrowedAttachmentIdsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    syncHasValue(ref.current?.value ?? "", []);
  }, [harness, syncHasValue]);
  useEffect(() => {
    setSkillActive(0);
  }, [slash?.query, cwd]);

  useEffect(() => {
    setSessionFolderOpen(false);
    setSessionFolderSelected(false);
  }, [cwd]);

  useEffect(() => {
    setSkillActive((index) =>
      rankedSkills.length === 0 ? 0 : Math.min(index, rankedSkills.length - 1),
    );
  }, [rankedSkills.length]);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: ProjectFile[]) => {
      if (!cancelled) setFiles(next);
    };
    const cached = peekProjectFiles(localCwd);
    apply(cached ?? []);
    if (!localCwd) return;
    void loadProjectFiles(localCwd, mentionOpen && !remote)
      .then(apply)
      .catch((error) => {
        console.warn("Composer operation failed", error);
      });
    const unsub = subscribeProjectFiles(() => {
      const next = peekProjectFiles(localCwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [localCwd, mentionOpen, remote]);

  useEffect(() => {
    if (remote || !mentionOpen || !notesEnabled) return;
    let cancelled = false;
    void loadNoteSummaries()
      .then((next) => {
        if (!cancelled) setNotes(next);
      })
      .catch((error) => console.warn("Loading composer notes failed", error));
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, notesEnabled, remote]);

  useEffect(() => {
    setMentionActive(0);
  }, [mention?.query, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    if (el.value !== initialDraft) el.value = initialDraft;
    if (!positionedInitialDraft.current) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      positionedInitialDraft.current = true;
    }
    resizeComposer(el);
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
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  useEffect(() => {
    if (draftResetToken == null || draftResetTokenRef.current === draftResetToken) {
      return;
    }
    draftResetTokenRef.current = draftResetToken;
    pasteGenerationRef.current += 1;
    draftRevisionRef.current += 1;
    clearComposer();
    setDraftSelected(false);
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasValue("", attachmentsRef.current);
  }, [draftResetToken, clearComposer, syncHasValue]);

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
      token ??
        (dollar && rankSkills(cliCommands.dollarSkills, dollar.query, 1).length > 0
          ? dollar
          : null),
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

    const result = consumeQuoteRequest(el.value, consumedQuoteId.current, quoteRequest);
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      el.value = result.draft;
      resizeComposer(el);
      setDraft(result.draft);
      syncHasValue(result.draft, attachmentsRef.current);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(result.draft.length, result.draft.length);
      el.focus();
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [onQuoteRequestConsumed, quoteRequest, syncHasValue]);

  // `/btw ` opens the side conversation as soon as it is typed, carrying any
  // text after it over as the unsent side question.
  const enterBtwFromPrefix = useCallback(
    (el: HTMLTextAreaElement) => {
      if (!onBtwCommand || inboxCard || noteCard || handoffCard) return false;
      if (attachmentsRef.current.length > 0) return false;
      const rest = consumeBtwPrefix(el.value);
      if (rest == null || onBtwCommand(rest, { draft: true }) === false) {
        return false;
      }
      el.value = "";
      resizeComposer(el);
      draftRevisionRef.current += 1;
      setDraft("");
      onDraftChange?.("");
      syncHasValue("", attachmentsRef.current);
      setSlash(null);
      setMention(null);
      return true;
    },
    [handoffCard, inboxCard, noteCard, onBtwCommand, onDraftChange, syncHasValue],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
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
        onDraftChange?.(next);
        syncHasValue(next, attachmentsRef.current);
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
        syncHasValue(next, attachmentsRef.current);
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
        onDraftChange?.(cleared);
        syncHasValue(cleared, attachmentsRef.current);
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
      syncHasValue(next, attachmentsRef.current);
      setSlash(null);
      setCreatingSkill(false);
      if (skill.kind === "builtin" && skill.name === BTW_COMMAND.name) {
        enterBtwFromPrefix(el);
      }
      el.focus();
    },
    [
      enterBtwFromPrefix,
      onDraftChange,
      onPlaceInFolder,
      openMcpPicker,
      onResumeProviderSession,
      openSessionFolderPicker,
      syncHasValue,
    ],
  );

  const pickMention = useCallback(
    (file: ProjectFile) => {
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
      syncHasValue(next, attachmentsRef.current);
      setMention(null);
      el.focus();
    },
    [syncHasValue, remote],
  );

  useEffect(() => {
    if (!focused || disabled) return;

    const composer = ref.current?.closest("[data-composer]");
    const activeComposer = document.activeElement?.closest("[data-composer]");
    const activeComposerHidden = activeComposer?.closest('[aria-hidden="true"], [inert]');
    // Inactive workspace tabs stay mounted, so focus can still be sitting in
    // their composer when a new session becomes active. Only preserve focus
    // for another composer that is still visible (for example, a split pane).
    if (activeComposer && activeComposer !== composer && !activeComposerHidden) return;

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

  useEffect(() => {
    if (!enabled || disabled) {
      setFileDrag(false);
      return;
    }
    const dropRoot = () => boxRef.current?.closest("[data-session-drop]") as HTMLElement | null;
    let nativeDropAt = 0;

    const overTarget = (x: number, y: number) => {
      const root = dropRoot();
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const onDragOver = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      const supported = fileDropStateRef.current.attachmentsSupported;
      data.dropEffect = supported ? "copy" : "none";
      setFileDrag(supported);
    };
    const onDragLeave = (event: DragEvent) => {
      const root = dropRoot();
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      setFileDrag(false);
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      setFileDrag(false);
      if (!fileDropStateRef.current.attachmentsSupported) return;
      if (Date.now() - nativeDropAt < 250) return;
      const files = filesFromClipboard(data);
      if (files.length === 0) return;
      readDroppedAttachments(() => attachmentsFromFiles(files));
    };

    const onExplorerFilePointerDrag = (event: Event) => {
      if (fileDropStateRef.current.remote) return;
      const detail = (event as CustomEvent<ExplorerFilePointerDragDetail>).detail;
      if (!detail || detail.type === "end") {
        setFileDrag(false);
        return;
      }
      const over = overTarget(detail.x, detail.y);
      const supported = fileDropStateRef.current.attachmentsSupported;
      if (detail.type === "move") {
        setFileDrag(over && supported);
        return;
      }
      setFileDrag(false);
      if (!over || !supported) return;
      readDroppedAttachments(() => attachmentsFromPaths(detail.paths ?? [detail.path]));
    };

    const root = dropRoot();
    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);
    window.addEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "leave") {
          setFileDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const point = dragPointToClient(x, y);
        const over = overTarget(point.x, point.y);
        const supported = fileDropStateRef.current.attachmentsSupported;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setFileDrag(over && supported);
          return;
        }
        if (event.payload.type !== "drop") return;
        setFileDrag(false);
        if (!over || !supported) return;
        if (event.payload.paths.length === 0) {
          setPasteError(
            "This drag did not provide a file. Save the image, then drag the saved file here.",
          );
          return;
        }
        nativeDropAt = Date.now();
        const paths = event.payload.paths;
        readDroppedAttachments(() => attachmentsFromPaths(paths));
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        console.warn("Composer operation failed", error);
      });

    return () => {
      cancelled = true;
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
      window.removeEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);
      unlisten?.();
    };
  }, [disabled, enabled, readDroppedAttachments]);
  useEffect(() => {
    if (!attachmentsSupported) {
      pasteGenerationRef.current += 1;
      setFileDrag(false);
    }
  }, [attachmentsSupported]);
  const restoreDraft = useCallback(
    (
      text: string,
      nextAttachments: Attachment[],
      borrowedIds: ReadonlySet<string> = borrowedAttachmentIdsRef.current,
    ) => {
      setDraft(text);
      onDraftChange?.(text);
      if (ref.current) {
        ref.current.value = text;
        ref.current.style.height = "auto";
        ref.current.style.height = `${Math.min(ref.current.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
      }

      const nextIds = new Set(nextAttachments.map((file) => file.id));
      releaseAttachments(attachmentsRef.current, borrowedAttachmentIdsRef.current, nextIds);
      borrowedAttachmentIdsRef.current = new Set(
        nextAttachments.filter((file) => borrowedIds.has(file.id)).map((file) => file.id),
      );
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
      syncHasValue(text, nextAttachments);
      ref.current?.focus();
    },
    [onDraftChange, syncHasValue],
  );

  const exitEditMode = useCallback(() => {
    draftRevisionRef.current += 1;
    pasteGenerationRef.current += 1;
    clearComposer();
    const previous = attachmentsRef.current;
    releaseAttachments(previous, borrowedAttachmentIdsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    syncHasValue("", []);
    ref.current?.focus();
  }, [clearComposer, onEditingLastTurnChange, syncHasValue]);

  const recallLastTurn = useCallback(() => {
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
    onEditingLastTurnChange?.(true);
  }, [
    editLastTurnSupported,
    onRecallLastTurn,
    exitEditMode,
    lastTurnRecall,
    onEditingLastTurnChange,
    resendEdited,
    restoreDraft,
  ]);

  const recallMessage = useCallback(
    (value: LastTurnRecall) => {
      restoreDraft(
        value.text,
        value.attachments,
        new Set(value.attachments.map((file) => file.id)),
      );
      setResendEdited(false);
      onEditingLastTurnChange?.(false);
    },
    [onEditingLastTurnChange, restoreDraft],
  );

  const appliedRecallIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recalledMessage || appliedRecallIdRef.current === recalledMessage.id) return;
    appliedRecallIdRef.current = recalledMessage.id;
    recallMessage(recalledMessage.value);
    onRecalledMessageApplied?.(recalledMessage.id);
  }, [onRecalledMessageApplied, recallMessage, recalledMessage]);

  useEffect(() => {
    if (onRecallMessageReady) onRecallMessageReady(recallMessage);
  }, [onRecallMessageReady, recallMessage]);

  useEffect(() => {
    draftRevisionRef.current += 1;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [sessionId, onEditingLastTurnChange]);

  useEffect(() => {
    historyRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (editLastTurnSupported) return;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [editLastTurnSupported, onEditingLastTurnChange]);

  useEffect(() => {
    if (!editLastTurnSupported || !onRecallLastTurnReady) return;
    onRecallLastTurnReady(recallLastTurn);
  }, [editLastTurnSupported, onRecallLastTurnReady, recallLastTurn]);

  const submit = (value: string, queue = false) => {
    if (disabled || worktreeRemoved || sendHeldReason || submitLockRef.current) return;
    submitLockRef.current = true;
    void completeSubmit(value, queue).finally(() => {
      submitLockRef.current = false;
    });
  };
  const completeSubmit = async (submittedValue: string, queue = false) => {
    let pending = pasteFlightRef.current;
    const generation = pasteGenerationRef.current;
    while (pending) {
      await pending;
      // A reset or an earlier send retired this draft while the read was out.
      if (pasteGenerationRef.current !== generation) return;
      pending = pasteFlightRef.current;
    }
    const value = ref.current?.value ?? submittedValue;
    if (disabled || worktreeRemoved || sendHeldReason) return;
    if (isNewSessionCommand(value) && onNewSession) {
      // Retain attachments and context cards in the old session. Clear only
      // the navigation command before switching tabs so it cannot reappear.
      if (ref.current) ref.current.value = "";
      setDraft("");
      onDraftChange?.("");
      setSlash(null);
      syncHasValue("", attachmentsRef.current);
      onNewSession();
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
      setSlash(null);
      setMention(null);
      syncHasValue("", attachmentsRef.current);
      onResumeProviderSession();
      return;
    }
    if (isMcpCommand(value)) {
      mcpInsertAt.current = 0;
      clearComposer();
      setSlash(null);
      syncHasValue("", attachments);
      openMcpPicker();
      return;
    }
    const draftCommand = canSaveDraft
      ? consumeDraftCommand(value)
      : { text: value, matched: false };
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = draftCommand.text;
      if (!text.trim() && files.length === 0) return;
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
      );
      if (accepted === false || !ref.current) return;
      pasteGenerationRef.current += 1;
      clearComposer();
      setAttachments([]);
      setDraftSelected(false);
      setSelectedMcp([]);
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
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
      const accepted = onBtwCommand(btwCommand.text);
      if (accepted === false) return;
      pasteGenerationRef.current += 1;
      clearComposer();
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
      return;
    }
    if (folderCommand.matched && onPlaceInFolder && !sessionFolderSelected) {
      openSessionFolderPicker();
      return;
    }

    if (isCompactCommand(value)) {
      if (!onCompactContext?.()) return;
      if (!ref.current) return;
      pasteGenerationRef.current += 1;
      clearComposer();
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachmentsRef.current);
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
    const submittedText =
      operatorSelected && !consumeOperatorCommand(text).matched ? `/operator ${text}` : text;
    const files = attachmentsRef.current;
    if (!text && files.length === 0 && !noteCard && !handoffCard) return;
    // `!command` runs in the shell: it goes out exactly as typed, with none of
    // the context a prompt would carry.
    const shellLine =
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
    onDraftChange?.("");
    const accepted = onSubmit(
      shellLine
        ? value.trim()
        : mcpContextText(taggedMcpServers(submittedText, selectedMcp), submittedText),
      files,
      {
        ...(queue ? { followUpBehavior: "queue" as const } : {}),
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
          // Only into an empty composer: never over what was typed since.
          if (!ref.current || ref.current.value || attachmentsRef.current.length) return false;
          restoreDraft(text, files, resendBorrowedAttachmentIds);
          setSelectedMcp(resendSelectedMcp);
          setPlanSelected(planSelected || command.planning);
          setOperatorSelected(operatorSelected);
          setOrchestrationSelected(orchestrationSelected || orchestratorCommand.matched);
          return true;
        },
        ...(resendEdited
          ? {
              resendEdited: true,
              onResendRejected: ({ providerRewound }) => {
                if (draftRevisionRef.current !== resendDraftRevision) return;
                restoreDraft(text, files, resendBorrowedAttachmentIds);
                setSelectedMcp(resendSelectedMcp);
                setResendEdited(!providerRewound);
                onEditingLastTurnChange?.(!providerRewound);
              },
            }
          : {}),
      },
    );
    // The app can reject a turn before it is recorded (for example while an
    // orchestration is paused). Keep the user's text, files and selected mode
    // intact so resolving the blocker never destroys their work.
    if (accepted === false) {
      restoreDraft(text, files);
      return;
    }
    pasteGenerationRef.current += 1;
    historyRef.current = null;
    clearComposer();
    borrowedAttachmentIdsRef.current.clear();
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedMcp([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlanSelected(false);
    setOperatorSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    setPasteError(null);
    syncHasValue("", []);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (isImeComposition(e.nativeEvent)) return;
    if (creatingSkill) return;
    if (
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !(slash || mentionOpen || pickerOpen)
    ) {
      const version = translationHistoryKey(
        translationHistoryRef.current,
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
      (isCompactCommand(e.currentTarget.value) ||
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
        onStop();
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
          text: e.currentTarget.value,
          attachmentCount: attachmentsRef.current.length,
        })
      ) {
        submit(e.currentTarget.value, true);
      }
      return;
    }

    if (
      e.key === "ArrowUp" &&
      editLastTurnSupported &&
      navigationEmpty &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      recallLastTurn();
      return;
    }

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
    const next = (workspaceMode ?? "current") === "current" ? "worktree" : "current";
    if (next === "worktree" && !resolvedWorktreeBase) return;
    onWorkspaceModeChange(next, next === "worktree" ? resolvedWorktreeBase : undefined);
    ref.current?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    setPasteError(null);
    const messageFiles = messageFilesFromClipboard(e.clipboardData);
    if (messageFiles) {
      e.preventDefault();
      const generation = pasteGenerationRef.current;
      const captured = captureDraft(e.currentTarget);
      const text = e.clipboardData.getData("text/plain");
      if (captured) insertRestoredText(captured, text);
      if (!attachmentsSupported) return;
      rememberAttachmentRead(
        attachmentsFromFiles(messageFiles).then((pasted) => {
          if (pasteGenerationRef.current !== generation) {
            pasted.forEach(revokeAttachment);
            return;
          }
          addAttachments(pasted);
        }),
      );
      return;
    }
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) {
      // A webview reports a paste as text only, so a screenshot or a file
      // copied in a file manager arrives with nothing to attach; both live on
      // the native clipboard.
      if (!attachmentsSupported) return;
      const text = e.clipboardData.getData("text/plain");
      // Prose and whitespace alike are the webview's to insert.
      if (text && !isFileReferenceText(text)) return;
      // A file URI becomes a chip, so it is kept out of the draft; with no text
      // at all the paste carried an image the webview cannot see.
      e.preventDefault();
      // Captured before the read crosses an IPC hop. Send and draft reset bump
      // the generation, so a finished read cannot attach onto a draft that is gone.
      const generation = pasteGenerationRef.current;
      const captured = isFileReferenceText(text) ? captureDraft(e.currentTarget) : null;
      rememberAttachmentRead(
        nativeClipboardAttachments(text)
          .then(({ files: pasted, warning }) => {
            if (pasteGenerationRef.current !== generation) {
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
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(reason instanceof Error ? reason.message : String(reason));
          }),
      );
      return;
    }
    e.preventDefault();
    if (!attachmentsSupported) return;
    const generation = pasteGenerationRef.current;
    rememberAttachmentRead(
      attachmentsFromFiles(files).then((pasted) => {
        if (pasteGenerationRef.current !== generation) {
          pasted.forEach(revokeAttachment);
          return;
        }
        addAttachments(pasted);
      }),
    );
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported) return;
    void pickAttachments()
      .then((files) => {
        addAttachments(files);
        ref.current?.focus();
      })
      .catch((error) => console.warn("Picking attachments failed", error));
  };

  return (
    <div
      data-composer
      data-usage-guide="composer"
      data-usage-guide-active={hotkeys ? "true" : undefined}
      className={`relative shrink-0 ${shell || compact ? "" : "p-1.5 pt-0"}`}
      onMouseDown={disabled ? undefined : onFocus}
      onKeyDownCapture={disabled ? undefined : onComposerKeyDown}
    >
      {question && onQuestionReply ? (
        <QuestionForm
          prompt={question}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      ) : null}
      {children}
      <TranscriptSelectionMenu
        selection={translationSelection.selection}
        onDismiss={translationSelection.dismissSelection}
        onTranslate={(target) => {
          const selection = translationSelection.selection;
          if (selection) setTranslationRequest({ selection, target });
        }}
      />
      {translationRequest ? (
        <TranslationResultDialog
          text={translationRequest.selection.text}
          target={translationRequest.target}
          context={translationContext}
          onClose={() => setTranslationRequest(null)}
          onApply={(translation) => {
            const el = ref.current;
            const selected = translationRequest.selection;
            if (!el || el.value !== selected.value) throw new Error("Draft changed");
            const history = translatedSelection(
              selected.value,
              selected.start,
              selected.end,
              translation,
            );
            translationHistoryRef.current = history;
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
          onResume={onUsageLimitResume}
          onResumeAtReset={onUsageLimitResumeAtReset}
          onSwitchAccount={
            accountProvider && onSelectProviderAccount
              ? (accountId) => onSelectProviderAccount(accountProvider, accountId)
              : undefined
          }
          onSwitchModel={() => setModelPickerRequest((count) => count + 1)}
          onDismiss={onUsageLimitDismiss}
        />
      ) : null}
      <MessageQueue
        messages={queuedMessages}
        status={queueStatus}
        canAttach={attachmentsSupported}
        remote={remote && !remoteFeatures?.steer}
        busy={busy}
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
              connections={mcpConnections}
              harness={harness}
              claudeStatus={mcpStatus}
              loading={mcpLoading}
              error={mcpError}
              onPick={(server) => {
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
                  syncHasValue(next, attachmentsRef.current);
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
                  syncHasValue(el.value, attachmentsRef.current);
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
                setCreateBusy(true);
                setCreateError(null);
                void createBlankSkill({ cwd: executionCwd, name, scope })
                  .then((path) => {
                    const el = ref.current;
                    const token = slashRef.current;
                    if (el && token) {
                      const rest = el.value.slice(token.end).replace(/^\s/, "");
                      const next = `${el.value.slice(0, token.start)}${rest}`;
                      el.value = next;
                      resizeComposer(el);
                      el.setSelectionRange(token.start, token.start);
                      setDraft(next);
                      syncHasValue(next, attachments);
                    }
                    setCreatingSkill(false);
                    setSlash(null);
                    setCreateError(null);
                    void skillCatalog.refresh({ refresh: true }).catch((error) => {
                      console.warn("Composer operation failed", error);
                    });
                    onOpenFile?.(path);
                    el?.focus();
                  })
                  .catch((err: unknown) => {
                    setCreateError(err instanceof Error ? err.message : String(err));
                  })
                  .finally(() => setCreateBusy(false));
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
          data-composer-editing={resendEdited ? "" : undefined}
          className={`relative z-10 border bg-content/3 backdrop-blur-sm ${
            resendEdited
              ? "edit-last-turn-composer rounded-lg"
              : "rounded-lg border-content/10 has-focus:border-content/20"
          } ${
            fileDrag
              ? "border-accent/60"
              : resendEdited
                ? ""
                : "border-content/10 has-focus:border-content/20"
          }`}
        >
          {fileDrag ? (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent/8 text-[12px] text-content/70">
              {t("Drop files to attach")}
            </div>
          ) : null}
          {hideTopBar ? null : (
            <div
              data-composer-context
              className="flex min-w-0 flex-wrap items-center justify-between gap-2.5 px-3 pt-2.5"
            >
              {!remote && !hideProjectPicker ? (
                <CwdPicker
                  cwd={cwd}
                  recents={recents}
                  projectLogoPath={projectLogoPath}
                  enabled={enabled}
                  onCwdChange={onCwdChange}
                  onNewTerminal={worktreeRemoved ? undefined : onNewTerminal}
                  onClose={() => ref.current?.focus()}
                />
              ) : null}
              <div className="composer-context-actions flex shrink-0 items-center">
                <ContextMeter
                  usage={context}
                  empty={contextEmpty}
                  sessionUsage={sessionUsage}
                  onCompact={compactSupported && !worktreeRemoved ? onCompactContext : undefined}
                  compactDisabled={busy}
                />
              </div>
            </div>
          )}

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
            <p role="alert" className="px-3 pt-2 text-xs text-danger">
              {pasteError}
            </p>
          ) : null}

          {inboxCard ? <InboxMiniCard card={inboxCard} onDismiss={onInboxCardDismiss} /> : null}

          {noteCard ? <NoteMiniCard card={noteCard} onDismiss={onNoteCardDismiss} /> : null}

          {handoffCard ? (
            <HandoffMiniCard card={handoffCard} onDismiss={onHandoffCardDismiss} />
          ) : null}

          <div className="relative">
            <div
              ref={highlightRef}
              aria-hidden
              style={{ textIndent: modeIndent }}
              className={`composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap wrap-break-word px-3 text-sm leading-5.5 text-content font-sans ${
                shell ? "py-4" : "py-3"
              }`}
            >
              <ComposerHighlight
                text={draft}
                mode={leadingMode}
                names={skillNames}
                mentions={mentionIndex.labels}
                mcpTags={selectedMcp}
              />
            </div>
            <textarea
              ref={ref}
              data-composer-empty={navigationEmpty ? "true" : undefined}
              style={{ textIndent: modeIndent }}
              rows={1}
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
              className={`composer-field scrollbar-none relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-transparent px-3 text-sm leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
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
                const el = e.currentTarget;
                const history = translationHistoryRef.current;
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
                syncHasValue(el.value, attachmentsRef.current);
                syncTokensFromTextarea(el);
              }}
            />
          </div>

          {hideTopBar || hideBranchPicker ? (
            <div className="composer-session-meta">
              <ComposerTips active={focused && !disabled} />
            </div>
          ) : null}
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
                  onChange={onModelChange}
                  onSettingsChange={(settings) => onModelSettingsChange?.(settings)}
                  onClose={() => ref.current?.focus()}
                />
                {!compact && harness !== "fx" ? (
                  <AccessPicker
                    value={runtimeMode}
                    busy={busy}
                    unavailable={unavailableRuntimeModes(harness)}
                    onChange={onRuntimeModeChange}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                {showSessionDirs && sessionId ? (
                  <SessionDirsPicker
                    sessionId={sessionId}
                    project={cwd ?? executionCwd}
                    workingDirectory={executionCwd}
                    recents={recents}
                    onProjectChange={hideProjectPicker || hideTopBar ? undefined : onCwdChange}
                    enabled={enabled}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
              </div>
            </div>
            <div ref={plusRef} className={compact ? "hidden" : "relative shrink-0"}>
              <ToolButton
                label={t("Add files or choose a mode")}
                active={plusOpen}
                onClick={() => setPlusOpen((open) => !open)}
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
              </ToolButton>
              {plusOpen ? (
                <Popover
                  anchor={plusRef}
                  side="top"
                  align="start"
                  width={250}
                  onDismiss={() => setPlusOpen(false)}
                  data-composer-plus
                  className="p-1.5"
                >
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-content/40">
                    {t("Add to message")}
                  </p>
                  <button
                    type="button"
                    disabled={!attachmentsSupported}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPlusOpen(false);
                      attachFromPicker();
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FilePlus className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px]">{t("Upload file")}</span>
                      <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                        {attachmentsSupported
                          ? t("Attach files or images")
                          : remote && !remoteFeatures?.attachments
                            ? t("Update this machine’s host to attach files")
                            : t("{p0} does not support attachments", {
                                p0: HARNESS_TITLE[harness],
                              })}
                      </span>
                    </span>
                  </button>
                  {!remote ? (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const el = ref.current;
                        if (!el) return;
                        const prefix = harness === "codex" ? "$" : "/";
                        const lead = el.value && !/\s$/.test(el.value) ? " " : "";
                        const start = el.value.length + lead.length;
                        const next = `${el.value}${lead}${prefix}`;
                        el.value = next;
                        el.setSelectionRange(next.length, next.length);
                        resizeComposer(el);
                        setDraft(next);
                        syncHasValue(next, attachmentsRef.current);
                        setSlash({
                          start,
                          end: next.length,
                          query: "",
                          ...(prefix === "$" ? { trigger: "$" as const } : {}),
                        });
                        setSkillActive(0);
                        setPlusOpen(false);
                        el.focus();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <CursorMagicSelection className="mt-0.5 size-4 shrink-0 text-content/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{t("Skills")}</span>
                        <span className="block text-[11px] leading-4 text-content/45">
                          {harness === "codex"
                            ? t("Choose a skill or type $name")
                            : t("Choose a skill or type /name")}
                        </span>
                      </span>
                    </button>
                  ) : null}
                  {!remote || remoteFeatures?.plan ? (
                    <button
                      type="button"
                      aria-pressed={planActive}
                      disabled={!!planUnavailableReason(harness)}
                      title={planUnavailableReason(harness)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPlanSelected(!planActive);
                        if (planActive) clearLeadingMode(PLAN_COMMAND.name);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <AiIdea className="mt-0.5 size-4 shrink-0 text-warning/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{t("Plan mode")}</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {planUnavailableReason(harness)
                            ? t("Unavailable: {p0}", { p0: planUnavailableReason(harness) })
                            : t("Review a plan before building")}
                        </span>
                      </span>
                      {planActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  ) : null}
                  {!remote ? (
                    <button
                      type="button"
                      aria-pressed={operatorActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOperatorSelected(!operatorActive);
                        if (operatorActive) {
                          clearLeadingMode(OPERATOR_COMMAND.name);
                        }
                        setPlanSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <CursorMagicSelection className="mt-0.5 size-4 shrink-0 text-info/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{t("Operator")}</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {t("Give this thread access to")} {PRODUCT_IDENTITY.displayName}
                        </span>
                      </span>
                      {operatorActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-info/80" />
                      ) : null}
                    </button>
                  ) : null}
                  {!remote && !hideTopBar && (
                    <button
                      type="button"
                      aria-pressed={orchestrationActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOrchestrationSelected(!orchestrationActive);
                        if (orchestrationActive) {
                          clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                        }
                        setPlanSelected(false);
                        setOperatorSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <Share className="mt-0.5 size-4 shrink-0 text-orchestration/65" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px]">{t("Orchestrator")}</span>
                          <span className="rounded-full bg-orchestration/10 px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-wide text-orchestration/55 mb-px">
                            v1
                          </span>
                        </span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {t("Plan and coordinate agent work")}
                        </span>
                      </span>
                      {orchestrationActive && (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-orchestration/80" />
                      )}
                    </button>
                  )}
                  {canSaveDraft && onSaveDraft ? (
                    <button
                      type="button"
                      aria-pressed={draftActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDraftSelected(!draftActive);
                        if (draftActive) clearLeadingMode(DRAFT_COMMAND.name);
                        setPlanSelected(false);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-content/60" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{t("Draft")}</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {t("Save this message without starting the agent")}
                        </span>
                      </span>
                      {draftActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  ) : null}
                </Popover>
              ) : null}
            </div>
            {!compact && operatorActive ? (
              <ModeCommandPill
                name={OPERATOR_COMMAND.name}
                onClear={() => {
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
              <button
                type="button"
                title={t("Stop editing last message")}
                aria-label={t("Stop editing last message")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={exitEditMode}
                className="edit-last-turn-button flex h-6.5 shrink-0 items-center gap-1 rounded-md border border-current/20 px-2 text-[11px] font-medium transition-[background-color,color,border-color] hover:border-current/35 hover:bg-content/15 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <X className="size-3" strokeWidth={1.8} />
                <span>{t("Cancel edit")}</span>
              </button>
            ) : null}
            <div
              className="composer-send-controls flex shrink-0 items-center gap-1"
              data-usage-guide="send-controls"
            >
              <ComposerAction
                busy={busy}
                disabled={disabled}
                hasValue={hasValue && !worktreeRemoved}
                allowBusySubmit={allowBusySubmit}
                label={draftActive ? t("Save draft") : t("Send")}
                busyLabel={
                  draftActive
                    ? undefined
                    : remote
                      ? t("Send now or queue for later")
                      : t(
                          !canSteerHarness(harness) ||
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
                              setting: followUpBehavior,
                            }) === "queue"
                            ? "Queue message"
                            : "Steer",
                        )
                }
                blockedReason={sendHeldReason ?? sendBlockedReason}
                onSend={() => submit(ref.current?.value ?? "")}
                onQueue={
                  queueShortcutApplies({
                    busy,
                    backgroundOnly,
                    allowBusySubmit,
                    disabled: disabled || worktreeRemoved,
                    popupOpen: false,
                    draftMode: draftActive,
                    text: draft,
                    attachmentCount: attachments.length,
                  })
                    ? () => submit(ref.current?.value ?? "", true)
                    : undefined
                }
                queueShortcut={keybindingShortcutLabel(
                  QUEUE_MESSAGE_COMMAND,
                  IS_MAC ? "⇧Tab" : "Shift+Tab",
                )}
                onStop={() => onStop?.()}
              />
            </div>
          </div>
        </div>
        {!hideTopBar && !hideBranchPicker ? (
          <div
            data-composer-workspace
            role="group"
            aria-label={t("Chat workspace")}
            className="mx-3 flex min-w-0 items-center justify-between gap-2 rounded-b-xl border border-t-0 border-content/10 bg-content/2 px-3 pb-1.5 pt-2"
          >
            {draftWorkspace && onWorkspaceModeChange && onWorktreeBaseChange ? (
              <>
                <WorkspacePicker
                  alignBase="end"
                  cwd={executionCwd}
                  mode={workspaceMode ?? "current"}
                  base={resolvedWorktreeBase}
                  enabled={enabled && !busy}
                  onModeChange={onWorkspaceModeChange}
                  onBaseChange={onWorktreeBaseChange}
                  onSelectWorktree={onWorktreeChange}
                  onOpenSettings={onManageWorktrees}
                  onClose={() => ref.current?.focus()}
                >
                  <ComposerTips active={focused && !disabled} />
                </WorkspacePicker>
                {(workspaceMode ?? "current") === "current" ? (
                  <div className="ml-auto flex min-w-0 justify-end">
                    <BranchPicker
                      cwd={executionCwd}
                      branch={branch}
                      enabled={enabled && !busy}
                      onChange={onBranchChange}
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
                  onSelect={onWorktreeChange}
                  worktreeRemoved={worktreeRemoved}
                  onBranchChange={onBranchChange}
                  onManage={onManageWorktrees}
                  onClose={() => ref.current?.focus()}
                />
                <ComposerTips active={focused && !disabled} />
              </>
            ) : (
              <>
                {onWorktreeChange ? (
                  <WorkspaceIdentity worktree={pathKey(cwd) !== pathKey(executionCwd)} />
                ) : null}
                <ComposerTips active={focused && !disabled} />
                <div className="ml-auto flex min-w-0 justify-end">
                  <BranchPicker
                    cwd={executionCwd}
                    branch={branch}
                    enabled={enabled && !busy}
                    onChange={onBranchChange}
                    onClose={() => ref.current?.focus()}
                  />
                </div>
              </>
            )}
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
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  useLocale();
  const rest = mode ? text.slice(mode.end) : text;
  const parts = skillTextParts(rest, names);
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="text-skill">
            {part.text}
          </span>
        ) : (
          // Skill tokens always end on whitespace, so each remaining run still
          // starts on a boundary `@mention` matching can rely on.
          <MentionRuns key={index} text={part.text} mentions={mentions} mcpTags={mcpTags} />
        ),
      )}
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
                  <StickyNote className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon name={part.file.name} isDir={Boolean(part.file.isDir)} size={13} />
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
  disabled = false,
  hasValue,
  allowBusySubmit = true,
  label = t("Send"),
  busyLabel,
  blockedReason,
  onSend,
  onQueue,
  queueShortcut,
  onStop,
}: {
  busy: boolean;
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
  onStop: () => void;
}) {
  useLocale();
  if (disabled) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled
        className="composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default"
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    );
  }
  if (busy) {
    return hasValue && allowBusySubmit ? (
      <>
        {onQueue ? (
          <button
            type="button"
            title={
              queueShortcut
                ? t("Queue message for when this turn finishes ({p0})", { p0: queueShortcut })
                : t("Queue message for when this turn finishes")
            }
            aria-label={t("Queue message")}
            data-usage-guide="queue-button"
            onClick={onQueue}
            className="grid size-6.5 place-items-center rounded-md bg-selection text-content hover:bg-selection-hover"
          >
            <ListEnd className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          title={
            onQueue && queueShortcut
              ? t("{p0} ({p1} queues instead)", { p0: busyLabel ?? label, p1: queueShortcut })
              : (busyLabel ?? label)
          }
          aria-label={label}
          aria-description={busyLabel}
          onClick={onSend}
          className={`composer-send primary-action rounded-md ${busyLabel ? "composer-busy-send" : "grid size-6.5 place-items-center"}`}
        >
          {busyLabel ? <span>{busyLabel}</span> : null}
          <ArrowUp className="size-3.5" strokeWidth={2.25} />
        </button>
      </>
    ) : (
      <button
        type="button"
        title={t("Stop")}
        aria-label={t("Stop")}
        data-usage-guide="stop-button"
        onClick={onStop}
        className="grid size-6.5 place-items-center rounded-md bg-on-solid text-scrim hover:bg-on-solid/90"
      >
        <Square className="size-2.5 fill-current" strokeWidth={0} />
      </button>
    );
  }

  return (
    <button
      type="button"
      title={blockedReason ?? label}
      aria-label={blockedReason ? `${label}. ${blockedReason}` : label}
      disabled={!hasValue}
      onClick={onSend}
      className={`composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default ${
        blockedReason ? "opacity-50" : ""
      }`}
    >
      <ArrowUp className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}

/** Edits the textarea the way typing would, so React and every draft listener see it. */
function applyTextareaEdit(el: HTMLTextAreaElement, text: string, caret: number) {
  el.value = text;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function hasFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return (
    data.files.length > 0 ||
    [...data.types].some((type) => type === "Files" || type === "application/x-moz-file") ||
    Array.from(data.items ?? []).some((item) => item.kind === "file")
  );
}
