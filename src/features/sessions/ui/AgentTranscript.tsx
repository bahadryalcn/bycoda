import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { SessionMessageAuthor } from "./SessionMessageAuthor";
import { InlineError } from "../../../shared/ui/InlineError";
import { Alert } from "../../../shared/ui/Alert";
import { ApprovalDecisionProvider, type ApprovalDispatch } from "./ApprovalDecisionContext";
import { InlineVisual } from "./InlineVisual";
import { Badge } from "../../../shared/ui/Badge";
import { Timestamp } from "../../../shared/ui/Timestamp";
import {
  canOfferTranslation,
  repromptReference,
  type TextActionTarget,
} from "../model/translation";
import {
  selectedTextOffset,
  translatedSelection,
  type TranslationHistory,
} from "../model/translationHistory";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { useTranscriptImageOpen } from "./TranscriptImagePreview";
import type { TranscriptSelection } from "../model/transcriptSelection";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { INTERRUPT_MESSAGE, isTurnInterruptMessage } from "../model/inFlight";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { useLocale, useT } from "../../../shared/i18n";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleDashed,
  Copy,
  FilePlusCorner,
  MessageMultiple,
  Replace,
  MoreHorizontal,
  Pencil,
  ChartBreakoutSquare,
  Terminal,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { PerformanceTraceContext } from "./performanceTraceContext";
import {
  Activity,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TranscriptRetentionContext } from "./TranscriptPool";
import { AttachmentChip } from "./AttachmentChip";
import { AttachmentTokenText } from "./AttachmentTokenText";
import { ChatCitationList } from "./ChatCitationText";
import { extractChatCitations } from "../model/chatCitation";
import { TranscriptSkills } from "./SkillTokenText";
import { UserTextPreview } from "./UserTextPreview";
import { userTextParts } from "../model/userTextPreview";
import { attachmentTokens, findTokens } from "../model/attachmentTokens";
import { GeneratedImage } from "./GeneratedImage";
import { BycodaSparkles } from "./BycodaSparkles";
import { OrchestratorConstellation } from "./OrchestratorConstellation";
import { PlanStepsBurst } from "./PlanStepsBurst";
import { PlanPreview } from "./PlanPreview";
import { OrchestrationPreview } from "../../orchestration/ui/OrchestrationPreview";
import { TaskListPreview } from "./TaskListPreview";
import { HandoffButton, SecondOpinionButton } from "./SecondOpinionButton";
import { SecondOpinionCard } from "./SecondOpinionCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";
import { Spinner } from "../../../shared/ui/Spinner";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import type {
  FloatingButtonGroupAction,
  FloatingButtonGroupTriggerProps,
} from "../../../shared/ui/FloatingButtonGroup";
import { TurnOutputActions } from "./TranscriptMessageActions";
import type { ApprovalDecision } from "../../../integrations/harness";
import {
  isHarnessAuthBlock,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/authSupport";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { Attachment } from "../model/session";
import type { ShellRun } from "../model/shellRun";
import { visibleUserPrompt } from "../../orchestration/model/orchestration";
import { playCue } from "../../settings/model/sounds";
import { legacyTaskListFromText } from "../model/taskList";
import { useResolvedModelName } from "../model/reactiveReads";
import { harnessesForTurns } from "../model/secondOpinion";
import { sameBlocksIgnoringStreamingText, streamingTextUpdate } from "../model/stableBlocks";
import { projectTranslatedBlocks, type TranslationProjection } from "../model/translationProjection";
import { TranscriptTurnCache } from "../model/transcriptTurnCache";
import { Shimmer } from "../../../shared/ui/Shimmer";
import {
  hasPendingApproval,
  HARNESS_TITLE,
  type Block,
  type HarnessId,
  type ModelTarget,
  type PlanBuildTarget,
  type TurnMetrics,
} from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { useElapsedFrom } from "./useElapsedFrom";
import { isBackgroundOnly } from "../model/activityDock";
import { executionUserIndex } from "../model/executionTurn";
import { deriveTurnActivity, turnClockOrigin, type TurnActivityPhase } from "../model/turnActivity";
import { TurnActivityLine } from "./TurnActivityLine";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useTranscriptLayout } from "../hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import type { TranscriptLayout } from "../../settings/model/appearance";
import { AgentMarkdown } from "./AgentMarkdown";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { parseUserMessageLink } from "../model/linkPreview";
import { UserLinkPreview } from "./UserLinkPreview";
import {
  activityStillRunning,
  firstFoldableIndex,
  foldableWork,
  foldedBlocks,
  initialThinkingIndex,
  lastActivityIndex,
  isProseBlock,
  hasTurnCopyText,
  turnCopyText,
  workKind,
  workSummaryLine,
  type ActivityPhaseKind,
  type TurnItem,
} from "../model/transcriptActivity";
import { lastUserTurnBlock } from "../model/editLastTurn";
import { isOperatorUserTurn, operatorUserPrompt } from "../model/operatorCommand";
import { useTranscriptFollow, useTranscriptCheckpointRestore } from "./useTranscriptFollow";
import { useTranscriptPaging } from "./useTranscriptPaging";
import { useTranscriptSearch } from "./useTranscriptSearch";
import { useClampOverflow } from "./useClampOverflow";
import { useRetainedDisclosure } from "./useRetainedDisclosure";
import {
  ActivityPhases,
  SubagentStack,
  ActivityPhaseIcon,
  formatWorkingDuration,
  ToolCall,
  HandoffDivider,
  InterjectionDivider,
} from "./AgentTranscriptActivity";
export { ActivityRow, agentStepBlock } from "./AgentTranscriptActivity";

type Props = {
  /** Travels with the element when TranscriptPool renders it in its outlet. */
  approvalContext?: {
    session: import("../model/session").Session;
    getSession?: () => import("../model/session").Session;
    dispatch: ApprovalDispatch;
  };
  sessionId?: string;
  blocks: Block[];
  busy?: boolean;
  historyLoading?: boolean;
  historyLoadError?: string;
  remoteHistoryHasMore?: boolean;
  remoteHistoryLoading?: boolean;
  remoteHistoryError?: string;
  onLoadRemoteHistory?: () => Promise<number | void> | void;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  performanceTraceId?: string;
  cwd?: string;
  harness?: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  pendingQuestion?: boolean;
  questionBehavior?: "blocking" | "nonBlocking";
  /** The companion composer dock owns the live clock; keep work disclosure here. */
  liveStatusInDock?: boolean;
  /** Work the agent left running when it yielded; the turn waits on it. */
  backgroundTasks?: string[];
  backgroundAgents?: number;
  /** The provider's latest retry notice for the running turn. */
  retryMessage?: string;
  /** The app is still starting the send (lease, workspace, usage checks). */
  preparingTurn?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onAddToChat?: (text: string) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onEditDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onSaveSelectionNote?: (text: string) => void | Promise<void>;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  planBuildTargets?: boolean;
  onSecondOpinion?: (target: ModelTarget, turn: Block[]) => void;
  onHandoff?: (target: ModelTarget, turn: Block[]) => void;
  onEditLastTurn?: () => void;
  canRewindMessage?: (blockId: string) => boolean;
  onRewindMessage?: (block: Block, action: "edit" | "return") => void;
  editingLastTurn?: boolean;
  onJumpToBottomChange?: (show: boolean) => void;
  /** The reader scrolled away from the end (latched), as opposed to content growing. */
  onReadingChange?: (reading: boolean) => void;

  onJumpToBottomReady?: (jump: (() => void) | null) => void;
  /** Passes a function that renders the turn that holds a block. The render completes before the function returns. */
  onRevealReady?: (reveal: ((blockId: string) => boolean) | null) => void;
  onNavigateReady?: (
    navigate: ((blockId: string | null, query?: string) => boolean) | null,
  ) => void;
  /** Session-level output shown after the latest reply and before its action row. */
  latestTurnAccessory?: ReactNode;
  /** False while another tab is in front; local transcript state is retained. */
  visible?: boolean;
  /** Kept mounted after its pane closed. Showing it again counts as a new visit. */
  parked?: boolean;
  onScrollerChange?: (el: HTMLDivElement | null) => void;
  /** A worker's transcript: show the orchestrator's turns instead of hiding them. */
  managed?: boolean;
};

function filterAuthErrors(harness: HarnessId | undefined, sourceBlocks: Block[]): Block[] {
  if (!harness || !supportsHarnessLogin(harness)) return sourceBlocks;
  const visibleBlocks = sourceBlocks.filter((block) => !isHarnessAuthBlock(block));
  return visibleBlocks.length === sourceBlocks.length ? sourceBlocks : visibleBlocks;
}

function AgentTranscriptComponent({
  sessionId,
  blocks: persistedBlocks,
  busy,
  historyLoading = false,
  historyLoadError,
  remoteHistoryHasMore = false,
  remoteHistoryLoading = false,
  remoteHistoryError,
  onLoadRemoteHistory,
  onLoadRemoteBlock,
  performanceTraceId,
  cwd,
  harness,
  model,
  modelSettings,
  providerAccountId,
  pendingQuestion = false,
  questionBehavior,
  liveStatusInDock = false,
  backgroundTasks,
  backgroundAgents,
  retryMessage,
  preparingTurn = false,
  onApproval,
  onAddToChat,
  onSaveNote,
  onSendDraft,
  onEditDraft,
  onRemoveDraft,
  onSaveSelectionNote,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  planBuildTargets = true,
  onSecondOpinion,
  onHandoff,
  onEditLastTurn,
  canRewindMessage,
  onRewindMessage,
  editingLastTurn = false,
  onJumpToBottomChange,
  onReadingChange,
  onJumpToBottomReady,
  onRevealReady,
  onNavigateReady,
  latestTurnAccessory,

  visible = true,
  parked = false,
  onScrollerChange,
  managed = false,
}: Props) {
  const t = useT();
  const translationContext = useMemo(
    () => (cwd && harness ? { cwd, harness, model, modelSettings, providerAccountId } : undefined),
    [cwd, harness, model, modelSettings, providerAccountId],
  );
  const [translationRequest, setTranslationRequest] = useState<{
    selection: TranscriptSelection;
    target: TextActionTarget;
    source: string;
    displayed: string;
  } | null>(null);
  const [translations, setTranslations] = useState<
    Record<string, TranslationHistory & { source: string; translatedVisible: boolean }>
  >({});
  const [activeTranslation, setActiveTranslation] = useState<string | null>(null);
  const translationCopy = useCopyFeedback({
    resetKeys: [activeTranslation, translations[activeTranslation ?? ""]?.translatedVisible],
  });
  const translationProjection = useRef<TranslationProjection | null>(null);
  const sourceBlocks = useMemo(
    () => projectTranslatedBlocks(persistedBlocks, translations, translationProjection.current),
    [persistedBlocks, translations],
  );
  useLayoutEffect(() => {
    translationProjection.current = { source: persistedBlocks, translations, blocks: sourceBlocks };
  }, [persistedBlocks, translations, sourceBlocks]);
  const translateSelection = useStableCallback(
    canOfferTranslation(translationContext)
      ? (selection: TranscriptSelection, target: TextActionTarget) => {
          const sourceBlock = persistedBlocks.find((block) => block.id === selection.responseId);
          if (target === "reprompt" && sourceBlock?.role !== "user") return;
          const source = sourceBlock?.text;
          const displayed = sourceBlocks.find((block) => block.id === selection.responseId)?.text;
          if (source !== undefined && displayed !== undefined)
            setTranslationRequest({ selection, target, source, displayed });
        }
      : undefined,
  );
  const activeVersion = activeTranslation ? translations[activeTranslation] : undefined;
  const activeVersionValid =
    activeTranslation &&
    activeVersion &&
    persistedBlocks.some(
      (block) => block.id === activeTranslation && block.text === activeVersion.source,
    );
  const showTranslation = (translatedVisible: boolean) => {
    if (!activeTranslation || !activeVersionValid) return;
    setTranslations((current) => ({
      ...current,
      [activeTranslation]: { ...current[activeTranslation], translatedVisible },
    }));
  };
  const authFilterPrev = useRef<{
    harness: typeof harness;
    source: Block[];
    result: Block[];
  } | null>(null);
  const blocks = useMemo(() => {
    const prev = authFilterPrev.current;
    // A text-only streaming frame changes no block's role or notice, so a
    // previously unfiltered transcript stays unfiltered: skip the scan.
    if (
      prev &&
      prev.harness === harness &&
      prev.result === prev.source &&
      streamingTextUpdate(prev.source, sourceBlocks) !== undefined
    ) {
      return sourceBlocks;
    }
    return filterAuthErrors(harness, sourceBlocks);
  }, [harness, sourceBlocks]);
  // Remember what each committed frame filtered, never from inside the memo:
  // a render that React discards must not move the baseline.
  useLayoutEffect(() => {
    authFilterPrev.current = { harness, source: sourceBlocks, result: blocks };
  }, [harness, sourceBlocks, blocks]);
  const editableUserBlockId = useMemo(() => lastUserTurnBlock(blocks)?.id, [blocks]);
  const retention = useContext(TranscriptRetentionContext);
  const retained = retention?.read();
  const seenOutput = useRef<Set<string> | null>(null);
  const seenBlocks = useRef<Block[] | null>(null);
  if (!seenOutput.current)
    seenOutput.current = new Set(blocks.filter((block) => block.text).map((block) => block.id));
  useLayoutEffect(() => {
    const previous = seenBlocks.current;
    seenBlocks.current = blocks;
    const update = previous ? streamingTextUpdate(previous, blocks) : undefined;
    if (update !== undefined && blocks[update]) {
      // A text-only streaming frame can only add the streamed block's id.
      if (blocks[update].text) seenOutput.current!.add(blocks[update].id);
      return;
    }
    // Keep only the loaded page's ids: paging must not create an unbounded cache.
    seenOutput.current!.clear();
    for (const block of blocks) if (block.text) seenOutput.current!.add(block.id);
  }, [blocks]);
  const [turnCache] = useState(() => new TranscriptTurnCache());
  const turns = turnCache.group(blocks, managed);
  // Turns whose folded work the reader has opened, by turn id.
  const [openWork, setOpenWork] = useState<Record<string, boolean>>(() => retained?.openWork ?? {});
  const toggleWork = useCallback((turnId: string, currentlyOpen: boolean) => {
    setOpenWork((open) => ({ ...open, [turnId]: !currentlyOpen }));
  }, []);
  // Stretch the last turn after a send while this tab stays open. Closing
  // the tab is a new visit: the remount uses the true transcript height so
  // the latest reply sits near the composer instead of a hole of empty space.
  const [anchorTurn, setAnchorTurn] = useState(!!busy);
  const [wasParked, setWasParked] = useState(parked);
  if (wasParked !== parked) {
    setWasParked(parked);
    if (!parked && anchorTurn !== !!busy) setAnchorTurn(!!busy);
  }
  const transcriptLayout = useTranscriptLayout();
  const promptAnchor = useTranscriptAnchor();
  const lastUserId = lastUserBlockId(blocks, managed);
  const [seenUserId, setSeenUserId] = useState(lastUserId);
  if (lastUserId !== seenUserId) {
    setSeenUserId(lastUserId);
    if (lastUserId && !anchorTurn) setAnchorTurn(true);
  }
  const currentModelName = useResolvedModelName(harness, model);
  const blockingQuestion = pendingQuestion && questionBehavior === "blocking";
  const waitingForApproval = hasPendingApproval(blocks) || blockingQuestion;
  const preparingHandoff = blocks.some(
    (block) => block.role === "handoff" && block.handoff?.status === "preparing",
  );
  // The prompt whose run is in flight; a mid-turn message continues its clock.
  const runOwner = busy ? blocks[executionUserIndex(blocks)] : undefined;

  // In the chat layout a sent prompt rises from the upper screen into its
  // anchored spot at the top. On mount this only plays for a session's first
  // send.
  const introducePrompt = useStableCallback((mounting: boolean, el: HTMLDivElement | null) => {
    if (!lastUserId || transcriptLayout !== "chat" || !(promptAnchor && anchorTurn) || !visible)
      return;
    if (mounting && !(busy && userTurnCount(blocks, managed) === 1)) return;
    return riseIntoAnchor(el, lastUserId);
  });
  const follow = useTranscriptFollow({
    visible,
    parked,
    lastUserId,
    onPromptChange: introducePrompt,
    onJumpToBottomChange,
    onJumpToBottomReady,
    onReadingChange,
    onScrollerChange,
  });
  const { scroller, scrollerEl, setScroller, wasVisible } = follow;
  const { visibleTurnCount, firstVisibleTurn, visibleTurns, loadEarlier, revealBlock, findTurn } =
    useTranscriptPaging({
      turns,
      blockCount: blocks.length,
      openWork,
      scroller,
      stickToBottom: follow.stickToBottom,
      distanceFromBottom: follow.distanceFromBottom,
      prependHeight: follow.prependHeight,
      remoteHistoryHasMore,
      onLoadRemoteHistory,
      onRevealReady,
    });
  const { searchCurrent } = useTranscriptSearch({
    scroller,
    visible,
    parked,
    busy: !!busy,
    turns,
    visibleTurns,
    visibleTurnCount,
    openWork,
    setOpenWork,
    revealBlock,
    findTurn,
    onNavigateReady,
  });
  const turnHarnesses = harness ? harnessesForTurns(blocks, visibleTurns, harness) : undefined;
  const stableLoadRemoteBlock = useStableCallback(onLoadRemoteBlock);
  const stableApproval = useStableCallback(onApproval);
  const stableSaveNote = useStableCallback(onSaveNote);
  const stableSendDraft = useStableCallback(onSendDraft);
  const stableEditDraft = useStableCallback(onEditDraft);
  const stableRemoveDraft = useStableCallback(onRemoveDraft);
  // Image files preview in a dialog first (Ctrl/Cmd+click skips it); every other file opens a tab.
  const imageOpen = useTranscriptImageOpen(cwd, onOpenFile);
  const stableOpenFile = imageOpen.open;
  const stableOpenDiff = useStableCallback(onOpenDiff);
  const stableOpenPlan = useStableCallback(onOpenPlan);
  const stableBuildPlan = useStableCallback(onBuildPlan);
  const stableSecondOpinion = useStableCallback(onSecondOpinion);
  const stableHandoff = useStableCallback(onHandoff);
  const stableEditLastTurn = useStableCallback(onEditLastTurn);
  const stableRewindMessage = useStableCallback(onRewindMessage);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!visible || !el || !retention) return;
    // Markdown owns its code folds. Checkpoint only that explicit presentation
    // control, without changing markdown, replaying actions or retaining DOM.
    const restoreCodeFolds = () => {
      const disclosures = retention.read().disclosures;
      if (!disclosures) return;
      for (const turn of el.querySelectorAll<HTMLElement>("[data-transcript-turn]")) {
        [...turn.querySelectorAll<HTMLElement>(".markdown-code-shell")].forEach((shell, index) => {
          const collapsed = disclosures[`code:${turn.dataset.transcriptTurn}:${index}`];
          if (typeof collapsed === "boolean" && collapsed !== (shell.dataset.collapsed === "true"))
            shell.querySelector<HTMLButtonElement>(".markdown-code-toggle")?.click();
        });
      }
    };
    restoreCodeFolds();
    const observer = new MutationObserver(restoreCodeFolds);
    observer.observe(el, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 1000);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [retention, scroller, scrollerEl, visible]);

  useTranscriptCheckpointRestore(follow, visible, lastUserId);

  return (
    <PerformanceTraceContext.Provider value={performanceTraceId}>
      <div
        ref={setScroller}
        data-chat-citation-session={sessionId}
        tabIndex={-1}
        onClickCapture={(event) => {
          imageOpen.noteClick(event);
          const control = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".markdown-code-toggle, .markdown-code-summary",
          );
          const shell = control?.closest<HTMLElement>(".markdown-code-shell");
          const turn = shell?.closest<HTMLElement>("[data-transcript-turn]");
          if (!control || !shell || !turn || !retention) return;
          const index = [...turn.querySelectorAll(".markdown-code-shell")].indexOf(shell);
          retention.setDisclosure(
            `code:${turn.dataset.transcriptTurn}:${index}`,
            control.matches(".markdown-code-summary") ? false : shell.dataset.collapsed !== "true",
          );
        }}
        onPointerDown={(event) => {
          const id = (event.target as HTMLElement)
            .closest("[data-selectable-agent-response]")
            ?.getAttribute("data-selectable-agent-response");
          if (id && translations[id]) setActiveTranslation(id);
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            !activeVersionValid ||
            event.shiftKey ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
          )
            return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            showTranslation(event.key === "ArrowDown");
          }
        }}
        className="agent-transcript h-full overflow-y-auto overscroll-none [overflow-anchor:none] font-mono text-ui-secondary leading-5"
      >
        {activeVersionValid ? (
          // z-10: in-pane sticky bar over the scrolling rows; no in-pane layer scale exists, so the literal stays.
          <div className="sticky inset-bs-0 z-10 flex flex-wrap items-center justify-end gap-1 bg-(--ui-surface) px-3 py-1 font-sans text-ui-caption text-(--ui-text-secondary)">
            <Button
              motion="none"
              size="sm"
              variant="ghost"
              type="button"
              tooltip={t("After applying: ↑ original, ↓ translation.")}
              aria-pressed={!activeVersion.translatedVisible}
              onClick={() => showTranslation(false)}
            >
              {t("Original text")}
            </Button>
            <Button
              motion="none"
              size="sm"
              variant="ghost"
              type="button"
              aria-pressed={activeVersion.translatedVisible}
              onClick={() => showTranslation(true)}
            >
              {t("Translation")}
            </Button>
            <Button
              motion="none"
              size="sm"
              variant="ghost"
              iconOnly
              label={translationCopy.copied ? t("Copied") : t("Copy")}
              loading={translationCopy.pending}
              onClick={() =>
                translationCopy.copy(() =>
                  copyMessage(
                    activeVersion.translatedVisible
                      ? activeVersion.translated
                      : activeVersion.original,
                  ),
                )
              }
            >
              {translationCopy.copied ? <Check /> : <Copy />}
            </Button>
            <Button
              motion="none"
              size="sm"
              variant="ghost"
              iconOnly
              label={t("Close translation")}
              onClick={() => setActiveTranslation(null)}
            >
              <X />
            </Button>
            {translationCopy.failed ? (
              <InlineError>
                {t("Could not complete this action. ")}
                {translationCopy.error}
              </InlineError>
            ) : null}
          </div>
        ) : null}
        <div
          data-transcript-content
          className="transcript-content mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-1 pb-8"
        >
          {historyLoading ? (
            <div
              role="status"
              className="px-4 py-3 font-sans text-ui-caption text-(--ui-text-secondary)"
            >
              {t("Loading earlier messages…")}
            </div>
          ) : null}
          {historyLoadError ? (
            <Alert tone="danger" role="alert">
              {historyLoadError}
            </Alert>
          ) : null}
          {remoteHistoryError ? (
            <Alert tone="danger" role="alert">
              {remoteHistoryError}
            </Alert>
          ) : null}
          {firstVisibleTurn > 0 || remoteHistoryHasMore ? (
            <div className="flex justify-center px-4 py-3">
              <Button
                motion="none"
                variant="ghost"
                type="button"
                disabled={remoteHistoryLoading}

                onClick={() => void loadEarlier()}
              >
                {remoteHistoryLoading ? t("Loading earlier messages…") : t("Load earlier messages")}
              </Button>
            </div>
          ) : null}
          {visibleTurns.map((turn, turnIndex) => {
            const turnNumber = firstVisibleTurn + turnIndex + 1;
            const isLastTurn = turnNumber === turns.length;
            const settled = !(busy && isLastTurn);
            const live = visible && !settled && !preparingHandoff;
            const turnId = turn[0].id;
            const runHarness = turnHarnesses?.[turnIndex] ?? harness;
            const activity = live
              ? deriveTurnActivity({
                  turn,
                  responded:
                    !!runOwner?.continuationOf ||
                    (runOwner?.startedAt != null && runOwner.durationMs == null),
                  provider: runHarness ? HARNESS_TITLE[runHarness] : undefined,
                  retryMessage,
                  preparing: preparingTurn,
                  waiting: waitingForApproval || pendingQuestion || !!backgroundTasks?.length,
                })
              : null;
            const activityOwnsClock = !!activity && !activity.afterSilence && liveStatusInDock;
            return (
              <Turn
                key={turnId}
                turn={turn}
                seenOutput={seenOutput.current!}
                allowMountReveal={
                  visible && wasVisible.current && !historyLoading && !remoteHistoryLoading
                }
                managed={managed}
                settled={settled}
                live={live}
                visible={visible}
                isLastTurn={isLastTurn}
                turnNumber={turnNumber}
                turnHarness={turnHarnesses?.[turnIndex]}
                clockStart={live ? turnClockStart(blocks, turnUserBlock(turn, managed)) : undefined}
                currentModelName={live ? currentModelName : undefined}
                waitingForApproval={live && waitingForApproval}
                pendingQuestion={live && blockingQuestion}
                liveStatusInDock={live && liveStatusInDock}
                backgroundTasks={live ? backgroundTasks : undefined}
                backgroundAgents={live ? backgroundAgents : undefined}
                activityPhase={activity?.phase}
                activityLabel={activity?.label}
                activityAfterSilence={activity?.afterSilence}
                activityOrigin={activityOwnsClock ? turnClockOrigin(runOwner) : undefined}
                activitySessionId={activityOwnsClock ? sessionId : undefined}
                anchorPrompt={promptAnchor && anchorTurn && isLastTurn}
                latestTurnAccessory={isLastTurn && !parked ? latestTurnAccessory : undefined}
                workOpen={openWork[turnId] ?? false}
                searchCurrent={
                  searchCurrent && turn.some((block) => block.id === searchCurrent)
                    ? searchCurrent
                    : null
                }
                transcriptLayout={transcriptLayout}
                editableUserBlockId={editableUserBlockId}
                editingLastTurn={editingLastTurn}
                busy={!!busy}
                planHarness={planBuildTargets ? harness : undefined}
                planModel={model}
                planModelSettings={modelSettings}
                cwd={cwd}
                toggleWork={toggleWork}
                onApproval={stableApproval}
                onSaveNote={stableSaveNote}
                onSendDraft={stableSendDraft}
                onEditDraft={stableEditDraft}
                onRemoveDraft={stableRemoveDraft}
                onOpenFile={stableOpenFile}
                onOpenDiff={stableOpenDiff}
                onOpenPlan={stableOpenPlan}
                onBuildPlan={stableBuildPlan}
                onLoadRemoteBlock={stableLoadRemoteBlock}
                onSecondOpinion={stableSecondOpinion}
                onHandoff={stableHandoff}
                onEditLastTurn={stableEditLastTurn}
                canRewindMessage={canRewindMessage}
                onRewindMessage={stableRewindMessage}
              />
            );
          })}
        </div>
        {onAddToChat || onSaveSelectionNote || canOfferTranslation(translationContext) ? (
          <TranscriptSelectionActions
            root={scrollerEl}
            enabled={visible}
            sessionId={sessionId}
            blocks={persistedBlocks}
            onAddToChat={onAddToChat}
            onAddToNotes={onSaveSelectionNote}
            onTranslate={translateSelection}
          />
        ) : null}
        {imageOpen.preview}
        {translationRequest && translationContext ? (
          <TranslationResultDialog
            text={translationRequest.selection.text}
            surroundingText={(() => {
              const { displayed, selection } = translationRequest;
              const start = selectedTextOffset(displayed, selection.text, selection.occurrence);
              return start < 0
                ? undefined
                : repromptReference(displayed, start, start + selection.text.length);
            })()}
            target={translationRequest.target}
            context={translationContext}
            onClose={() => setTranslationRequest(null)}
            onApply={(translation) => {
              const { selection, source, displayed } = translationRequest;
              const id = selection.responseId;
              const start = selectedTextOffset(displayed, selection.text, selection.occurrence);
              if (
                !id ||
                start < 0 ||
                (displayed.trim() !== selection.responseText?.trim() &&
                  displayed.indexOf(
                    selection.text,
                    displayed.indexOf(selection.text) + selection.text.length,
                  ) >= 0) ||
                persistedBlocks.find((block) => block.id === id)?.text !== source
              )
                throw new Error("Message changed or selection ambiguous");
              const history = translatedSelection(
                displayed,
                start,
                start + selection.text.length,
                translation,
              );
              setTranslations((current) => ({
                ...current,
                [id]: {
                  ...history,
                  original: current[id]?.source === source ? current[id].original : displayed,
                  source,
                  translatedVisible: true,
                },
              }));
              setActiveTranslation(id);
              requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true }));
            }}
          />
        ) : null}
      </div>
    </PerformanceTraceContext.Provider>
  );
}

// Activity preserves local state while suspending hidden work and effects.
export const AgentTranscript = memo(function AgentTranscript(props: Props) {
  const transcript =
    props.cwd && props.harness ? (
      <TranscriptSkills cwd={props.cwd} harness={props.harness} sessionId={props.sessionId}>
        <AgentTranscriptComponent {...props} />
      </TranscriptSkills>
    ) : (
      <AgentTranscriptComponent {...props} />
    );
  return (
    <Activity mode={props.visible === false ? "hidden" : "visible"}>
      {props.approvalContext ? (
        <ApprovalDecisionProvider {...props.approvalContext}>{transcript}</ApprovalDecisionProvider>
      ) : (
        transcript
      )}
    </Activity>
  );
});

type TurnProps = {
  turn: Block[];
  seenOutput: ReadonlySet<string>;
  allowMountReveal: boolean;
  managed: boolean;
  settled: boolean;
  live: boolean;
  visible: boolean;
  isLastTurn: boolean;
  /** One-based position in the whole transcript, not in the visible window. */
  turnNumber: number;
  /** The provider that produced the turn, resolved for the whole transcript. */
  turnHarness?: HarnessId;
  clockStart?: number;
  currentModelName?: string;
  waitingForApproval: boolean;
  pendingQuestion: boolean;
  liveStatusInDock: boolean;
  backgroundTasks?: string[];
  backgroundAgents?: number;
  /** The live turn's activity line, while visible rows do not say what it is doing. */
  activityPhase?: TurnActivityPhase;
  activityLabel?: string;
  activityAfterSilence?: boolean;
  activityOrigin?: number;
  activitySessionId?: string;
  anchorPrompt: boolean;
  latestTurnAccessory?: ReactNode;
  workOpen: boolean;
  searchCurrent: string | null;
  transcriptLayout: TranscriptLayout;
  editableUserBlockId?: string;
  editingLastTurn: boolean;
  busy: boolean;
  planHarness?: HarnessId;
  planModel?: string;
  planModelSettings?: Record<string, string>;
  cwd?: string;
  toggleWork: (turnId: string, currentlyOpen: boolean) => void;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onEditDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  onSecondOpinion?: (target: ModelTarget, turn: Block[]) => void;
  onHandoff?: (target: ModelTarget, turn: Block[]) => void;
  onEditLastTurn?: () => void;
  canRewindMessage?: (blockId: string) => boolean;
  onRewindMessage?: (block: Block, action: "edit" | "return") => void;
};

/**
 * One turn of the transcript. For a settled turn every prop is a primitive or
 * a stable reference and `turn` is compared block by block, so a streamed
 * token re-renders only the live turn. The parent hands settled turns
 * `undefined` for the props only a live turn reads.
 */
const Turn = memo(function Turn({
  turn,
  seenOutput,
  allowMountReveal,
  managed,
  settled,
  live,
  visible,
  isLastTurn,
  turnNumber,
  turnHarness,
  clockStart,
  currentModelName,
  waitingForApproval,
  pendingQuestion,
  liveStatusInDock,
  backgroundTasks,
  backgroundAgents,
  activityPhase,
  activityLabel,
  activityAfterSilence = false,
  activityOrigin,
  activitySessionId,
  anchorPrompt,
  latestTurnAccessory,
  workOpen,
  searchCurrent,
  transcriptLayout,
  editableUserBlockId,
  editingLastTurn,
  busy,
  planHarness,
  planModel,
  planModelSettings,
  cwd,
  toggleWork,
  onApproval,
  onSaveNote,
  onSendDraft,
  onEditDraft,
  onRemoveDraft,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onLoadRemoteBlock,
  onSecondOpinion,
  onHandoff,
  onEditLastTurn,
  canRewindMessage,
  onRewindMessage,
}: TurnProps) {
  const userBlock = turnUserBlock(turn, managed);
  const durationMs = userBlock?.durationMs;
  const proposals = turn.filter((block) => block.orchestration);
  // Proposals are turn results, like the changes card. Keep them out
  // of the live work and append them after all of the lead's output.
  const [itemCache] = useState(() => new TranscriptTurnCache());
  const items = itemCache.turnItems(turn, settled);
  // Earlier activity groups have already been followed by prose or
  // more work. Only the last one can still be the live group.
  const foldedAt = lastActivityIndex(items);
  const initialThinkingAt = initialThinkingIndex(items);
  // While the turn is live, the activity line at its end stands in for the
  // private-reasoning placeholder, with the same words plus how long.
  const initialThinkingInLine =
    live && activityPhase === "thinking" && !activityAfterSilence ? initialThinkingAt : -1;
  const startedAt = userBlock?.startedAt;
  // The agent starting its answer is the end of the work: fold the
  // groups then, not when the turn finally settles, so the collapse
  // never lands under the text you have already started reading.
  const answering =
    foldedAt >= 0 &&
    items.slice(foldedAt + 1).some((item) => item.type === "block" && isProseBlock(item.block));
  const workStillRunning = activityStillRunning(turn);
  // New turns carry immutable model provenance. Legacy turns do not,
  // so omit their model instead of rewriting history from the picker.
  const turnModel = userBlock?.turnModel;
  // Work the turn has already answered for folds away behind one line,
  // leaving the prompt and the answer to it.
  const turnId = turn[0].id;
  const fold = foldableWork(items);
  const folded = fold ? foldedBlocks(items, fold) : [];
  // The fold line is the turn's status line from the first token to
  // the last: the mark, and the clock beside it. It never moves, so a
  // turn settling does not shuffle the layout around the answer.
  const turnModelName = turnModel?.name ?? (live ? currentModelName : undefined);
  // The fold line speaks for the main agent only. A delegated run has
  // its own row, which says who is working and how it went, so saying
  // it again here would be two lines telling the same story.
  const foldTitle: ReactNode =
    live && liveStatusInDock && !waitingForApproval ? (
      (turnModelName ?? workSummaryLine(folded))
    ) : live ? (
      <LiveFoldTitle
        startedAt={clockStart}
        paused={waitingForApproval}
        waitingLabel={
          managed && waitingForApproval
            ? "Waiting for orchestrator"
            : pendingQuestion
              ? "Waiting for answers"
              : undefined
        }
        background={backgroundTasks}
        backgroundAgents={backgroundAgents}
        modelName={turnModelName}
      />
    ) : durationMs != null ? (
      formatWorkingDuration(durationMs, turnModelName, true)
    ) : (
      workSummaryLine(folded)
    );
  const showFoldLine =
    (live && (!liveStatusInDock || waitingForApproval)) || durationMs != null || !!fold;
  // It sits where the work starts, from before there is any: the row
  // is there from the first token, so nothing shoves the answer down
  // when the turn folds.
  const firstWork = firstFoldableIndex(items);
  const foldLineAt = fold ? fold.start : firstWork >= 0 ? firstWork : items.length;
  const isCurrentItem = (item: TurnItem) =>
    item.type === "block"
      ? item.block.id === searchCurrent
      : item.blocks.some((block) => block.id === searchCurrent);
  const renderItem = (item: TurnItem, itemIndex: number) =>
    item.type === "subagents" ? (
      <SubagentStack
        key={item.blocks[0].id}
        blocks={item.blocks}
        cwd={cwd}
        live={live}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ) : item.type === "activity" ? (
      itemIndex === initialThinkingAt ? (
        <InitialThinking key={item.blocks[0].id} live={visible && !settled} />
      ) : (
        <ActivityPhases
          key={item.blocks[0].id}
          blocks={item.blocks}
          cwd={cwd}
          done={!visible || settled || itemIndex < foldedAt || (answering && !workStillRunning)}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      )
    ) : (
      <div key={item.block.id}>
        {item.block.remoteContent && onLoadRemoteBlock ? (
          <RemoteBlockLoad
            // A new revision is a different block body: start from idle.
            key={item.block.remoteContent.revision}
            blockId={item.block.id}
            revision={item.block.remoteContent.revision}
            bytes={item.block.remoteContent.bytes}
            onLoad={onLoadRemoteBlock}
          />
        ) : null}
        <TranscriptBlock
          block={item.block}
          revealOnMount={allowMountReveal && isLastTurn && !seenOutput.has(item.block.id)}
          layout={transcriptLayout}
          visible={item.block.role === "user" ? visible : undefined}
          stickyIndex={turnNumber}
          // Prose reads the same wherever it lands: under the fold
          // line at the top of the turn, or under the work it follows.
          underLine={
            isProseBlock(item.block) &&
            itemIndex > 0 &&
            (items[itemIndex - 1]?.type === "activity" ||
              items[itemIndex - 1]?.type === "subagents" ||
              (itemIndex === foldLineAt && showFoldLine))
          }
          onApproval={onApproval}
          onSaveNote={onSaveNote}
          onSendDraft={onSendDraft}
          onEditDraft={onEditDraft}
          onRemoveDraft={onRemoveDraft}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onOpenPlan={onOpenPlan}
          onBuildPlan={onBuildPlan}
          planBusy={busy}
          planHarness={planHarness}
          planModel={planModel}
          planModelSettings={planModelSettings}
          cwd={cwd}
          onEditLastTurn={
            onEditLastTurn &&
            settled &&
            item.block.role === "user" &&
            item.block.id === editableUserBlockId &&
            !item.block.draft
              ? onEditLastTurn
              : undefined
          }
          canRewindMessage={canRewindMessage}
          onRewindMessage={onRewindMessage}
          editing={
            editingLastTurn && item.block.role === "user" && item.block.id === editableUserBlockId
          }
        />
      </div>
    );
  // Assistant messages and delegated runs stay visible even when the work
  // around them folds. A new update must never hide an earlier reply.
  const foldEntries = fold
    ? items.slice(fold.start, fold.end + 1).map((entry, offset) => ({
        entry,
        index: fold.start + offset,
      }))
    : [];
  const staysVisible = ({ entry }: (typeof foldEntries)[number]) =>
    entry.type === "subagents" || (entry.type === "block" && isProseBlock(entry.block));
  const foldVisible = foldEntries.filter(staysVisible);
  const foldWork = foldEntries.filter((entry) => !staysVisible(entry));
  const foldLineRow = (
    <TurnRow key="work-fold" folded={!showFoldLine}>
      <WorkFoldLine
        title={foldTitle}
        kind={workKind(folded)}
        harness={turnHarness}
        live={live}
        expandable={!!fold}
        open={workOpen && !!fold}
        onToggle={() => toggleWork(turnId, workOpen)}
      />
    </TurnRow>
  );
  return (
    <div
      key={turn[0].id}
      data-transcript-turn={turnId}
      className={`transcript-turn flex min-w-0 flex-col${
        isLastTurn ? " transcript-turn-live" : ""
      }${anchorPrompt && userBlock ? " transcript-turn-anchor" : ""}`}
    >
      {items.flatMap((item, itemIndex) => {
        const inFold = !!fold && itemIndex >= fold.start && itemIndex <= fold.end;
        if (inFold) {
          if (itemIndex !== fold.start) return [];
          return [
            foldLineRow,
            <TurnRow key="work-details" folded={!workOpen}>
              {() =>
                foldWork.map(({ entry, index }, offset) => (
                  <div
                    key={turnItemKey(entry)}
                    data-transcript-search-item
                    data-transcript-search-current={isCurrentItem(entry) || undefined}
                    className={`flow-root pb-1 last:pb-0 pl-5 zen-fold-rail ${
                      offset === foldWork.length - 1 ? "zen-fold-tail" : ""
                    }`}
                  >
                    {renderItem(entry, index)}
                  </div>
                ))
              }
            </TurnRow>,
            ...foldVisible.map(({ entry, index }) => (
              <div
                key={turnItemKey(entry)}
                data-transcript-search-item
                data-transcript-search-current={isCurrentItem(entry) || undefined}
                className="flow-root pb-1"
              >
                {renderItem(entry, index)}
              </div>
            )),
          ];
        }
        const row =
          itemIndex === initialThinkingInLine ? null : (
            <div
              key={turnItemKey(item)}
              data-transcript-search-item
              data-transcript-search-current={isCurrentItem(item) || undefined}
              className="flow-root pb-1"
            >
              {renderItem(item, itemIndex)}
            </div>
          );
        if (itemIndex !== foldLineAt) return row ?? [];
        return row ? [foldLineRow, row] : [foldLineRow];
      })}
      {foldLineAt >= items.length ? foldLineRow : null}
      {activityPhase && activityLabel ? (
        <TurnActivityLine
          phase={activityPhase}
          label={activityLabel}
          afterSilence={activityAfterSilence}
          activityKey={turn}
          origin={activityOrigin}
          ownsClock={activityOrigin !== undefined}
          sessionId={activitySessionId}
        />
      ) : null}
      {settled &&
        proposals
          .filter((block) => block.orchestration?.status !== "planning")
          .map((block) => (
            <div key={block.id} className="px-4 pt-1 pb-2" data-orchestration-result>
              <OrchestrationPreview block={block} busy={busy} />
            </div>
          ))}
      {/* The accessory keeps the pane's props, which go stale once parked. */}
      {latestTurnAccessory ? latestTurnAccessory : null}
      {durationMs != null && settled ? (
        <TurnDuration
          elapsedMs={durationMs}
          metrics={userBlock?.turnMetrics}
          labelHidden={showFoldLine}
          modelName={turnModelName}
          completedAt={startedAt != null ? startedAt + durationMs : undefined}
          turn={turn}
          onSaveNote={onSaveNote}
          harness={turnHarness}
          fromHarness={turnHarness}
          fromModel={turnModel?.id}
          onSecondOpinion={onSecondOpinion ? (target) => onSecondOpinion(target, turn) : undefined}
          onHandoff={onHandoff ? (target) => onHandoff(target, turn) : undefined}
        />
      ) : null}
    </div>
  );
}, sameTurn);

function sameTurn(a: TurnProps, b: TurnProps): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof TurnProps)[];
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (key === "turn") {
      // Unchanged turns keep their array (groupTurnsStable): skip the block walk.
      if (
        a.turn !== b.turn &&
        (a.turn.length !== b.turn.length ||
          !a.turn.every((block, index) => block === b.turn[index]))
      ) {
        return false;
      }
    } else if (!Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/** Placeholder for private reasoning before the first assistant text arrives. */
function InitialThinking({ live, embedded = false }: { live: boolean; embedded?: boolean }) {
  const t = useT();
  return (
    <div
      className={`min-w-0 pt-3 pb-1 font-sans text-ui-body text-(--ui-text-secondary) ${embedded ? "" : "px-4"}`}
    >
      {live ? <Shimmer duration={1.6}>{t("Thinking…")}</Shimmer> : t("Thinking…")}
    </div>
  );
}

/**
 * The clock on a turn's fold line: how long the agent has been at it, or what
 * it is waiting on. The band that sweeps the text is sized off this element,
 * so it shrinks to the words — stretched across the row, the sweep spends its
 * time on empty space and the line just sits there looking dim.
 */
function LiveFoldTitle({
  startedAt,
  paused,
  waitingLabel,
  background,
  backgroundAgents,
  modelName,
}: {
  startedAt?: number;
  paused: boolean;
  waitingLabel?: string;
  background?: string[];
  backgroundAgents?: number;
  modelName?: string;
}) {
  const t = useT();
  const elapsedMs = useElapsedFrom(startedAt, paused);
  // Only commands are left (a dev server, a watcher): the agent is done, so
  // the line stops shimmering and counting rather than looking busy forever.
  if (!paused && background && isBackgroundOnly(true, background, backgroundAgents)) {
    return (
      <span
        className="min-w-0 truncate font-sans text-ui-body text-(--ui-text-secondary)"
        title={background.join("\n")}
      >
        {background.length === 1
          ? t("Finished · 1 command running in background")
          : t("Finished · {p0} commands running in background", { p0: background.length })}
      </span>
    );
  }
  // Yielding with a command still going is not the end of the turn. The clock
  // keeps running and the line says what it is waiting on.
  const text = paused
    ? (waitingLabel ?? "Waiting for approval")
    : background?.length
      ? `${formatWorkingDuration(elapsedMs, modelName)} · ${backgroundLabel(background)}`
      : formatWorkingDuration(elapsedMs, modelName);
  const shimmer = (
    <Shimmer className="min-w-0 truncate font-sans text-ui-body" duration={1}>
      {text}
    </Shimmer>
  );
  return background?.length ? (
    <span className="flex min-w-0" title={background.join("\n")}>
      {shimmer}
    </span>
  ) : (
    shimmer
  );
}

function backgroundLabel(tasks: string[]): string {
  return tasks.length === 1
    ? "running in background"
    : `${tasks.length} tasks running in background`;
}

/**
 * What a finished turn leaves under the answer: what you can do with it, and
 * when it landed. The clock lives on the fold line above, from the first token
 * to the last, so it is not repeated here.
 */
/** Explicit "load full output" control with pending, failure and retry states. */
function RemoteBlockLoad({
  blockId,
  revision,
  bytes,
  onLoad,
}: {
  blockId: string;
  revision: number;
  bytes: number;
  onLoad: (blockId: string, revision: number) => Promise<void> | void;
}) {
  const t = useT();
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = async () => {
    if (state === "pending") return;
    setState("pending");
    try {
      await onLoad(blockId, revision);
      if (mounted.current) setState("idle");
    } catch {
      if (mounted.current) setState("failed");
    }
  };
  return (
    <div className="mx-4 mb-1 flex items-center gap-2">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        loading={state === "pending"}
        disabled={state === "pending"}
        onClick={() => void load()}
      >
        {state === "pending" ? (
          t("Loading full output…")
        ) : state === "failed" ? (
          t("Retry")
        ) : (
          <>
            {t("Load full output (")}
            {Math.max(1, Math.ceil(bytes / 1024))}
            {t(" KB)")}
          </>
        )}
      </Button>
      {state === "failed" ? (
        <InlineError>{t("Could not load the full output.")}</InlineError>
      ) : null}
    </div>
  );
}

function TurnDuration({
  elapsedMs,
  metrics,
  labelHidden = false,
  modelName,
  harness,
  completedAt,
  turn,
  onSaveNote,
  fromHarness,
  fromModel,
  onSecondOpinion,
  onHandoff,
}: {
  elapsedMs: number | null;
  metrics?: TurnMetrics;
  /** True when the fold line above already keeps the time for this turn. */
  labelHidden?: boolean;
  modelName?: string;
  harness?: HarnessId;
  completedAt?: number;
  /** The turn's blocks; its text is only gathered when copy or save is used. */
  turn: Block[];
  onSaveNote?: (text: string) => void | Promise<void>;
  fromHarness?: HarnessId;
  /** The turn's own model, so a same-harness second opinion can hide it. */
  fromModel?: string;
  onSecondOpinion?: (target: ModelTarget) => void;
  onHandoff?: (target: ModelTarget) => void;
}) {
  const t = useT();
  const label = formatWorkingDuration(elapsedMs, modelName, true);
  const hasOutput = hasTurnCopyText(turn);
  const getText = useCallback(() => turnCopyText(turn), [turn]);
  const dot = (
    <span aria-hidden className="size-0.75 shrink-0 rounded-full bg-(--ui-tone-neutral-border)" />
  );
  return (
    <div
      aria-label={label}
      className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2.5 px-4 pt-1 pb-3 font-sans text-ui-body text-(--ui-text-secondary)"
    >
      <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {hasOutput ? null : turn.some(
            (block) => block.role === "user" && block.turnOutcome === "stopped",
          ) ? (
          <X className="icon-sm" strokeWidth={1.75} />
        ) : (
          <Check className="icon-sm" strokeWidth={1.75} />
        )}
        <TurnOutputActions
          getText={hasOutput ? getText : undefined}
          onSave={onSaveNote}
          extraItems={[
            ...(fromHarness && onHandoff
              ? [
                  {
                    id: "handoff",
                    label: t("Handoff"),
                    icon: <Replace />,
                    render: (renderTrigger) => (
                      <HandoffButton
                        from={fromHarness}
                        onPick={onHandoff}
                        renderTrigger={renderTrigger}
                      />
                    ),
                  } satisfies FloatingButtonGroupAction,
                ]
              : []),
            ...(fromHarness && onSecondOpinion
              ? [
                  {
                    id: "second-opinion",
                    label: t("Second opinion"),
                    icon: <MessageMultiple />,
                    render: (renderTrigger) => (
                      <SecondOpinionButton
                        from={fromHarness}
                        fromModel={fromModel}
                        onPick={onSecondOpinion}
                        includeCurrent
                        excludeFromModel
                        renderTrigger={renderTrigger}
                      />
                    ),
                  } satisfies FloatingButtonGroupAction,
                ]
              : []),
            ...(metrics && hasTurnMetrics(metrics)
              ? [
                  {
                    id: "metrics",
                    label: t("Turn metrics"),
                    icon: <ChartBreakoutSquare />,
                    render: (renderTrigger) => (
                      <TurnMetricsBadge
                        metrics={metrics}
                        elapsedMs={elapsedMs}
                        renderTrigger={renderTrigger}
                      />
                    ),
                  } satisfies FloatingButtonGroupAction,
                ]
              : []),
          ]}
        />
      </span>
      {labelHidden ? null : (
        <span className="flex min-w-0 items-center gap-2.5">
          {dot}
          <span className="flex min-w-0 items-center gap-1.5">
            {harness ? <HarnessIcon harness={harness} className="size-3.5 shrink-0" /> : null}
            <OverflowTooltip label={label}>
              <span className="min-w-0 truncate">{label}</span>
            </OverflowTooltip>
          </span>
        </span>
      )}
      {completedAt != null ? (
        <span className="flex shrink-0 items-center gap-2.5">
          {dot}
          <Timestamp value={completedAt} className="shrink-0 text-(--ui-text-secondary)" />
        </span>
      ) : null}
    </div>
  );
}

function TurnMetricsBadge({
  metrics,
  elapsedMs,
  renderTrigger,
}: {
  metrics?: TurnMetrics;
  elapsedMs: number | null;
  renderTrigger?: (props: FloatingButtonGroupTriggerProps) => ReactNode;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  if (!metrics || !hasTurnMetrics(metrics)) return null;

  const outputRate =
    metrics.outputTokens != null && elapsedMs != null && elapsedMs > 0
      ? metrics.outputTokens / (elapsedMs / 1000)
      : undefined;
  const headline =
    [
      metrics.cacheHitPercent != null ? `Cache hit ${Math.round(metrics.cacheHitPercent)}%` : null,
      outputRate != null ? `Output ${formatMetricCount(outputRate)} tok/s` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Turn tokens";
  const detail = [
    metrics.inputTokens != null ? `${formatMetricCount(metrics.inputTokens)} input` : null,
    metrics.outputTokens != null ? `${formatMetricCount(metrics.outputTokens)} output` : null,
    metrics.cacheReadTokens != null ? `${formatMetricCount(metrics.cacheReadTokens)} cached` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = [headline, detail].filter(Boolean).join(". ");

  return (
    <div
      ref={root}
      className="relative shrink-0"
      onMouseEnter={() => {
        if (!renderTrigger) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        if (!renderTrigger) setHovered(true);
      }}
      onBlur={() => setHovered(false)}
    >
      {renderTrigger ? (
        renderTrigger({
          ref: setButton,
          ariaLabel: t("Turn metrics: {p0}", { p0: label }),
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          onSelect: () => setOpen((value) => !value),
        })
      ) : (
        <Button
          variant="ghost"
          iconOnly
          label={t("Turn metrics: {p0}", { p0: label })}
          tooltip={t("Turn metrics")}
        >
          <ChartBreakoutSquare className="icon-sm" strokeWidth={1.75} />
        </Button>
      )}
      {(renderTrigger ? open : hovered) ? (
        <Popover
          anchor={renderTrigger ? button : root}
          side="top"
          align="start"
          role={renderTrigger ? "dialog" : undefined}
          aria-label={t("Turn metrics")}
          onDismiss={
            renderTrigger
              ? (reason) => {
                  setOpen(false);
                  if (reason === "escape") button?.focus();
                }
              : undefined
          }
          className="w-max px-2.5 py-1.5"
        >
          <div className="text-ui-caption leading-4 text-(--ui-tone-neutral-fg)">{headline}</div>
          {detail ? (
            <div className="text-ui-micro leading-4 text-(--ui-text-secondary)">{detail}</div>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

function hasTurnMetrics(metrics: TurnMetrics): boolean {
  return (
    metrics.cacheHitPercent != null ||
    (metrics.inputTokens ?? 0) > 0 ||
    (metrics.outputTokens ?? 0) > 0 ||
    (metrics.cacheReadTokens ?? 0) > 0 ||
    (metrics.cacheWriteTokens ?? 0) > 0
  );
}

function formatMetricCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(Math.max(0, Math.round(value)));
}

function CopyTurnButton({
  text,
  getText,
  attachments,
  label: labelProp,
  showLabel = false,
}: {
  text?: string;
  /** Gathers the text on click, for text that is costly to build each render. */
  getText?: () => string;
  attachments?: Attachment[];
  label?: string;
  showLabel?: boolean;
}) {
  const t = useT();
  const label = labelProp ?? t("Copy response");
  const {
    pending,
    copied,
    error,
    copy: runCopy,
  } = useCopyFeedback({ resetKeys: [text, getText, attachments], successMs: 2000 });

  return (
    <>
      <Button
        iconOnly={!showLabel}
        label={copied ? t("Copied") : label}
        motion="none"
        variant="ghost"
        type="button"
        disabled={pending}
        tooltip={copied ? t("Copied") : label}
        aria-label={copied ? t("Copied") : label}
        loading={pending}
        startIcon={
          showLabel ? (
            copied ? (
              <Check className="icon-sm" strokeWidth={1.75} />
            ) : (
              <Copy className="icon-sm" strokeWidth={1.75} />
            )
          ) : undefined
        }
        onClick={(event) => {
          event.stopPropagation();
          runCopy(async () => {
            await copyMessage(text ?? getText?.() ?? "", attachments);
            // The confirmation sound belongs to a copy that actually landed.
            playCue("copy");
          });
        }}
      >
        {!showLabel &&
          (copied ? (
            <Check className="icon-sm" strokeWidth={1.75} />
          ) : (
            <Copy className="icon-sm" strokeWidth={1.75} />
          ))}
        {showLabel ? <span>{copied ? t("Copied") : label}</span> : null}
      </Button>
      {error && (
        <InlineError className="max-w-xs">
          {t("Copy failed. ")}
          {error}
        </InlineError>
      )}
    </>
  );
}

function SaveNoteButton({
  text,
  getText,
  onSave,
  showLabel = false,
}: {
  text?: string;
  getText?: () => string;
  onSave: (text: string) => void | Promise<void>;
  showLabel?: boolean;
}) {
  const t = useT();
  const {
    pending,
    copied: saved,
    error,
    copy: runSave,
  } = useCopyFeedback({ resetKeys: [text, getText], successMs: 2000 });

  return (
    <>
      <Button
        iconOnly={!showLabel}
        label={saved ? t("Saved to Notes") : t("Save as note")}
        motion="none"
        variant="ghost"
        type="button"
        disabled={pending}
        tooltip={saved ? t("Saved to Notes") : t("Save as note")}
        aria-label={saved ? t("Saved to Notes") : t("Save as note")}
        loading={pending}
        startIcon={
          showLabel ? (
            saved ? (
              <Check className="icon-sm" strokeWidth={1.75} />
            ) : (
              <FilePlusCorner className="icon-sm" strokeWidth={1.75} />
            )
          ) : undefined
        }
        onClick={() => {
          runSave(async () => {
            await onSave(text ?? getText?.() ?? "");
            playCue("copy");
          });
        }}
      >
        {!showLabel &&
          (saved ? (
            <Check className="icon-sm" strokeWidth={1.75} />
          ) : (
            <FilePlusCorner className="icon-sm" strokeWidth={1.75} />
          ))}
        {showLabel ? <span>{saved ? t("Saved to Notes") : t("Save as note")}</span> : null}
      </Button>
      {error && (
        <InlineError className="max-w-xs">
          {t("Could not save note. ")}
          {error}
        </InlineError>
      )}
    </>
  );
}

function MessageEditMenu({
  onEdit,
  editing = false,
  dismiss,
}: {
  onEdit?: () => void;
  editing?: boolean;
  dismiss?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = t("Message actions");
  const items: DropdownMenuItem[] = onEdit
    ? [
        {
          kind: "item",
          id: "resend",
          label: editing ? t("Cancel edit") : t("Edit and resend"),
          icon: <Pencil />,
        } satisfies DropdownMenuItem,
      ]
    : [];
  return (
    <>
      <Button
        ref={trigger}
        motion="none"
        iconOnly
        label={label}
        tooltip={label}
        variant="ghost"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={label}
          items={items}
          returnFocusRef={trigger}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            if (id === "resend") {
              dismiss?.();
              onEdit?.();
            }
          }}
        />
      ) : null}
    </>
  );
}

const TranscriptBlock = memo(function TranscriptBlock({
  block,
  revealOnMount,
  layout,
  visible,
  stickyIndex,
  underLine = false,
  embedded = false,
  cwd,
  onApproval,
  onSaveNote,
  onSendDraft,
  onEditDraft,
  onRemoveDraft,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  planBusy,
  planHarness,
  planModel,
  planModelSettings,
  onEditLastTurn,
  canRewindMessage,
  onRewindMessage,
  editing = false,
}: {
  block: Block;
  layout: TranscriptLayout;
  revealOnMount?: boolean;
  visible?: boolean;
  stickyIndex: number;
  /** True when something already sits directly above this in the turn. */
  underLine?: boolean;
  /** True when the parent surface already provides the horizontal gutter. */
  embedded?: boolean;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onEditDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  planBusy?: boolean;
  planHarness?: HarnessId;
  planModel?: string;
  planModelSettings?: Record<string, string>;
  onEditLastTurn?: () => void;
  canRewindMessage?: (blockId: string) => boolean;
  onRewindMessage?: (block: Block, action: "edit" | "return") => void;
  editing?: boolean;
}) {
  const t = useT();
  if (block.role === "user") {
    if (block.questionAnswers?.length) {
      return (
        <div
          data-question-answer
          role="group"
          aria-label={t("Question and answer")}
          className="mx-4 mb-4 min-w-0 rounded-lg bg-(--ui-surface) px-3 py-2 font-sans text-(--ui-tone-neutral-fg)"
        >
          <span className="sr-only">{t("Answered")}</span>
          {block.questionAnswers.map(({ prompt, answers }, index) => (
            <div
              key={index}
              className={`flex min-w-0 flex-col gap-1 ${index ? "mt-3 border-t border-(--ui-tone-neutral-border) pt-3" : ""}`}
            >
              <section
                aria-label={t("AI question")}
                className="flex min-w-0 items-start gap-2 text-(--ui-text-secondary)"
              >
                <Check aria-hidden="true" className="mt-0.5 icon-sm shrink-0" />
                <p className="min-w-0 whitespace-pre-wrap break-words text-ui-caption leading-relaxed">
                  {prompt}
                </p>
              </section>
              <section className="min-w-0 ps-5.5" aria-label={t("Your answer")}>
                <UserMessageBlock
                  questionAnswer
                  block={{ ...block, text: answers.join("\n"), questionAnswers: undefined }}
                  layout={layout}
                  visible={visible ?? true}
                  stickyIndex={stickyIndex}
                  cwd={cwd}
                  onSaveNote={onSaveNote}
                  canRewind={canRewindMessage?.(block.id) ?? false}
                  onRewind={
                    onRewindMessage ? (action) => onRewindMessage(block, action) : undefined
                  }
                />
              </section>
            </div>
          ))}
        </div>
      );
    }
    return (
      <UserMessageBlock
        block={block}
        layout={layout}
        busy={planBusy}
        visible={visible ?? true}
        stickyIndex={stickyIndex}
        cwd={cwd}
        onEdit={onEditLastTurn}
        canRewind={canRewindMessage?.(block.id) ?? false}
        onRewind={onRewindMessage ? (action) => onRewindMessage(block, action) : undefined}
        editing={editing}
        onSaveNote={onSaveNote}
        onSendDraft={onSendDraft}
        onEditDraft={onEditDraft}
        onRemoveDraft={onRemoveDraft}
      />
    );
  }

  if (block.role === "image") {
    return block.image ? <GeneratedImage image={block.image} /> : null;
  }

  if (block.role === "tool") {
    if (block.inlineVisual) return <InlineVisual snapshot={block.inlineVisual} />;
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        embedded={embedded}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "reasoning") {
    return null;
  }

  if (block.role === "tasks") {
    if (!block.taskList?.items.length) return null;
    return (
      <div className={embedded ? "py-1" : "px-4 py-1"}>
        <TaskListPreview items={block.taskList.items} explanation={block.taskList.explanation} />
      </div>
    );
  }

  if (block.role === "plan") {
    if (block.orchestration) return null;
    const legacyTasks = legacyTaskListFromText(block.text);
    if (legacyTasks) {
      return (
        <div className={embedded ? "py-1" : "px-4 py-1"}>
          <TaskListPreview items={legacyTasks} />
        </div>
      );
    }
    return (
      <div className={embedded ? "py-1" : "px-4 py-1"}>
        <PlanPreview
          text={block.text}
          streaming={block.streaming}
          busy={planBusy}
          plan={block.plan}
          harness={planHarness}
          model={planModel}
          modelSettings={planModelSettings}
          onOpen={onOpenPlan ? () => onOpenPlan(block.id) : undefined}
          onBuild={onBuildPlan ? (target) => onBuildPlan(block.id, target) : undefined}
        />
      </div>
    );
  }

  if (block.role === "approval") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        embedded={embedded}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "handoff") {
    return <HandoffDivider block={block} />;
  }

  if (block.role === "system") {
    const text = isTurnInterruptMessage(block.text) ? INTERRUPT_MESSAGE : block.text;
    if (block.interjection) {
      return <InterjectionDivider block={block} />;
    }
    if (block.shell) {
      return <ShellRunCard run={block.shell} embedded={embedded} />;
    }
    return (
      <div
        role={isSessionErrorBlock(block) ? "alert" : undefined}
        className={`${embedded ? "" : "px-4"} py-2 ${block.notice === "interrupt" ? "font-bold text-(--ui-tone-danger-fg)" : isSessionErrorBlock(block) ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
      >
        <pre className="min-w-0 whitespace-pre-wrap break-words">{text}</pre>
      </div>
    );
  }

  if (!block.text && block.streaming) return null;

  return (
    <div
      data-selectable-agent-response={block.streaming ? undefined : block.id}
      className={`min-w-0 pb-1 text-(--ui-tone-neutral-fg) ${embedded ? "" : "px-4"} ${underLine ? "pt-1" : "pt-3"}`}
    >
      <AgentMarkdown
        text={block.text}
        streaming={block.streaming}
        revealOnMount={revealOnMount}
        localMedia
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});

/** A `!command` the user ran from the composer, and what it printed. */
function ShellRunCard({ run, embedded }: { run: ShellRun; embedded?: boolean }) {
  useLocale();
  const status = run.running
    ? null
    : run.timedOut
      ? "timed out"
      : run.exitCode === null
        ? "did not finish"
        : run.exitCode !== 0
          ? `exit ${run.exitCode}`
          : null;
  return (
    <div className={`${embedded ? "" : "px-4"} py-2`}>
      <div
        data-shell-run
        className="overflow-hidden rounded-lg border border-(--color-stroke) bg-(--ui-surface-panel) font-mono text-ui-caption leading-5"
      >
        <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
          <Terminal
            className="mt-1 icon-xs shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-(--ui-tone-neutral-fg)">
            {run.command}
          </span>
          {run.running ? (
            <Spinner size="xs" className="shrink-0" />
          ) : status ? (
            <span
              className={`shrink-0 text-ui-micro ${run.timedOut ? "text-(--ui-tone-warning-fg)" : "text-(--ui-tone-danger-fg)"}`}
            >
              {status}
            </span>
          ) : null}
        </div>
        {run.output.trim() ? (
          <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words border-t border-(--ui-tone-neutral-border) px-3 py-2 text-(--ui-text-secondary)">
            {run.output.trimEnd()}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function UserMessageBlock({
  block,
  layout,
  visible,
  stickyIndex,
  onEdit,
  canRewind = false,
  onRewind,
  editing = false,
  cwd,
  onSaveNote,
  onSendDraft,
  onEditDraft,
  onRemoveDraft,
  busy = false,
  questionAnswer = false,
}: {
  block: Block;
  layout: TranscriptLayout;
  visible: boolean;
  stickyIndex: number;
  onEdit?: () => void;
  canRewind?: boolean;
  onRewind?: (action: "edit" | "return") => void;
  editing?: boolean;
  cwd?: string;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onEditDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  busy?: boolean;
  questionAnswer?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useRetainedDisclosure<boolean>(`prompt:${block.id}`, false);
  const [ciOpen, setCiOpen] = useRetainedDisclosure<boolean>(`ci:${block.id}`, false);
  const textRef = useRef<HTMLElement>(null);
  const card = block.secondOpinion;
  const note = block.noteCard;
  const delivery = block.draft ? block.followUpDelivery : undefined;
  const deliveryActive = delivery === "pending" || Boolean(delivery && busy);
  const deliveryDescription =
    delivery === "pending"
      ? t("This follow-up is still being delivered. Wait before retrying or removing it.")
      : delivery === "undelivered"
        ? t("This follow-up was not delivered. Retry when the active turn finishes.")
        : delivery === "uncertain"
          ? t(
              "This follow-up may already have been delivered. Inspect the conversation before retrying.",
            )
          : undefined;
  const deliveryLabel =
    delivery === "pending"
      ? t("Sending...")
      : delivery === "undelivered"
        ? t("Not delivered")
        : delivery === "uncertain"
          ? deliveryDescription
          : t("Draft");
  const heldActionTitle =
    delivery === "pending"
      ? deliveryDescription
      : t("Wait for the active turn to finish before retrying or removing this follow-up.");
  const bycoda = isOperatorUserTurn(block);
  const rawText =
    card && card.kind !== "handoff"
      ? ""
      : visibleUserPrompt(bycoda ? operatorUserPrompt(block) : block.text);
  const { text, citations } = useMemo(() => extractChatCitations(rawText), [rawText]);
  const messageLink = text ? parseUserMessageLink(text) : null;
  const displayText = messageLink ? `${messageLink.beforeText}${messageLink.afterText}` : text;
  const chat = layout === "chat";
  const previewParts = useMemo(() => userTextParts(text), [text]);
  const compactText = previewParts.some((part) => part.compact);
  // A chip carries its token's label only when the message mentions it, so
  // messages sent before tokens existed look as they always did.
  const referencedTokens = useMemo(() => {
    const files = block.attachments ?? [];
    const tokens = attachmentTokens(files);
    const used = new Set(findTokens(text, files).map((match) => match.index));
    return tokens.map((token, index) => (used.has(index) ? token : undefined));
  }, [block.attachments, text]);
  const overflows = useClampOverflow(
    textRef,
    Boolean(text),
    expanded,
    text,
    (visible ? 1 : 0) + (compactText ? 2 : 0),
  );

  const toggle = () => {
    if (overflows) setExpanded((value) => !value);
  };

  const renderMessageActions = (dismiss?: () => void, showLabels = false) => (
    <>
      {text || block.attachments?.length ? (
        <CopyTurnButton
          text={text}
          attachments={block.attachments}
          label={t("Copy message")}
          showLabel={showLabels}
        />
      ) : null}
      {text && onSaveNote ? (
        <SaveNoteButton text={text} onSave={onSaveNote} showLabel={showLabels} />
      ) : null}
      {onRewind && !block.draft && !block.internal ? (
        <Button
          motion="none"
          iconOnly={!showLabels}
          label={t("Edit from here")}
          tooltip={
            canRewind ? t("Edit from here") : t("This conversation can no longer be rewound.")
          }
          variant="ghost"
          type="button"
          disabled={!canRewind}
          startIcon={<Pencil />}
          onClick={(event) => {
            event.stopPropagation();
            dismiss?.();
            onRewind("edit");
          }}
        >
          {showLabels ? <span>{t("Edit from here")}</span> : null}
        </Button>
      ) : null}
      {onEdit ? <MessageEditMenu onEdit={onEdit} editing={editing} dismiss={dismiss} /> : null}
      {block.startedAt != null ? (
        <Timestamp
          value={block.startedAt}
          className="ms-1 whitespace-nowrap font-sans text-ui-caption text-(--ui-text-secondary)"
        />
      ) : null}
    </>
  );

  return (
    <div
      data-prompt-anchor={block.id}
      data-editing-last-turn={editing ? "true" : undefined}
      className={`user-message-row group/usermsg flex min-w-0 flex-col overflow-visible ${questionAnswer ? "" : "items-end pbs-1.5 pe-4 pbe-5 ps-14"}`}
    >
      <SessionMessageAuthor
        author={block.author}
        onOpen={
          block.author?.kind === "assistant" || block.author?.kind === "assistant-manual"
            ? () =>
                window.dispatchEvent(
                  new CustomEvent("bycoda:open-assistant", {
                    detail: {
                      tab: "history",
                      ...(block.author?.kind === "assistant"
                        ? { jobId: block.author.jobId }
                        : block.author?.kind === "assistant-manual"
                          ? { supervisionId: block.author.supervisionId }
                          : {}),
                    },
                  }),
                )
            : undefined
        }
      />
      {/* Give actions the pane width while the bubble keeps its content width. */}
      <div
        className={`user-message-hover-zone flex w-full min-w-0 max-w-full flex-col overflow-visible ${questionAnswer ? "" : "items-end"}`}
      >
        <div
          data-draft={block.draft ? "true" : undefined}
          data-follow-up-delivery={delivery}
          data-bycoda={bycoda ? "true" : undefined}
          className={
            questionAnswer
              ? "relative min-w-0 text-(--ui-tone-neutral-fg)"
              : `user-message-bubble relative min-w-0 border border-(--color-stroke) px-3 py-2 font-sans text-(--ui-tone-neutral-fg) transition-[background-color] duration-200 ${
                  block.draft
                    ? "border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)"
                    : "bg-(--ui-surface)"
                } ${editing ? "edit-last-turn-bubble" : ""} w-fit ${chat ? "max-w-[min(100%,36rem)]" : "max-w-full"} rounded-xl`
          }
          style={{ zIndex: stickyIndex }}
        >
          <ChatCitationList citations={citations} />
          {block.turnOutcome === "stopped" ? (
            <Badge tone="neutral" className="mb-1">
              {t("Stopped by you")}
            </Badge>
          ) : null}
          {block.attachments?.length ? (
            <div
              role="group"
              aria-label={t("Attachments")}
              className={`user-message-attachments flex min-w-0 max-w-full gap-2 overflow-x-auto ${text || card || note ? "mbe-2" : ""}`}
            >
              {block.attachments.map((file, index) => (
                <AttachmentChip key={file.id} attachment={file} token={referencedTokens[index]} />
              ))}
            </div>
          ) : null}
          {note ? (
            <div className={text || card ? "mb-2" : ""}>
              <NoteMiniCard card={note} embedded />
            </div>
          ) : null}
          {card ? (
            <div className={text ? "mb-1.5" : undefined}>
              <SecondOpinionCard card={card} />
            </div>
          ) : null}
          {compactText ? (
            <UserTextPreview
              parts={previewParts}
              messageId={block.id}
              attachments={block.attachments}
              renderActions={renderMessageActions}
            />
          ) : messageLink ? (
            <div
              ref={(element) => {
                textRef.current = element;
              }}
              className="user-message-with-link min-w-0 whitespace-pre-wrap break-words font-sans text-ui-body"
              data-selectable-agent-response={block.id}
            >
              <AttachmentTokenText text={messageLink.beforeText} attachments={block.attachments} />
              <UserLinkPreview link={messageLink.link} cwd={cwd} compact />
              <AttachmentTokenText text={messageLink.afterText} attachments={block.attachments} />
            </div>
          ) : displayText ? (
            <pre
              data-selectable-agent-response={block.id}
              ref={(element) => {
                textRef.current = element;
              }}
              className={`min-w-0 whitespace-pre-wrap break-words font-sans text-ui-body ${expanded || questionAnswer ? "" : "line-clamp-4"}`}
            >
              <AttachmentTokenText text={displayText} attachments={block.attachments} />
            </pre>
          ) : null}
          {overflows && !compactText ? (
            <Button
              motion="none"
              variant="ghost"
              type="button"
              aria-expanded={expanded}
              className="mt-1"
              onClick={toggle}
            >
              {expanded ? t("Show less") : t("Show more")}
            </Button>
          ) : null}
          {block.ciContext ? (
            <details
              open={ciOpen}
              onToggle={(event) => setCiOpen(event.currentTarget.open)}
              className="group/ci mt-2 min-w-0 border-t border-(--ui-tone-neutral-border) pt-2"
              onClick={(event) => event.stopPropagation()}
            >
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-ui-caption text-(--ui-text-secondary) transition-colors hover:text-(--ui-text-secondary) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--ui-focus-ring-color) [&::-webkit-details-marker]:hidden">
                <ChevronRight className="icon-xs shrink-0 transition-transform group-open/ci:rotate-90" />
                <span>{t("CI context")}</span>
              </summary>
              <p className="mt-2 text-ui-caption text-(--ui-text-secondary)">
                {t("CI instructions and failure details included with this request.")}
              </p>
              <pre className="mt-2 max-h-72 min-w-0 overflow-auto overscroll-contain rounded-md bg-(--ui-surface-raised) p-2.5 font-mono text-ui-micro leading-relaxed whitespace-pre-wrap break-words text-(--ui-text-secondary)">
                {block.ciContext}
              </pre>
            </details>
          ) : null}
          {block.draft ? (
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-(--color-stroke) pt-2">
              <span
                className="flex items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)"
                role={delivery ? "status" : undefined}
                title={deliveryDescription}
              >
                <CircleDashed className="icon-sm" strokeWidth={1.75} />
                {deliveryLabel}
              </span>
              <span className="flex items-center gap-1">
                {onEditDraft ? (
                  <Button
                    motion="none"
                    variant="ghost"
                    type="button"
                    tooltip={deliveryActive ? heldActionTitle : t("Edit draft")}
                    aria-label={t("Edit draft")}
                    disabled={deliveryActive}
                    onClick={() => onEditDraft(block)}
                  >
                    <Pencil className="icon-sm" strokeWidth={1.75} />
                    {t("Edit")}
                  </Button>
                ) : null}
                <Button
                  motion="none"
                  variant="ghost"
                  type="button"
                  tooltip={deliveryActive ? heldActionTitle : t("Remove draft")}
                  aria-label={t("Remove draft")}
                  disabled={deliveryActive}
                  onClick={() => onRemoveDraft?.(block)}
                >
                  <Trash2 className="icon-sm" strokeWidth={1.75} />
                  {t("Remove")}
                </Button>
                <Button
                  motion="none"
                  variant="ghost"
                  type="button"
                  tooltip={deliveryActive ? heldActionTitle : t("Send draft")}
                  aria-label={t("Send draft")}
                  disabled={deliveryActive}
                  onClick={() => onSendDraft?.(block)}
                >
                  {t("Send")}
                  <ArrowUp className="icon-sm" strokeWidth={2} />
                </Button>
              </span>
            </div>
          ) : null}
          {bycoda ? (
            <BycodaSparkles blockId={block.id} startedAt={block.startedAt} />
          ) : block.intent === "plan" ? (
            <PlanStepsBurst blockId={block.id} startedAt={block.startedAt} />
          ) : block.intent === "orchestrate" ? (
            <OrchestratorConstellation blockId={block.id} startedAt={block.startedAt} />
          ) : null}
        </div>
        {text || block.attachments?.length || block.startedAt != null || onEdit || onRewind ? (
          <div className="user-message-actions flex max-w-full flex-wrap items-center justify-end gap-1 px-3 pt-1">
            {renderMessageActions()}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type FoldAnimation = { target: boolean; settled: boolean };

const settleFold = (current: FoldAnimation): FoldAnimation =>
  current.settled ? current : { ...current, settled: true };

/**
 * Animate one fold, then release its contents. Closed work must not retain
 * a component and DOM tree for every tool; only expansion builds those rows.
 * Visible rows stay out of Grid so they rewrap when their pane changes width.
 */
function TurnRow({
  folded,
  children,
}: {
  folded: boolean;
  children: ReactNode | (() => ReactNode);
}) {
  useLocale();
  // `target` is the fold the animation is heading for; `settled` is false from
  // the moment it changes until the animation ends. Adjusting while rendering
  // starts the animation in the same commit as the new `folded` value.
  const [fold, setFold] = useState<FoldAnimation>({ target: folded, settled: true });
  if (fold.target !== folded) setFold({ target: folded, settled: false });
  const foldState: "open" | "opening" | "closing" | "closed" = fold.settled
    ? folded
      ? "closed"
      : "open"
    : folded
      ? "closing"
      : "opening";

  useEffect(() => {
    if (fold.settled) return;
    // Hidden tabs and reduced-motion styles may never fire animationend.
    const timer = window.setTimeout(() => setFold(settleFold), 350);
    return () => window.clearTimeout(timer);
  }, [fold]);

  if (folded && foldState === "closed") return null;

  return (
    // `inert` keeps folded work out of tab order and off the screen reader.
    <div
      className="zen-fold-item"
      data-fold-state={foldState}
      inert={folded}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        setFold(settleFold);
      }}
    >
      {/* Keep padding off the Grid item itself. Otherwise its 4px bottom
       * padding survives a 0fr track and every folded row leaves a gap. */}
      <div>
        <div className="pb-1">{typeof children === "function" ? children() : children}</div>
      </div>
    </div>
  );
}

/** A turn item's identity, stable as the group it names grows. */
function turnItemKey(item: TurnItem): string {
  return item.type === "block" ? item.block.id : item.blocks[0].id;
}

/**
 * The line a turn's work folds behind: the harness mark, and the clock —
 * ticking while the agent works, how long it took once it is done. Everything
 * the fold holds stays one click away, so the settled transcript reads as
 * prompt, answer, and a receipt for the work in between.
 */
function WorkFoldLine({
  title,
  kind,
  harness,
  live = false,
  expandable,
  open,
  onToggle,
}: {
  title: ReactNode;
  kind: ActivityPhaseKind;
  harness?: HarnessId;
  live?: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const icon = (
    <span className="relative flex size-3.5 shrink-0 items-center justify-center">
      {open ? (
        // Open, the chevron stays put: it is the way back, and hunting for it
        // under the cursor is no way to close what you opened.
        <ChevronRight className="icon-sm rotate-90 text-(--ui-text-secondary)" strokeWidth={1.75} />
      ) : (
        <>
          {harness ? (
            <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
          ) : (
            <ActivityPhaseIcon kind={kind} />
          )}
        </>
      )}
    </span>
  );
  // While the agent runs, the clock shimmers here rather than at the bottom,
  // which is now bare.
  const label = live ? (
    title
  ) : (
    <span className="min-w-0 flex-1 truncate font-sans text-ui-body text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
      {title}
    </span>
  );
  const row = `flex w-full min-w-0 items-center gap-1.5 px-4 py-1 text-left${
    open ? " zen-fold-drop" : ""
  }`;

  if (!expandable) {
    return (
      <div
        className={`group ${row}`}
        role={live ? "status" : undefined}
        aria-live={live ? "polite" : undefined}
      >
        {icon}
        {label}
      </div>
    );
  }
  return (
    <Button
      motion="none"
      variant="ghost"
      type="button"
      selected={open}
      aria-expanded={open}
      aria-label={open ? t("Hide the work") : t("Show the work")}
      aria-live={live ? "polite" : undefined}
      onClick={onToggle}
    >
      {icon}
      {label}
      {open ? null : (
        <ChevronRight className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
      )}
    </Button>
  );
}

function lastUserBlockId(blocks: Block[], managed = false): string | undefined {
  return turnUserBlock(blocks, managed)?.id;
}

function turnUserBlock(blocks: Block[], managed = false): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && (managed || !block.internal)) return block;
  }
  return undefined;
}

/**
 * When the live turn's clock started. A message sent while the agent is still
 * going (a steer, or a reply while background work runs) joins that run and
 * carries no clock of its own, so the clock keeps the time of the prompt that
 * started it. Without that the clock falls back to when it was drawn, and
 * starts over every time the transcript is shown again.
 */
function turnClockStart(blocks: Block[], userBlock: Block | undefined): number | undefined {
  if (!userBlock || userBlock.startedAt != null) return userBlock?.startedAt;
  for (let i = blocks.indexOf(userBlock) - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && block.startedAt != null) {
      return block.startedAt;
    }
  }
  return undefined;
}

function userTurnCount(blocks: Block[], managed = false): number {
  return blocks.filter((block) => block.role === "user" && (managed || !block.internal)).length;
}

const PROMPT_RISE_MS = 560;
// Keep in sync with the prompt-turn-reveal animation in index.css.
const PROMPT_REVEAL_MS = 320;
const PROMPT_FADE_MS = 480;
// Where the prompt starts, as a fraction of the viewport height from the top.
const PROMPT_RISE_FROM = 0.3;

/** Fades the prompt in while sliding it from the upper viewport to its row. */
function riseIntoAnchor(scroller: HTMLElement | null, blockId: string) {
  const row = scroller?.querySelector<HTMLElement>(`[data-prompt-anchor="${CSS.escape(blockId)}"]`);
  if (!scroller || !row || typeof row.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const view = scroller.getBoundingClientRect();
  const dy = view.top + view.height * PROMPT_RISE_FROM - row.getBoundingClientRect().top;
  if (dy <= 1) return;
  const animation = row.animate(
    [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
    { duration: PROMPT_RISE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
  // The fade gets its own gentler curve; on the rise's sharp ease-out it
  // would be over before the eye catches it.
  const fade = row.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: PROMPT_FADE_MS,
    easing: "ease-out",
  });
  // The rest of the turn waits until the prompt lands, then fades in.
  const turn = row.closest<HTMLElement>(".transcript-turn");
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  turn?.setAttribute("data-prompt-rise", "rising");
  animation.onfinish = () => {
    turn?.setAttribute("data-prompt-rise", "revealing");
    revealTimer = setTimeout(() => turn?.removeAttribute("data-prompt-rise"), PROMPT_REVEAL_MS);
  };
  return () => {
    animation.cancel();
    fade.cancel();
    clearTimeout(revealTimer);
    turn?.removeAttribute("data-prompt-rise");
  };
}

/** Selection gestures update the floating actions, never regroup the transcript. */
const TranscriptSelectionActions = memo(function TranscriptSelectionActions({
  root,
  enabled,
  onAddToChat,
  onAddToNotes,
  onTranslate,
  sessionId,
  blocks,
}: {
  root: HTMLElement | null;
  enabled: boolean;
  sessionId?: string;
  blocks: Block[];
  onAddToChat?: (text: string) => void;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onTranslate?: (selection: TranscriptSelection, target: TextActionTarget) => void;
}) {
  const { selection, dismissSelection } = useTranscriptSelection(root, enabled);
  const translate = useStableCallback(
    onTranslate && selection ? (target: TextActionTarget) => onTranslate(selection, target) : undefined,
  );
  return (
    <TranscriptSelectionMenu
      selection={selection}
      sessionId={sessionId}
      allowReprompt={blocks.some(
        (block) => block.id === selection?.responseId && block.role === "user",
      )}
      onDismiss={dismissSelection}
      onAddToChat={onAddToChat}
      onAddToNotes={onAddToNotes}
      onTranslate={translate}
    />
  );
}, (previous, next) =>
  previous.root === next.root &&
  previous.enabled === next.enabled &&
  previous.sessionId === next.sessionId &&
  previous.onAddToChat === next.onAddToChat &&
  previous.onAddToNotes === next.onAddToNotes &&
  previous.onTranslate === next.onTranslate &&
  sameBlocksIgnoringStreamingText(previous.blocks, next.blocks),
);
