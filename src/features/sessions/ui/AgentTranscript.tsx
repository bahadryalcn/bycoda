import { TranscriptHistoryNotice } from "./TranscriptHistoryNotice";
import { innerScrollerTakes } from "../../../shared/hooks/useLockOverscroll";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { JumpRelay } from "./transcriptJumpRelay";
import { FrameMemory } from "./transcriptFrameMemory";
import { SeenOutput } from "./transcriptSeenOutput";
import { OwnerApprovalChat } from "../../notifications";
import {
  captureCodeDisclosure,
  stableCodeDisclosureIdentity,
} from "./stableCodeDisclosureIdentity";
import { flushSync } from "react-dom";
import { TranscriptVirtualRows, type TranscriptVirtualRow } from "./TranscriptVirtualRows";
import { TranscriptRowCache } from "./transcriptRowCache";
import {
  TranscriptVirtualization,
  TranscriptVirtualizationContext,
  useTranscriptActiveBlocksVersion,
} from "./transcriptVirtualization";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { DelegationNoticeRow, SessionMessageAuthor } from "./SessionMessageAuthor";
import { InlineError } from "../../../shared/ui/InlineError";
import { ApprovalDecisionProvider, type ApprovalDispatch } from "./ApprovalDecisionContext";
import { InlineVisual } from "./InlineVisual";
import { InlineVisualHost, type InlineVisualHostRoute } from "../hooks/useInlineVisualSource";
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
import { resolveTranscriptSelection, type TranscriptSelection } from "../model/transcriptSelection";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { INTERRUPT_MESSAGE, isTurnInterruptMessage } from "../model/inFlight";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { filterDisplayedBlocks, type DisplayFilterFrame } from "../model/transcriptDisplayFilter";
import { SessionErrorNotice } from "./SessionErrorNotice";
import { useFormat, useLocale, useT } from "../../../shared/i18n";
import {
  Check,
  ChatCopy,
  ChatEditMessage,
  ChatRun,
  ChatWork,
  FilePlusCorner,
  MessageMultiple,
  Replace,
  MoreHorizontal,
  ChartBreakoutSquare,
  X,
  MessageSquare,
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
  type ComponentProps,
  type ContextType,
  type ReactNode,
} from "react";
import { TranscriptRetentionContext } from "./TranscriptPool";
import { AttachmentChip } from "./AttachmentChip";
import { WorkItemMentionCwd } from "./WorkItemMentionChip";
import { TranscriptSessionId } from "./TranscriptSessionId";
import { ChatCitationList } from "./ChatCitationText";
import { extractChatCitations } from "../model/chatCitation";
import { TranscriptSkills } from "./SkillTokenText";
import { RunHarness } from "./SubagentAnatomy";
import { UserMessageMarkdown, UserTextPreview } from "./UserTextPreview";
import { userTextParts } from "../model/userTextPreview";
import { findTokens } from "../model/attachmentTokens";
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
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { Button } from "../../../shared/ui/Button";
import { UserDraftFooter } from "./UserDraftFooter";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import type {
  FloatingButtonGroupAction,
  FloatingButtonGroupTriggerProps,
} from "../../../shared/ui/FloatingButtonGroup";
import { TurnOutputActions } from "./TranscriptMessageActions";
import { ResumeTurnRow } from "./ResumeTurnRow";
import { resumePromptKind } from "../model/resumePrompt";
import type { ApprovalDecision } from "../../../integrations/harness";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { Attachment } from "../model/session";
import type { ShellRun } from "../model/shellRun";
import { visibleUserPrompt } from "../model/userPromptText";
import { playCue } from "../../settings/public/sounds";
import { legacyTaskListFromText } from "../model/taskList";
import { useResolvedModelName } from "../model/reactiveReads";
import { BlockScanCache } from "../model/blockScanCache";
import { sameBlocksIgnoringStreamingText } from "../model/stableBlocks";
import {
  projectTranslatedBlocks,
  type TranslationProjection,
} from "../model/translationProjection";
import { TranscriptTurnCache } from "../model/transcriptTurnCache";
import { ModelSwitchRow } from "./ModelSwitchRow";
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
import {
  deriveTurnActivity,
  useTurnClockOrigin,
  type TurnActivityPhase,
} from "../model/turnActivity";
import { TurnActivityLine } from "./TurnActivityLine";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useTranscriptLayout } from "../hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import type { TranscriptLayout } from "../../settings";
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
  isAdvisorBlock,
  isProseBlock,
  hasTurnCopyText,
  turnCopyText,
  settledWorkSummaryLine,
  type TurnItem,
} from "../model/transcriptActivity";
import { lastUserTurnBlock } from "../model/editLastTurn";
import { isOperatorUserTurn, operatorUserPrompt } from "../model/operatorCommand";
import { useTranscriptFollow, useTranscriptCheckpointRestore } from "./useTranscriptFollow";
import { useTranscriptPaging } from "./useTranscriptPaging";
import { useTranscriptSearch } from "./useTranscriptSearch";
import { useClampOverflow } from "./useClampOverflow";
import { CodeExecutionProvider, type CodeExecutionScope } from "./CodeExecutionContext";
import { useRetainedDisclosure } from "./useRetainedDisclosure";
import {
  ActivityPhases,
  formatWorkingDuration,
  ToolCall,
  HandoffDivider,
  InterjectionDivider,
} from "./AgentTranscriptActivity";
import { DelegatedRunOwner, SubagentStack } from "./SubagentCards";
import { AdvisorRow } from "./AdvisorRow";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
export { ActivityRow, agentStepBlock } from "./AgentTranscriptActivity";
type Props = {
  inlineVisualHost?: InlineVisualHostRoute;
  codeExecution?: CodeExecutionScope;
  /** Travels with the element when TranscriptPool renders it in its outlet. */
  approvalContext?: {
    session: import("../model/session").Session;
    getSession?: () => import("../model/session").Session;
    dispatch: ApprovalDispatch;
  };
  sessionId?: string;
  /** The session whose delegated runs show as cards. Travels with the element like
   * `approvalContext`: a pooled transcript renders outside the pane's providers. */
  delegatedRunOwner?: string;
  blocks: Block[];
  busy?: boolean;
  historyLoading?: boolean;
  historyLoadError?: string;
  /** Reads the stored conversation again after `historyLoadError`; without it the failure has no Retry. */
  onRetryHistory?: () => void;
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
  pendingOwnerApproval?: boolean;
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
function AgentTranscriptComponent({
  sessionId,
  blocks: persistedBlocks,
  busy,
  historyLoading = false,
  historyLoadError,
  onRetryHistory,
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
  pendingOwnerApproval = false,
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
  const translationContext =
    cwd && harness ? { cwd, harness, model, modelSettings, providerAccountId } : undefined;
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
  const [translationProjection] = useState(() => new FrameMemory<TranslationProjection>());
  const sourceBlocks = useMemo(
    () => projectTranslatedBlocks(persistedBlocks, translations, translationProjection.read()),
    [persistedBlocks, translations, translationProjection],
  );
  useLayoutEffect(() => {
    translationProjection.write({ source: persistedBlocks, translations, blocks: sourceBlocks });
  }, [persistedBlocks, translations, sourceBlocks, translationProjection]);
  const translateSelection = useStableCallback(
    canOfferTranslation(translationContext)
      ? (liveSelection: TranscriptSelection, target: TextActionTarget) => {
          // Read occurrence and text now, so the apply step checks the same snapshot it translated.
          const selection = resolveTranscriptSelection(liveSelection);
          if (!selection) return;
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
  const [authFilterPrev] = useState(() => new FrameMemory<DisplayFilterFrame>());
  const blocks = useMemo(
    () => filterDisplayedBlocks(harness, sourceBlocks, authFilterPrev.read()),
    [harness, sourceBlocks, authFilterPrev],
  );
  // Remember what each committed frame filtered, never from inside the memo:
  // a render that React discards must not move the baseline.
  useLayoutEffect(() => {
    authFilterPrev.write({ harness, source: sourceBlocks, result: blocks });
  }, [harness, sourceBlocks, blocks, authFilterPrev]);
  const editableUserBlockId = lastUserTurnBlock(blocks)?.id;
  const retention = useContext(TranscriptRetentionContext);
  const retained = retention?.read();
  const virtualization = useContext(TranscriptVirtualizationContext)!;
  useTranscriptActiveBlocksVersion();
  const [seenOutput] = useState(() => new SeenOutput(blocks));
  // Records the committed frame's output ids; the set belongs to no render.
  useLayoutEffect(() => {
    seenOutput.update(blocks);
  }, [seenOutput, blocks]);
  const [turnCache] = useState(() => new TranscriptTurnCache());
  const turns = turnCache.group(blocks, managed);
  // Turns whose folded work the reader has opened, by turn id.
  const [openWork, setOpenWork] = useState<Record<string, boolean>>(() => retained?.openWork ?? {});
  const toggleWork = useCallback((turnId: string, currentlyOpen: boolean) => {
    setOpenWork((open) => ({ ...open, [turnId]: !currentlyOpen }));
  }, []);
  const transcriptLayout = useTranscriptLayout();
  // The active turn fills the viewport until its reply settles.
  const anchorTurn = useTranscriptAnchor() && !!busy;
  const lastUserId = lastUserBlockId(blocks, managed);
  const currentModelName = useResolvedModelName(harness, model);
  const blockingQuestion = pendingQuestion && questionBehavior === "blocking";
  const [scanCache] = useState(() => new BlockScanCache());
  const scan = scanCache.scan(blocks);
  const waitingForApproval = pendingOwnerApproval || scan.pendingApproval || blockingQuestion;
  const preparingHandoff = scan.preparingHandoff;
  // The prompt whose run is in flight; a mid-turn message continues its clock.
  const runOwner = busy ? blocks[scan.executionUser] : undefined;
  // In the chat layout a sent prompt rises from the upper screen into its
  // anchored spot at the top. On mount this only plays for a session's first
  // send.
  const introducePrompt = useStableCallback((mounting: boolean, el: HTMLDivElement | null) => {
    if (!lastUserId || transcriptLayout !== "chat" || !anchorTurn || !visible) return;
    if (mounting && !(busy && userTurnCount(blocks, managed) === 1)) return;
    return riseIntoAnchor(el, lastUserId);
  });
  const [jumps] = useState(() => new JumpRelay());
  const jumpToLatest = jumps.jump;
  const registerBottomJump = useCallback(
    (jump: (() => void) | null) => {
      jumps.setFollow(jump);
      onJumpToBottomReady?.(jump ? jumpToLatest : null);
    },
    [onJumpToBottomReady, jumpToLatest, jumps],
  );
  const follow = useTranscriptFollow({
    visible,
    lastUserId,
    onPromptChange: introducePrompt,
    onJumpToBottomChange,
    onJumpToBottomReady: registerBottomJump,
    onReadingChange,
    onScrollerChange,
    virtualization,
  });
  const { scroller, scrollerEl, setScroller, wasVisible } = follow;
  const {
    visibleTurnCount,
    firstVisibleTurn,
    lastVisibleTurn,
    visibleTurns,
    loadEarlier,
    onHistoryScroll,
    loadNewer,
    jumpLatest,
    revealBlock: pagingRevealBlock,
    findTurn,
    pagingLoading,
    pagingError,
  } = useTranscriptPaging({
    sessionId,
    turns,
    blockCount: blocks.length,
    openWork,
    scroller,
    stickToBottom: follow.stickToBottom,
    distanceFromBottom: follow.distanceFromBottom,
    prependHeight: follow.prependHeight,
    remoteHistoryHasMore,
    onLoadRemoteHistory,
  });
  // The paging window is the other half of the jump; hand it to the relay.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the paging jump with the relay that the follow hook's jump also uses
  useLayoutEffect(() => jumps.setPaging(jumpLatest), [jumps, jumpLatest]);
  const anchorAdjusted = useStableCallback((element: HTMLElement) => {
    if (element === scroller.current) follow.rememberScroll(element);
  });
  // The virtualization owner outlives renders and calls back when anchoring moves the scroller.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the anchoring callback with the external virtualization owner and unregisters it on unmount
  useLayoutEffect(() => {
    virtualization.setAdjusted(anchorAdjusted);
    return () => virtualization.setAdjusted(undefined);
  }, [virtualization, anchorAdjusted]);
  const revealBlock = useCallback(
    (blockId: string) => {
      if (!findTurn(blockId)) return false;
      flushSync(() => virtualization.reveal(blockId));
      // Callers align the block now and once more on the next frame; after
      // that the reveal must not keep forcing its rows mounted or groups open.
      virtualization.settleRevealAfterAlignment(blockId);
      return pagingRevealBlock(blockId);
    },
    [findTurn, pagingRevealBlock, virtualization],
  );
  useEffect(() => {
    onRevealReady?.(revealBlock);
    return () => onRevealReady?.(null);
  }, [onRevealReady, revealBlock]);
  const registerNavigate = useCallback(
    (navigate: ((blockId: string | null, query?: string) => boolean) | null) => {
      onNavigateReady?.(
        navigate
          ? (blockId, query) => {
              if (blockId === null) virtualization.reveal(null);
              return navigate(blockId, query);
            }
          : null,
      );
    },
    [onNavigateReady, virtualization],
  );
  const renderedTurns = visibleTurns.map((turn, index) => ({
    turn,
    index: firstVisibleTurn + index,
  }));
  // Active execution and unresolved approval controls are never evicted with settled history.
  if (waitingForApproval || virtualization.activeBlocks.size)
    turns.forEach((turn, index) => {
      if (
        (index < firstVisibleTurn || index >= lastVisibleTurn) &&
        (hasPendingApproval(turn) ||
          turn.some((block) => virtualization.activeBlocks.has(block.id)))
      )
        renderedTurns.push({ turn, index });
    });
  const latestIndex = turns.length - 1;
  if (
    latestIndex >= lastVisibleTurn &&
    (busy ||
      pendingQuestion ||
      editingLastTurn ||
      latestTurnAccessory ||
      !!backgroundTasks?.length ||
      !!backgroundAgents) &&
    !renderedTurns.some((entry) => entry.index === latestIndex)
  )
    renderedTurns.push({ turn: turns[latestIndex], index: latestIndex });
  renderedTurns.sort((a, b) => a.index - b.index);
  const renderTurns = renderedTurns.map((entry) => entry.turn);
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
    onNavigateReady: registerNavigate,
  });
  const turnHarnesses = harness ? scanCache.harnesses(blocks, renderTurns, harness) : undefined;
  const stableLoadRemoteBlock = useStableCallback(onLoadRemoteBlock);
  const stableApproval = useStableCallback(onApproval);
  const stableSaveNote = useStableCallback(onSaveNote);
  const stableSendDraft = useStableCallback(onSendDraft);
  const stableEditDraft = useStableCallback(onEditDraft);
  const stableRemoveDraft = useStableCallback(onRemoveDraft);
  const imageOpen = useTranscriptImageOpen(cwd, onOpenFile);
  const stableOpenFile = imageOpen.open;
  const stableOpenDiff = useStableCallback(onOpenDiff);
  const stableOpenPlan = useStableCallback(onOpenPlan);
  const stableBuildPlan = useStableCallback(onBuildPlan);
  const stableSecondOpinion = useStableCallback(onSecondOpinion);
  const stableHandoff = useStableCallback(onHandoff);
  const stableEditLastTurn = useStableCallback(onEditLastTurn);
  const stableRewindMessage = useStableCallback(onRewindMessage);
  const stableAddToChat = useStableCallback(onAddToChat),
    stableSaveSelectionNote = useStableCallback(onSaveSelectionNote);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!visible || !el || !retention) return;
    // Markdown owns its code folds. Checkpoint only that explicit presentation
    // control, without changing markdown, replaying actions or retaining DOM.
    const restoreCodeFolds = () => {
      const disclosures = retention.read().disclosures;
      if (!disclosures) return;
      for (const turn of el.querySelectorAll<HTMLElement>("[data-transcript-turn]")) {
        stableCodeDisclosureIdentity([
          ...turn.querySelectorAll<HTMLElement>(".markdown-code-shell"),
        ]).forEach((identity, shell) => {
          const collapsed = disclosures[`code:${turn.dataset.transcriptTurn}:${identity}`];
          if (typeof collapsed === "boolean" && collapsed !== (shell.dataset.collapsed === "true"))
            shell.querySelector<HTMLButtonElement>(".markdown-code-toggle")?.click();
        });
      }
    };
    restoreCodeFolds();
    let frame: number | undefined;
    const observer = new MutationObserver((records) => {
      if (frame !== undefined || !retention.read().disclosures) return;
      if (
        !records.some((record) =>
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches(".markdown-code-shell") || node.querySelector(".markdown-code-shell")),
          ),
        )
      )
        return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        restoreCodeFolds();
      });
    });
    observer.observe(el, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 1000);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
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
        onScroll={(event) => {
          onHistoryScroll(
            event.currentTarget.scrollTop,
            false,
            visible && !remoteHistoryError && follow.hasReaderInput(),
          );
        }}
        onWheel={(event) => {
          if (
            visible &&
            !remoteHistoryError &&
            event.deltaY < 0 &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !innerScrollerTakes(event.currentTarget, event.nativeEvent)
          )
            onHistoryScroll(event.currentTarget.scrollTop, true);
        }}
        onClickCapture={(event) => {
          imageOpen.noteClick(event);
          captureCodeDisclosure(event.target, retention);
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
            target === event.currentTarget &&
            visible &&
            !remoteHistoryError &&
            !activeVersionValid &&
            ["ArrowUp", "PageUp", "Home"].includes(event.key)
          )
            onHistoryScroll(event.currentTarget.scrollTop, true);
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
          <div className="pointer-events-none sticky inset-bs-0 z-(--layer-pane-sheet) h-0">
            <div
              {...surfaceAttributes(
                { variant: "floating", frame: "card", radius: "card", elevation: "floating" },
                "pointer-events-auto absolute inset-bs-2 inset-ie-3 flex flex-wrap items-center justify-end gap-1 p-1 font-sans text-ui-caption text-(--transcript-ink-chrome)",
              )}
            >
              <span className="px-1">{t("After applying: ↑ original, ↓ translation.")}</span>
              <SegmentedControl
                size="sm"
                label={t("Translation view")}
                value={activeVersion.translatedVisible ? "translation" : "original"}
                onValueChange={(next) => showTranslation(next === "translation")}
                options={[
                  { value: "original", label: t("Original text") },
                  { value: "translation", label: t("Translation") },
                ]}
              />
              <CopyButton
                motion="none"
                size="sm"
                variant="ghost"
                iconOnly
                label={t("Copy")}
                resetKeys={[activeTranslation, activeVersion.translatedVisible]}
                errorDetail
                onCopy={() =>
                  copyMessage(
                    activeVersion.translatedVisible
                      ? activeVersion.translated
                      : activeVersion.original,
                  )
                }
              />
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
            </div>
          </div>
        ) : null}
        {(remoteHistoryLoading || pagingLoading) &&
        !remoteHistoryError &&
        !pagingError &&
        blocks.length > 0 ? (
          <div className="pointer-events-none sticky inset-bs-0 z-(--layer-pane-sheet) h-0">
            <LoadingText inset="panel" className="mx-auto w-fit">
              {t("Loading earlier messages…")}
            </LoadingText>
          </div>
        ) : null}
        <div
          data-transcript-content
          className="transcript-content mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-1 pb-8"
        >
          <TranscriptHistoryNotice
            initial={blocks.length === 0}
            loading={
              historyLoading || (blocks.length === 0 && (remoteHistoryLoading || pagingLoading))
            }
            loadFailed={!!historyLoadError}
            pageError={
              remoteHistoryError ||
              (pagingError
                ? t("Couldn’t load earlier messages: {p0}", { p0: pagingError })
                : undefined)
            }
            onRetryLoad={onRetryHistory}
            onRetryPage={
              remoteHistoryHasMore && onLoadRemoteHistory ? () => void loadEarlier() : undefined
            }
          />
          {renderedTurns.map(({ turn, index }, turnIndex) => {
            const turnNumber = index + 1;
            const isLastTurn = turnNumber === turns.length;
            const settled = !(busy && isLastTurn);
            const live = visible && !settled && !preparingHandoff;
            const turnId = turn[0].id;
            const runHarness = turnHarnesses?.[turnIndex] ?? harness;
            const activity = live
              ? deriveTurnActivity({
                  t,
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
                seenOutput={seenOutput}
                allowMountReveal={
                  visible && wasVisible.current && !historyLoading && !remoteHistoryLoading
                }
                managed={managed}
                settled={settled}
                live={live}
                visible={visible}
                isLastTurn={isLastTurn}
                turnHarness={turnHarnesses?.[turnIndex]}
                clockStart={
                  live ? scanCache.clockStart(blocks, turnUserBlock(turn, managed)) : undefined
                }
                currentModelName={live ? currentModelName : undefined}
                waitingForApproval={live && waitingForApproval}
                pendingQuestion={live && blockingQuestion}
                liveStatusInDock={live && liveStatusInDock}
                backgroundTasks={live ? backgroundTasks : undefined}
                backgroundAgents={live ? backgroundAgents : undefined}
                activityPhase={activity?.phase}
                activityLabel={activity?.label}
                activityAfterSilence={activity?.afterSilence}
                activityOwner={activityOwnsClock ? runOwner : undefined}
                activitySessionId={activityOwnsClock ? sessionId : undefined}
                anchorPrompt={anchorTurn && isLastTurn}
                latestTurnAccessory={isLastTurn && !parked ? latestTurnAccessory : undefined}
                workOpen={
                  (openWork[turnId] ?? false) || (waitingForApproval && hasPendingApproval(turn))
                }
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
        {lastVisibleTurn < turns.length ? (
          <div className="flex justify-center gap-2 px-4 py-3">
            <Button motion="none" variant="ghost" type="button" onClick={loadNewer}>
              {t("Load newer messages")}
            </Button>
            <Button motion="none" variant="ghost" type="button" onClick={jumpToLatest}>
              {t("Jump to latest")}
            </Button>
          </div>
        ) : null}
        {onAddToChat || onSaveSelectionNote || canOfferTranslation(translationContext) ? (
          <TranscriptSelectionActions
            root={scrollerEl}
            enabled={visible}
            sessionId={sessionId}
            blocks={persistedBlocks}
            onAddToChat={stableAddToChat}
            onAddToNotes={stableSaveSelectionNote}
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
function VirtualizedTranscriptComponent(props: Props) {
  const retained = useContext(TranscriptRetentionContext)?.read();
  const [virtualization] = useState(
    () =>
      new TranscriptVirtualization(
        retained?.bottomFollow === false ? (retained.virtualAnchorBlockId ?? null) : null,
      ),
  );
  return (
    <TranscriptVirtualizationContext.Provider value={virtualization}>
      <InlineVisualHost.Provider value={props.inlineVisualHost}>
        <AgentTranscriptComponent {...props} />
      </InlineVisualHost.Provider>
    </TranscriptVirtualizationContext.Provider>
  );
}
// Activity preserves local state while suspending hidden work and effects.
export const AgentTranscript = memo(function AgentTranscript(props: Props) {
  const transcript =
    props.cwd && props.harness ? (
      <TranscriptSkills cwd={props.cwd} harness={props.harness} sessionId={props.sessionId}>
        <VirtualizedTranscriptComponent {...props} />
      </TranscriptSkills>
    ) : (
      <VirtualizedTranscriptComponent {...props} />
    );
  return (
    <OwnerApprovalChat
      sessionId={props.sessionId}
      visible={props.visible !== false && !props.parked}
    >
      <CodeExecutionProvider
        scope={props.codeExecution}
        cwd={props.cwd}
        onReport={props.onAddToChat}
      >
        <Activity mode={props.visible === false ? "hidden" : "visible"}>
          <WorkItemMentionCwd value={props.cwd}>
            <TranscriptSessionId.Provider value={props.sessionId}>
              <DelegatedRunOwner.Provider value={props.delegatedRunOwner}>
                {props.approvalContext ? (
                  <ApprovalDecisionProvider {...props.approvalContext}>
                    {transcript}
                  </ApprovalDecisionProvider>
                ) : (
                  transcript
                )}
              </DelegatedRunOwner.Provider>
            </TranscriptSessionId.Provider>
          </WorkItemMentionCwd>
        </Activity>
      </CodeExecutionProvider>
    </OwnerApprovalChat>
  );
});
type TurnProps = {
  turn: Block[];
  seenOutput: SeenOutput;
  allowMountReveal: boolean;
  managed: boolean;
  settled: boolean;
  live: boolean;
  visible: boolean;
  isLastTurn: boolean;
  /** One-based position in the whole transcript, not in the visible window. */
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
  /** The run owner when this line shows the turn clock; its origin is read by the line. */
  activityOwner?: Block;
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
 * The activity line with the turn clock's origin. The first-seen time per run
 * lives outside React; `useTurnClockOrigin` exposes that stable read through
 * a render-time hook so the transcript and its turns stay compiled.
 */
function OriginTurnActivityLine({
  owner,
  ...line
}: Omit<ComponentProps<typeof TurnActivityLine>, "origin" | "ownsClock"> & { owner?: Block }) {
  const origin = useTurnClockOrigin(owner);
  return <TurnActivityLine {...line} origin={origin} ownsClock={origin !== undefined} />;
}

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
  activityOwner,
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
  const t = useT();
  const format = useFormat();
  const userBlock = turnUserBlock(turn, managed);
  const durationMs = userBlock?.durationMs;
  // Proposals are turn results, like the changes card. Keep them out
  // of the live work and append them after all of the lead's output.
  const proposals = turn.filter((block) => block.orchestration);
  const [itemCache] = useState(() => new TranscriptTurnCache());
  const [rowCache] = useState(() => new TranscriptRowCache());
  const items = itemCache.turnItems(turn, settled);
  // The leading user blocks are the turn's prompt; the reply surface starts after them.
  const firstReplyAt = items.findIndex(
    (item) => !(item.type === "block" && item.block.role === "user" && !item.block.interjection),
  );
  const promptCount = firstReplyAt === -1 ? items.length : firstReplyAt;
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
  const turnId = turn[0].id;
  // Work the turn has already answered for folds away behind one line,
  // leaving the prompt and the answer to it.
  const fold = foldableWork(items);
  const folded = fold ? foldedBlocks(items, fold) : [];
  // The fold line is the turn's status line from the first token to
  // the last: the mark, and the clock beside it. It never moves, so a
  // turn settling does not shuffle the layout around the answer.
  const turnModelName = turnModel?.name ?? (live ? currentModelName : undefined);
  // The fold line speaks for the main agent only. A delegated run has
  // its own row, which says who is working and how it went, so saying
  // it again here would be two lines telling the same story.
  // With the clock in the dock, the line says what the work was; the model
  // that did it trails as a quiet tag rather than standing in for a title.
  const foldInDock = live && liveStatusInDock && !waitingForApproval;
  const foldTitle: ReactNode = foldInDock ? (
    settledWorkSummaryLine(folded)
  ) : live ? (
    <LiveFoldTitle
      startedAt={clockStart}
      paused={waitingForApproval}
      waitingFor={
        managed && waitingForApproval ? "orchestrator" : pendingQuestion ? "answers" : undefined
      }
      background={backgroundTasks}
      backgroundAgents={backgroundAgents}
      modelName={turnModelName}
    />
  ) : durationMs != null ? (
    formatWorkingDuration(t, format, durationMs, turnModelName, true)
  ) : (
    settledWorkSummaryLine(folded)
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
        <InitialThinking key={item.blocks[0].id} live={visible && !settled} embedded />
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
          // The reply surface owns the gutter; only the turn's own prompt rows draw their own.
          embedded={itemIndex >= promptCount}
          visible={item.block.role === "user" ? visible : undefined}
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
        meta={foldInDock ? turnModelName : undefined}
        harness={turnHarness}
        live={live}
        expandable={!!fold}
        open={workOpen && !!fold}
        onToggle={() => toggleWork(turnId, workOpen)}
      />
    </TurnRow>
  );
  const itemBlocks = (item: TurnItem) => (item.type === "block" ? [item.block] : item.blocks);
  const pinnedItem = (item: TurnItem, index: number) =>
    (live && index === items.length - 1) ||
    itemBlocks(item).some(
      (block) =>
        !!block.streaming ||
        !!block.inlineVisual ||
        (!!block.approval && !block.approval.decided) ||
        (block.role === "user" &&
          (anchorPrompt || (editingLastTurn && block.id === editableUserBlockId))),
    );
  // prettier-ignore
  const itemRow = (
    item: TurnItem,
    index: number,
    rail = false,
    tail = false,
  ): TranscriptVirtualRow =>
    rowCache.row(
      turnItemKey(item),
      // List every value the row factory/renderItem reads here, or the row goes stale.
      [
        item, index, rail, tail, pinnedItem(item, index), isCurrentItem(item),
        cwd, live, visible, settled,
        index === initialThinkingAt,
        !visible || settled || index < foldedAt || (answering && !workStillRunning),
        allowMountReveal && isLastTurn && item.type === "block" && !seenOutput.has(item.block.id),
        transcriptLayout, items[index - 1]?.type, index === foldLineAt && showFoldLine, index >= promptCount,
        busy, planHarness, planModel, planModelSettings, editableUserBlockId, editingLastTurn,
        onApproval, onSaveNote, onSendDraft, onEditDraft, onRemoveDraft, onOpenFile, onOpenDiff,
        onOpenPlan, onBuildPlan, onLoadRemoteBlock, onEditLastTurn, canRewindMessage, onRewindMessage,
      ],
      () => ({
        id: turnItemKey(item),
        blockIds: itemBlocks(item).map((block) => block.id),
        pinned: pinnedItem(item, index),
        render: () => (
          <div
            data-transcript-search-item
            data-transcript-search-current={isCurrentItem(item) || undefined}
            className={
              rail
                ? `flow-root ${tail ? "pb-0 zen-fold-tail" : "pb-1"} pl-5 zen-fold-rail`
                : "flow-root pb-1"
            }
          >
            {renderItem(item, index)}
          </div>
        ),
      }),
    );
  const lineRow: TranscriptVirtualRow = {
    id: "work-fold",
    blockIds: [],
    estimate: showFoldLine ? undefined : 0,
    render: () => foldLineRow,
  };
  const workRows = foldWork.map(({ entry, index }, offset) =>
    itemRow(entry, index, true, offset === foldWork.length - 1),
  );
  const virtualRows = items.flatMap((item, itemIndex): TranscriptVirtualRow[] => {
    const inFold = !!fold && itemIndex >= fold.start && itemIndex <= fold.end;
    if (inFold) {
      if (itemIndex !== fold.start) return [];
      return [
        lineRow,
        rowCache.row("work-details", [workOpen, ...workRows], () => ({
          id: "work-details",
          blockIds: workRows.flatMap((row) => row.blockIds),
          pinned: workRows.some((row) => row.pinned),
          estimate: workOpen ? undefined : 0,
          render: () => (
            <TurnRow folded={!workOpen}>
              {() => <TranscriptVirtualRows rows={workRows} listId={`turn:${turnId}:work`} />}
            </TurnRow>
          ),
        })),
        ...foldVisible.map(({ entry, index }) => itemRow(entry, index)),
      ];
    }
    const row = itemIndex === initialThinkingInLine ? [] : [itemRow(item, itemIndex)];
    return itemIndex === foldLineAt ? [lineRow, ...row] : row;
  });
  if (foldLineAt >= items.length) virtualRows.push(lineRow);
  rowCache.retain([...virtualRows, ...workRows]);
  // The turn's own prompt rows stay outside the reply surface; everything after them is the reply.
  const promptIds = new Set(items.slice(0, promptCount).map(turnItemKey));
  const promptRows = virtualRows.filter((row) => promptIds.has(row.id));
  const replyRows = virtualRows.filter((row) => !promptIds.has(row.id));
  const hasReply =
    replyRows.some((row) => row.id !== lineRow.id || showFoldLine) ||
    !!(activityPhase && activityLabel) ||
    !!latestTurnAccessory ||
    (durationMs != null && settled) ||
    (settled && proposals.some((block) => block.orchestration?.status !== "planning"));
  const replyContent = (
    <>
      <RunHarness.Provider value={turnHarness}>
        <TranscriptVirtualRows rows={replyRows} listId={`turn:${turnId}:items`} />
      </RunHarness.Provider>
      {activityPhase && activityLabel ? (
        <OriginTurnActivityLine
          phase={activityPhase}
          label={activityLabel}
          afterSilence={activityAfterSilence}
          activityKey={turn}
          owner={activityOwner}
          sessionId={activitySessionId}
        />
      ) : null}
      {settled ? (
        <TranscriptVirtualRows
          listId={`turn:${turnId}:proposals`}
          rows={proposals
            .filter((block) => block.orchestration?.status !== "planning")
            .map((block) => ({
              id: block.id,
              blockIds: [block.id],
              render: () => (
                <div className="pt-1 pb-2" data-orchestration-result>
                  <OrchestrationPreview block={block} busy={busy} />
                </div>
              ),
            }))}
        />
      ) : null}
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
    </>
  );
  return (
    <div
      key={turn[0].id}
      data-transcript-turn={turnId}
      className={`transcript-turn flex min-w-0 flex-col${
        isLastTurn ? " transcript-turn-live" : ""
      }${anchorPrompt && userBlock ? " transcript-turn-anchor" : ""}`}
    >
      {promptRows.length > 0 ? (
        <TranscriptVirtualRows rows={promptRows} listId={`turn:${turnId}:prompt`} />
      ) : null}
      {hasReply ? <div data-transcript-reply>{replyContent}</div> : null}
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
      className={`min-w-0 pt-3 pb-1 font-sans text-ui-body text-(--transcript-ink-chrome) ${embedded ? "" : "px-4"}`}
    >
      {live ? <WorkingIndicator>{t("Thinking…")}</WorkingIndicator> : t("Thinking…")}
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
  waitingFor,
  background,
  backgroundAgents,
  modelName,
}: {
  startedAt?: number;
  paused: boolean;
  waitingFor?: "orchestrator" | "answers";
  background?: string[];
  backgroundAgents?: number;
  modelName?: string;
}) {
  const t = useT();
  const format = useFormat();
  const elapsedMs = useElapsedFrom(startedAt, paused);
  // Only commands are left (a dev server, a watcher): the agent is done, so
  // the line stops shimmering and counting rather than looking busy forever.
  if (!paused && background && isBackgroundOnly(true, background, backgroundAgents)) {
    return (
      <Tooltip label={background.join("\n")} asChild>
        <span className="min-w-0 truncate font-sans text-ui-body text-(--transcript-ink-chrome)">
          {background.length === 1
            ? t("Finished · 1 command running in background")
            : t("Finished · {p0} commands running in background", { p0: background.length })}
        </span>
      </Tooltip>
    );
  }
  // Yielding with a command still going is not the end of the turn. The clock
  // keeps running and the line says what it is waiting on.
  const text = paused
    ? waitingFor === "orchestrator"
      ? t("Waiting for orchestrator")
      : waitingFor === "answers"
        ? t("Waiting for answers")
        : t("Waiting for approval")
    : background?.length
      ? `${formatWorkingDuration(t, format, elapsedMs, modelName)} · ${background.length === 1 ? t("running in background") : t("{p0} tasks running in background", { p0: background.length })}`
      : formatWorkingDuration(t, format, elapsedMs, modelName);
  const workLabel = (
    <WorkingIndicator className="min-w-0" text={{ size: "body" }} truncate glyph={false}>
      {text}
    </WorkingIndicator>
  );
  return background?.length ? (
    <Tooltip label={background.join("\n")} asChild>
      <span className="flex min-w-0">{workLabel}</span>
    </Tooltip>
  ) : (
    workLabel
  );
}
/**
 * What a finished turn leaves under the answer: what you can do with it, and
 * when it landed. The clock lives on the fold line above, from the first token
 * to the last, so it is not repeated here.
 */
type RemoteLoadState = "idle" | "pending" | "failed";

/** The load itself, outside the component: the compiler cannot lower try/finally. */
async function loadRemoteBlock({
  owner,
  key,
  blockId,
  revision,
  onLoad,
  mounted,
  setState,
}: {
  owner: ContextType<typeof TranscriptVirtualizationContext>;
  key: string;
  blockId: string;
  revision: number;
  onLoad: (blockId: string, revision: number) => Promise<void> | void;
  mounted: { current: boolean };
  setState: (state: RemoteLoadState) => void;
}) {
  owner?.remoteLoads.set(key, "pending");
  const release = owner?.holdBlock(blockId);
  try {
    await onLoad(blockId, revision);
    owner?.remoteLoads.set(key, "idle");
    if (mounted.current) setState("idle");
  } catch {
    owner?.remoteLoads.set(key, "failed");
    if (mounted.current) setState("failed");
  } finally {
    release?.();
  }
}

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
  const owner = useContext(TranscriptVirtualizationContext);
  const key = JSON.stringify([blockId, revision]);
  const [state, setState] = useState<"idle" | "pending" | "failed">(
    () => owner?.remoteLoads.get(key) ?? "idle",
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    setState(owner?.remoteLoads.get(key) ?? "idle");
    return () => {
      mounted.current = false;
    };
  }, [owner, key]);
  const load = async () => {
    if (state === "pending") return;
    setState("pending");
    await loadRemoteBlock({ owner, key, blockId, revision, onLoad, mounted, setState });
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
        {state === "pending"
          ? t("Loading full output…")
          : state === "failed"
            ? t("Retry")
            : t("Load full output ({p0} KB)", { p0: Math.max(1, Math.ceil(bytes / 1024)) })}
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
  const format = useFormat();
  const label = formatWorkingDuration(t, format, elapsedMs, modelName, true);
  const hasOutput = hasTurnCopyText(turn);
  const getText = useCallback(() => turnCopyText(turn), [turn]);
  const dot = (
    <span
      aria-hidden
      className="size-0.75 shrink-0 rounded-full border-[3px] border-(--ui-tone-neutral-border)"
    />
  );
  return (
    <div
      aria-label={label}
      data-transcript-actions-row
      className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2.5 pt-1 pb-3 font-sans text-ui-body text-(--transcript-ink-chrome)"
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
          {labelHidden ? null : dot}
          <Timestamp value={completedAt} className="shrink-0 text-(--transcript-ink-chrome)" />
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
  const format = useFormat();
  const root = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  if (!metrics || !hasTurnMetrics(metrics)) return null;
  let outputRate: number | undefined;
  if (metrics.outputTokens != null && elapsedMs != null && elapsedMs > 0) {
    outputRate = metrics.outputTokens / (elapsedMs / 1000);
  }
  const cacheHit =
    metrics.cacheHitPercent != null
      ? t("Cache hit {p0}%", { p0: Math.round(metrics.cacheHitPercent) })
      : null;
  const outputSpeed =
    outputRate != null
      ? t("Output {p0} tok/s", { p0: format.formatCompactCount(outputRate) })
      : null;
  const headline = [cacheHit, outputSpeed].filter(Boolean).join(" · ") || t("Turn tokens");
  const detail = [
    metrics.inputTokens != null
      ? t("{p0} input", { p0: format.formatCompactCount(metrics.inputTokens) })
      : null,
    metrics.outputTokens != null
      ? t("{p0} output", { p0: format.formatCompactCount(metrics.outputTokens) })
      : null,
    metrics.cacheReadTokens != null
      ? t("{p0} cached", { p0: format.formatCompactCount(metrics.cacheReadTokens) })
      : null,
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
          variant="preview"
          className="w-max"
        >
          <div className="text-ui-caption leading-4 text-(--ui-tone-neutral-fg)">{headline}</div>
          {detail ? (
            <div className="text-ui-micro leading-4 text-(--transcript-ink-chrome)">{detail}</div>
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
  return (
    <CopyButton
      iconOnly={!showLabel}
      label={label}
      motion="none"
      variant="ghost"
      type="button"
      icon={<ChatCopy className={showLabel ? "icon-sm" : "icon-md"} strokeWidth={1.75} />}
      resetKeys={[text, getText, attachments]}
      errorDetail
      onClick={(event) => event.stopPropagation()}
      onCopy={async () => {
        await copyMessage(text ?? getText?.() ?? "", attachments);
        // The confirmation sound belongs to a copy that actually landed.
        playCue("copy");
      }}
    />
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
            <Check className="icon-md" strokeWidth={1.75} />
          ) : (
            <FilePlusCorner className="icon-md" strokeWidth={1.75} />
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
          icon: <ChatEditMessage />,
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
        variant="ghost"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal className="icon-md" strokeWidth={1.75} />
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
    if (block.author?.kind === "delegation") return <DelegationNoticeRow block={block} />;
    const resumeKind = resumePromptKind(block.text);
    if (resumeKind && !block.attachments?.length)
      return <ResumeTurnRow block={block} kind={resumeKind} embedded={embedded} />;
    if (block.questionAnswers?.length) {
      return (
        <div
          data-question-answer
          role="group"
          aria-label={t("Question and answer")}
          className={`flex min-w-0 flex-col gap-2 font-sans ${embedded ? "" : "px-4"} pbs-1.5 pbe-5`}
        >
          <span className="sr-only">{t("Answered")}</span>
          {block.questionAnswers.map(({ prompt, answers }, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-1.5">
              <section
                aria-label={t("AI question")}
                className="flex min-w-0 max-w-[min(100%,36rem)] items-start gap-2 text-(--transcript-ink-body)"
              >
                <MessageSquare aria-hidden="true" className="mt-0.5 icon-sm shrink-0" />
                <p className="min-w-0 whitespace-pre-wrap break-words text-ui-caption leading-relaxed">
                  {prompt}
                </p>
              </section>
              <section className="min-w-0 ps-10" aria-label={t("Your answer")}>
                <UserMessageBlock
                  questionAnswer
                  block={{ ...block, text: answers.join("\n"), questionAnswers: undefined }}
                  layout={layout}
                  visible={visible ?? true}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
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
        cwd={cwd}
        onOpenFile={onOpenFile}
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

  if (block.role === "image") return block.image ? <GeneratedImage image={block.image} /> : null;

  if (block.role === "tool") {
    if (block.inlineVisual) return <InlineVisual snapshot={block.inlineVisual} />;
    if (isAdvisorBlock(block))
      return (
        <AdvisorRow
          block={block}
          modelSettings={planModelSettings}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      );
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
    if (block.modelSwitch) return <ModelSwitchRow meta={block.modelSwitch} embedded={embedded} />;
    if (isSessionErrorBlock(block))
      return (
        <div className={`${embedded ? "" : "px-4"} py-2`}>
          <SessionErrorNotice text={text} />
        </div>
      );
    return (
      <div
        role={isSessionErrorBlock(block) ? "alert" : undefined}
        className={`${embedded ? "" : "px-4"} py-2 ${block.notice === "interrupt" ? "font-medium text-(--ui-tone-danger-fg)" : isSessionErrorBlock(block) ? "text-(--ui-tone-danger-fg)" : "text-(--transcript-ink-body)"}`}
      >
        <OutputBlock face="sans" size="inherit" tone="inherit">
          {text}
        </OutputBlock>
      </div>
    );
  }

  if (!block.text && block.streaming) return null;

  return (
    <div
      data-selectable-agent-response={block.streaming ? undefined : block.id}
      className={`min-w-0 pb-1 text-(--transcript-ink-body) ${embedded ? "" : "px-4"} ${underLine ? "pt-1" : "pt-3"}`}
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
  const t = useT();
  const status = run.running
    ? null
    : run.timedOut
      ? t("timed out")
      : run.exitCode === null
        ? t("did not finish")
        : run.exitCode !== 0
          ? t("exit {p0}", { p0: run.exitCode })
          : null;
  return (
    <div className={`${embedded ? "" : "px-4"} py-2`}>
      <Surface
        data-shell-run
        variant="card"
        padding="none"
        className="overflow-hidden font-mono text-ui-caption leading-5"
      >
        <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
          <ChatRun
            className="mt-1 icon-xs shrink-0 text-(--transcript-ink-chrome)"
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
          <OutputBlock
            size="inherit"
            scroll
            className="max-h-80 border-t border-(--ui-tone-neutral-border) px-3 py-2"
          >
            {run.output.trimEnd()}
          </OutputBlock>
        ) : null}
      </Surface>
    </div>
  );
}

function UserMessageBlock({
  block,
  layout,
  visible,
  onEdit,
  canRewind = false,
  onRewind,
  editing = false,
  cwd,
  onOpenFile,
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
  onEdit?: () => void;
  canRewind?: boolean;
  onRewind?: (action: "edit" | "return") => void;
  editing?: boolean;
  cwd?: string;
  onOpenFile?: (path: string) => void;
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
      ? t("Sending…")
      : delivery === "undelivered"
        ? t("Not delivered")
        : delivery === "uncertain"
          ? t("May have been delivered")
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
  const { text, citations } = extractChatCitations(rawText);
  const firstLink = text ? parseUserMessageLink(text) : null;
  // Keep the compact URL card for plain prose. Splitting a formatted message
  // at a URL would break its links, code spans, or enclosing Markdown blocks.
  const messageLink =
    firstLink && !/[\n\r[`*_<~#]/.test(firstLink.beforeText + firstLink.afterText)
      ? firstLink
      : null;
  const chat = layout === "chat";
  const previewParts = userTextParts(text);
  const compactText = previewParts.some((part) => part.compact);
  // A chip carries its token's label only when the message mentions it, so
  // messages sent before tokens existed look as they always did.
  const attachmentFiles = block.attachments ?? [];
  const usedTokens = new Map(
    findTokens(text, attachmentFiles).map((match) => [match.index, match.token]),
  );
  const referencedTokens = attachmentFiles.map((_, index) => usedTokens.get(index));
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
          tooltip={canRewind ? undefined : t("This conversation can no longer be rewound.")}
          variant="ghost"
          type="button"
          disabled={!canRewind}
          startIcon={<ChatEditMessage className={showLabels ? undefined : "icon-md"} />}
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
          className="ms-1 whitespace-nowrap font-sans text-ui-caption tabular-nums text-(--transcript-ink-chrome)"
        />
      ) : null}
    </>
  );

  return (
    <div
      data-prompt-anchor={block.id}
      data-editing-last-turn={editing ? "true" : undefined}
      className={`user-message-row group/usermsg flex min-w-0 flex-col items-end overflow-visible ${questionAnswer ? "" : "pbs-1.5 pe-4 pbe-10 ps-14"}`}
    >
      <SessionMessageAuthor
        author={block.author}
        onOpen={
          block.author?.kind === "assistant" ||
          block.author?.kind === "assistant-manual" ||
          block.author?.kind === "assistant-room"
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
      <div className="user-message-hover-zone flex w-full min-w-0 max-w-full flex-col items-end overflow-visible">
        <div
          data-draft={block.draft ? "true" : undefined}
          data-chat-message-surface={block.draft ? undefined : "user"}
          data-follow-up-delivery={delivery}
          data-bycoda={bycoda ? "true" : undefined}
          className={`user-message-bubble relative min-w-0 px-3 py-2 font-sans text-(--transcript-ink-body) transition-[background-color] duration-200 ${editing ? "edit-last-turn-bubble" : ""} w-fit ${chat ? "max-w-[min(100%,36rem)]" : "max-w-full"} rounded-(--ui-radius-popup)`}
        >
          <ChatCitationList citations={citations} text={text} />
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
              markdown
              parts={previewParts}
              messageId={block.id}
              cwd={cwd}
              onOpenFile={onOpenFile}
              attachments={block.attachments}
              citations={citations}
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
              <UserMessageMarkdown
                text={messageLink.beforeText}
                cwd={cwd}
                onOpenFile={onOpenFile}
                attachments={block.attachments}
                citations={citations}
              />
              <UserLinkPreview link={messageLink.link} cwd={cwd} compact />
              <UserMessageMarkdown
                text={messageLink.afterText}
                cwd={cwd}
                onOpenFile={onOpenFile}
                attachments={block.attachments}
                citations={citations}
              />
            </div>
          ) : text ? (
            <div
              data-selectable-agent-response={block.id}
              ref={(element) => {
                textRef.current = element;
              }}
              className={`min-w-0 ${expanded || questionAnswer ? "" : "line-clamp-4"}`}
            >
              <UserMessageMarkdown
                text={text}
                cwd={cwd}
                onOpenFile={onOpenFile}
                attachments={block.attachments}
                citations={citations}
              />
            </div>
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
            <Disclosure
              size="sm"
              summary={t("CI context")}
              open={ciOpen}
              onOpenChange={setCiOpen}
              className="mt-2 min-w-0 border-t border-(--ui-tone-neutral-border) pt-2"
              onClick={(event) => event.stopPropagation()}
            >
              <OutputBlock frame="filled" scroll className="mt-2 max-h-72">
                {block.ciContext}
              </OutputBlock>
            </Disclosure>
          ) : null}
          {block.draft ? (
            <UserDraftFooter
              block={block}
              delivery={delivery}
              deliveryLabel={deliveryLabel}
              deliveryDescription={deliveryDescription}
              deliveryActive={deliveryActive}
              heldActionTitle={heldActionTitle}
              onEditDraft={onEditDraft}
              onRemoveDraft={onRemoveDraft}
              onSendDraft={onSendDraft}
            />
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
  meta,
  harness,
  live = false,
  expandable,
  open,
  onToggle,
}: {
  title: ReactNode;
  /** The model that did the work, when the title does not already name it. */
  meta?: string;
  harness?: HarnessId;
  live?: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const icon = (
    <span className="relative flex size-3.5 shrink-0 items-center justify-center">
      {harness ? (
        <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
      ) : (
        <ChatWork className="icon-sm shrink-0" />
      )}
    </span>
  );
  // While the agent runs, the clock shimmers here rather than at the bottom,
  // which is now bare. Same face as the settled line, so settling never
  // swaps the font under the reader. The model rides along as a quiet tag.
  const label = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {live ? (
          <span className="flex min-w-0 font-sans text-ui-body">{title}</span>
        ) : (
          <span className="min-w-0 truncate font-sans text-ui-body">{title}</span>
        )}
        {meta ? <span className="shrink-0 font-sans text-ui-caption">{meta}</span> : null}
      </span>
    </>
  );

  // The same step row as an activity group header: the whole row is the trigger, the chevron
  // is always there while the work can open, and nothing draws a selected box around it.
  return (
    <div className={`transcript-fold-line min-w-0${open ? " zen-fold-drop" : ""}`}>
      {expandable ? (
        <Disclosure
          variant="step"
          chevron="end"
          open={open}
          onOpenChange={(next) => {
            if (next !== open) onToggle();
          }}
          summaryLabel={open ? t("Hide the work") : t("Show the work")}
          aria-live={live ? "polite" : undefined}
          summary={label}
        />
      ) : (
        <Disclosure
          variant="step"
          collapsible={false}
          role={live ? "status" : undefined}
          summary={label}
        />
      )}
    </div>
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
const TranscriptSelectionActions = memo(
  function TranscriptSelectionActions({
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
      onTranslate && selection
        ? (target: TextActionTarget) => onTranslate(selection, target)
        : undefined,
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
  },
  (previous, next) =>
    previous.root === next.root &&
    previous.enabled === next.enabled &&
    previous.sessionId === next.sessionId &&
    previous.onAddToChat === next.onAddToChat &&
    previous.onAddToNotes === next.onAddToNotes &&
    previous.onTranslate === next.onTranslate &&
    sameBlocksIgnoringStreamingText(previous.blocks, next.blocks),
);
