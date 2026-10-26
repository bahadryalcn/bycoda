import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { shallowArrayEqual } from "../model/stableBlocks";
import { useFollowBottom } from "../hooks/useFollowBottom";
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
import type { TranscriptSelection } from "../model/transcriptSelection";
import { useTransientFlag } from "../../../shared/hooks/useTransientFlag";
import { INTERRUPT_MESSAGE, isTurnInterruptMessage } from "../model/inFlight";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { useLocale, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  FilePlusCorner,
  MessageMultiple,
  Replace,
  Minus,
  MoreHorizontal,
  Pencil,
  PenLine,
  Undo2,
  Bot,
  ChartBreakoutSquare,
  Search,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "../../../shared/ui/icons";
import { PerformanceTraceContext } from "./performanceTraceContext";
import {
  Activity,
  memo,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { TranscriptRetentionContext } from "./TranscriptPool";
import { flushSync } from "react-dom";
import { AttachmentChip } from "./AttachmentChip";
import { AttachmentTokenText } from "./AttachmentTokenText";
import { TranscriptSkills } from "./SkillTokenText";
import { UserTextPreview } from "./UserTextPreview";
import { userTextParts } from "../model/userTextPreview";
import { attachmentTokens, findTokens } from "../model/attachmentTokens";
import { GeneratedImage } from "./GeneratedImage";
import { BycodaSparkles } from "./BycodaSparkles";
import { OrchestratorConstellation } from "./OrchestratorConstellation";
import { PlanStepsBurst } from "./PlanStepsBurst";
import { FilePreview } from "../../files/ui/FilePreview";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { ToolDiffPreview } from "./ToolDiffPreview";
import { hasToolInspection, ToolInspectionPanel } from "./ToolInspectionPanel";
import { PlanPreview } from "./PlanPreview";
import { OrchestrationPreview } from "../../orchestration/ui/OrchestrationPreview";
import { TaskListPreview } from "./TaskListPreview";
import { HandoffButton, SecondOpinionButton } from "./SecondOpinionButton";
import { SecondOpinionCard } from "./SecondOpinionCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";

import { TerminalSpinner } from "./TerminalSpinner";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import {
  ExpandingButtonGroup,
  type ExpandingButtonGroupItem,
  type ExpandingButtonGroupTriggerProps,
} from "../../../shared/ui/ExpandingButtonGroup";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import type { ApprovalDecision } from "../../../integrations/harness";
import {
  isHarnessAuthBlock,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/authSupport";
import {
  isEditTool,
  isReadTool,
  isSearchTool,
  stubFilePreview,
} from "../../../integrations/harness/core/preview";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { Attachment } from "../model/session";
import type { ShellRun } from "../model/shellRun";
import { visibleUserPrompt } from "../../orchestration/model/orchestration";
import { playCue } from "../../settings/model/sounds";
import { legacyTaskListFromText } from "../model/taskList";
import {
  useResolvedModelName,
  useSubagentModelName,
  useToolCallDisplay,
} from "../model/reactiveReads";
import { harnessesForTurns } from "../model/secondOpinion";
import { streamingTextUpdate } from "../model/stableBlocks";
import { TranscriptTurnCache } from "../model/transcriptTurnCache";
import { Shimmer } from "../../../shared/ui/Shimmer";
import {
  hasPendingApproval,
  HARNESS_TITLE,
  type AgentStep,
  type Block,
  type HarnessId,
  type InterjectionMeta,
  type ModelTarget,
  type PlanBuildTarget,
  type ToolPreview,
  type TurnMetrics,
} from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";
import { isBackgroundOnly } from "../model/activityDock";
import { consumeOpenSubagent, OPEN_SUBAGENT_EVENT, requestViewSubagent } from "./subagentFocus";
import { innerScrollerTakes, useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useTranscriptLayout } from "../hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import type { TranscriptLayout } from "../../settings/model/appearance";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentClock } from "./AgentClock";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { parseUserMessageLink } from "../model/linkPreview";
import { UserLinkPreview } from "./UserLinkPreview";
import {
  activityPhaseTitle,
  activityStillRunning,
  buildActivityPhases,
  firstFoldableIndex,
  foldableWork,
  foldedBlocks,
  initialThinkingIndex,
  isIncompleteTool,
  isSubagentBlock,
  isThinkingBlock,
  lastActivityIndex,
  isProseBlock,
  needsApproval,
  proseSummary,
  subagentBrief,
  subagentName,
  subagentReport,
  subagentStatusLine,
  toolCallLabel,
  toolCallState,
  hasTurnCopyText,
  turnCopyText,
  workKind,
  workSummaryLine,
  type ActivityPhase,
  type ActivityPhaseKind,
  type ToolCallState,
  type TurnItem,
} from "../model/transcriptActivity";
import { lastUserTurnBlock } from "../model/editLastTurn";
import { bycodaToolCall, bycodaWorkSummary, type BycodaToolCall } from "../model/bycodaToolCall";
import { isOperatorUserTurn, operatorUserPrompt } from "../model/operatorCommand";
import {
  clearTranscriptHighlights,
  paintTranscriptHighlights,
  transcriptMutationNeedsRepaint,
  transcriptWordRanges,
} from "../model/transcriptHighlights";

const NEAR_BOTTOM_PX = 16;
const WHEEL_HOLD_MS = 150;
/*
 * Tool calls often land in a burst. Each arrival waits for the one before it
 * to finish its whole entrance — rail, branch, row — before starting its own.
 * The first few play at STEP_ENTRANCE_MS; a queue running past
 * STEP_QUEUE_CALM_MS plays the rest faster, down to STEP_ENTRANCE_MIN_MS by
 * STEP_QUEUE_MS, so a long burst still catches up.
 */
const STEP_ENTRANCE_MS = 480;
const STEP_ENTRANCE_MIN_MS = 160;
const STEP_QUEUE_CALM_MS = 960;
const STEP_QUEUE_MS = 2000;
const INITIAL_TURNS = 20;
/**
 * Turns built before a transcript first paints. Every turn in the initial
 * window costs markdown work on open, so paint the latest few (more if they
 * leave the viewport short) and build the rest of the window after.
 */
const FIRST_PAINT_TURNS = 3;
const TURN_PAGE_SIZE = 20;

type Props = {
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
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onAddToChat?: (text: string) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
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

/** Disclosure values survive releasing the transcript DOM, without retaining it. */
function useRetainedDisclosure<T extends boolean | null>(key: string, initial: T) {
  const retained = useContext(TranscriptRetentionContext);
  const [value, setValue] = useState<T>(
    () => (retained?.read().disclosures?.[key] as T | undefined) ?? initial,
  );
  useLayoutEffect(() => {
    retained?.setDisclosure(key, value);
  }, [retained, key, value]);
  return [value, setValue] as const;
}

function AgentTranscriptComponent({
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
  onApproval,
  onAddToChat,
  onSaveNote,
  onSendDraft,
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
  const sourceBlocks = useMemo(() => {
    if (!Object.keys(translations).length) return persistedBlocks;
    return persistedBlocks.map((block) => {
      const entry = translations[block.id];
      return entry && entry.source === block.text
        ? { ...block, text: entry.translatedVisible ? entry.translated : entry.original }
        : block;
    });
  }, [persistedBlocks, translations]);
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
      authFilterPrev.current = {
        harness,
        source: sourceBlocks,
        result: sourceBlocks,
      };
      return sourceBlocks;
    }
    const filtered = filterAuthErrors(harness, sourceBlocks);
    authFilterPrev.current = {
      harness,
      source: sourceBlocks,
      result: filtered,
    };
    return filtered;
  }, [harness, sourceBlocks]);
  const editableUserBlockId = useMemo(() => lastUserTurnBlock(blocks)?.id, [blocks]);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const retention = useContext(TranscriptRetentionContext);
  const retained = retention?.read();
  const restoreCheckpoint = useRef(retained?.scrollTop !== undefined ? { ...retained } : undefined);
  const restoringCheckpoint = useRef(retained?.scrollTop !== undefined);
  const stickToBottom = useRef(retained?.bottomFollow ?? true);
  const showJumpRef = useRef(false);
  const distanceFromBottom = useRef(0);
  const wheelHold = useRef(0);
  const scrollGeometry = useRef<{
    el: HTMLElement;
    top: number;
    height: number;
    viewport: number;
  } | null>(null);
  const prependHeight = useRef<number | null>(null);
  const wasVisible = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
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
  const [visibleTurnCount, setVisibleTurnCount] = useState(() => {
    const firstIndex = retained?.firstLoadedTurnId
      ? turns.findIndex((turn) => turn[0]?.id === retained.firstLoadedTurnId)
      : -1;
    return Math.max(
      retained?.visibleTurnCount ?? FIRST_PAINT_TURNS,
      firstIndex >= 0 ? turns.length - firstIndex : 0,
    );
  });
  // Turns whose folded work the reader has opened, by turn id.
  const [openWork, setOpenWork] = useState<Record<string, boolean>>(() => retained?.openWork ?? {});
  const [searchCurrent, setSearchCurrent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const highlightOwner = useRef(Symbol("transcript-search"));
  const toggleWork = useCallback((turnId: string, currentlyOpen: boolean) => {
    setOpenWork((open) => ({ ...open, [turnId]: !currentlyOpen }));
  }, []);
  // Stretch the last turn after a send while this tab stays open. Closing
  // the tab is a new visit: the remount uses the true transcript height so
  // the latest reply sits near the composer instead of a hole of empty space.
  const [anchorTurn, setAnchorTurn] = useState(!!busy);
  // Parking detaches the scroller, which drops its scroll offset.
  const restoreScroll = useRef(false);
  const wasParked = useRef(parked);
  if (wasParked.current !== parked) {
    wasParked.current = parked;
    if (parked) {
      restoreScroll.current = true;
      setSearchCurrent(null);
      setSearchQuery("");
    } else if (anchorTurn !== !!busy) {
      setAnchorTurn(!!busy);
    }
  }
  const transcriptLayout = useTranscriptLayout();
  const promptAnchor = useTranscriptAnchor();
  const lastUserId = lastUserBlockId(blocks, managed);
  const checkpointUserId = useRef(lastUserId);
  const seenUserId = useRef(lastUserId);
  if (lastUserId !== seenUserId.current) {
    seenUserId.current = lastUserId;
    if (lastUserId && !anchorTurn) setAnchorTurn(true);
  }
  const currentModelName = useResolvedModelName(harness, model);
  const blockingQuestion = pendingQuestion && questionBehavior === "blocking";
  const waitingForApproval = hasPendingApproval(blocks) || blockingQuestion;
  const preparingHandoff = blocks.some(
    (block) => block.role === "handoff" && block.handoff?.status === "preparing",
  );

  const setShowJump = useCallback(
    (show: boolean) => {
      if (showJumpRef.current === show) return;
      showJumpRef.current = show;
      onJumpToBottomChange?.(show);
    },
    [onJumpToBottomChange],
  );

  const rememberScroll = useCallback(
    (el: HTMLElement) => {
      scrollGeometry.current = {
        el,
        top: el.scrollTop,
        height: el.scrollHeight,
        viewport: el.clientHeight,
      };
      if (!retention || restoringCheckpoint.current || !el.isConnected || !el.clientHeight) return;
      // Following the end restores by pinning to the bottom; skip the per-turn
      // layout reads on every streamed resize while that is all a restore needs.
      if (stickToBottom.current) {
        retention.update({ scrollTop: el.scrollTop, bottomFollow: true });
        return;
      }
      const top = el.getBoundingClientRect().top;
      const anchor = [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
        (node) => node.getBoundingClientRect().bottom > top,
      );
      retention.update({
        anchorId: anchor?.dataset.transcriptTurn,
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
        scrollTop: el.scrollTop,
        bottomFollow: stickToBottom.current,
      });
    },
    [retention],
  );

  const syncPinned = useCallback(
    (el: HTMLElement) => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const previous = scrollGeometry.current;
      // Content growth and folding also queue scroll events. They must not
      // cancel following before ResizeObserver gets a chance to pin the end.
      // A stable layout moving upward also covers scrollbar/touch/keyboard
      // navigation, including movement inside the near-bottom margin.
      const scrolledUp =
        !!previous &&
        previous.el === el &&
        previous.height === el.scrollHeight &&
        previous.viewport === el.clientHeight &&
        el.scrollTop < previous.top;
      // Scrolling up inside the bottom margin is the reader leaving. Pinning
      // again here would snap each streamed chunk back down under the wheel.
      const layoutChanged =
        !!previous &&
        previous.el === el &&
        (previous.height !== el.scrollHeight || previous.viewport !== el.clientHeight);
      const clamped = !!previous && scrollClampedToBottom(el, previous.top);
      const leaving =
        scrolledUp || (!stickToBottom.current && distance > distanceFromBottom.current);
      const near = stickToBottom.current
        ? !scrolledUp
        : !layoutChanged &&
          !clamped &&
          isNearBottom(el) &&
          !leaving &&
          !!previous &&
          el.scrollTop > previous.top;
      stickToBottom.current = near;
      distanceFromBottom.current = distance;
      rememberScroll(el);
      setShowJump(!near);
    },
    [rememberScroll, setShowJump],
  );

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true;
    distanceFromBottom.current = 0;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinToBottom(el);
    if (el) rememberScroll(el);
  }, [rememberScroll, setShowJump]);

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      setScrollerEl(el);
      lockOverscroll(el);
    },
    [lockOverscroll],
  );

  useEffect(() => {
    onJumpToBottomReady?.(jumpToBottom);
    return () => onJumpToBottomReady?.(null);
  }, [jumpToBottom, onJumpToBottomReady]);

  // A pooled transcript outlives its pane; tell each new owner where it stands.
  useEffect(() => {
    onJumpToBottomChange?.(showJumpRef.current);
  }, [onJumpToBottomChange]);

  useLayoutEffect(() => {
    onScrollerChange?.(scrollerEl);
    return () => onScrollerChange?.(null);
  }, [onScrollerChange, scrollerEl]);

  useEffect(() => {
    if (!visible || !scrollerEl) return;
    syncPinned(scrollerEl);
    const onScroll = () => {
      if (scrollerEl.isConnected && scrollerEl.clientHeight > 0) syncPinned(scrollerEl);
    };
    let release: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (innerScrollerTakes(scrollerEl, e)) return;
      if (e.deltaY < 0) {
        stickToBottom.current = false;
        setShowJump(true);
      } else if (e.deltaY === 0) {
        // A directionless trackpad event can precede an off-thread scroll.
        // Wait for its direction before following new output.
        wheelHold.current = performance.now() + WHEEL_HOLD_MS;
        clearTimeout(release);
        release = setTimeout(() => {
          if (!scrollerEl.isConnected) return;
          syncPinned(scrollerEl);
          if (stickToBottom.current) {
            pinToBottom(scrollerEl);
            rememberScroll(scrollerEl);
          }
        }, WHEEL_HOLD_MS);
      }
    };
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(release);
      scrollerEl.removeEventListener("scroll", onScroll);
      scrollerEl.removeEventListener("wheel", onWheel);
    };
  }, [rememberScroll, scrollerEl, setShowJump, syncPinned, visible]);

  useLayoutEffect(() => {
    if (restoreCheckpoint.current && lastUserId === checkpointUserId.current) return;
    restoreCheckpoint.current = undefined;
    restoringCheckpoint.current = false;
    stickToBottom.current = true;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinToBottom(el);
    if (el) rememberScroll(el);
  }, [lastUserId, rememberScroll, setShowJump]);

  // In the chat layout a sent prompt rises from the upper screen into its
  // anchored spot at the top. On mount this only plays for a session's first
  // send.
  const introducePrompt = useRef({ chat: false, anchor: false, visible });
  introducePrompt.current = {
    chat: transcriptLayout === "chat",
    anchor: promptAnchor && anchorTurn,
    visible,
  };
  const introducedPromptMount = useRef(false);
  useLayoutEffect(() => {
    const mounting = !introducedPromptMount.current;
    introducedPromptMount.current = true;
    const { chat, anchor, visible } = introducePrompt.current;
    if (!lastUserId || !chat || !anchor || !visible) return;
    if (mounting && !(busy && userTurnCount(blocks, managed) === 1)) return;
    return riseIntoAnchor(scroller.current, lastUserId);
    // Only a new prompt starts the motion; later renders must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId]);

  useLayoutEffect(() => {
    const opened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opened) return;
    const el = scroller.current;
    if (!el) return;
    syncTranscriptViewport(el);
    const restore = restoreScroll.current;
    restoreScroll.current = false;
    // Previously opened tabs normally retain their scroll position. Only pin
    // when the scroller looks empty after being hidden with `display: none`.
    if (el.scrollHeight <= el.clientHeight + NEAR_BOTTOM_PX) {
      stickToBottom.current = true;
      setShowJump(false);
      pinToBottom(el);
    } else if (restore && stickToBottom.current) {
      pinToBottom(el);
      rememberScroll(el);
    } else if (restore) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - distanceFromBottom.current);
    }
  }, [rememberScroll, visible, setShowJump]);

  // The one place that follows streamed content to the bottom. Observer
  // callbacks run after layout and before paint, so the pin lands in the same
  // frame as the content and reads geometry the browser has already computed.
  // A layout effect keyed on `blocks` would force a second layout per frame.
  useLayoutEffect(() => {
    const el = scrollerEl;
    const inner = el?.querySelector("[data-transcript-content]");
    if (!visible || !el || !inner) return;
    const onResize = (entries?: ResizeObserverEntry[]) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      // The padding only changes with the container, never with its content.
      syncTranscriptViewport(el, !entries || entries.some((entry) => entry.target === el));
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (stickToBottom.current) {
        if (performance.now() < wheelHold.current) return;
        pinToBottom(el);
        distanceFromBottom.current = 0;
        rememberScroll(el);
        return;
      }
      distanceFromBottom.current = distance;
      rememberScroll(el);
      setShowJump(!isNearBottom(el));
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(inner);
    observer.observe(el);
    onResize();
    return () => observer.disconnect();
  }, [rememberScroll, scrollerEl, setShowJump, visible]);

  useTurnScrollAnchor(scrollerEl, visible, stickToBottom, rememberScroll);

  const firstVisibleTurn = Math.max(0, turns.length - visibleTurnCount);
  const visibleTurns = turns.slice(firstVisibleTurn);
  useLayoutEffect(() => {
    retention?.update({
      visibleTurnCount,
      firstLoadedTurnId: visibleTurns[0]?.[0]?.id,
      lastLoadedTurnId: visibleTurns[visibleTurns.length - 1]?.[0]?.id,
      openWork,
    });
  });
  // Streaming changes only the tail; explicit edits to older turns must still
  // refresh their cached find ranges even when the number of turns is unchanged.
  const searchHistory = useStableValue(
    searchQuery ? visibleTurns.slice(0, -1) : [],
    shallowArrayEqual,
  );
  const lastTurnId = turns[turns.length - 1]?.[0]?.id;
  const turnHarnesses = harness ? harnessesForTurns(blocks, visibleTurns, harness) : undefined;
  const stableLoadRemoteBlock = useStableCallback(onLoadRemoteBlock);
  const stableApproval = useStableCallback(onApproval);
  const stableSaveNote = useStableCallback(onSaveNote);
  const stableSendDraft = useStableCallback(onSendDraft);
  const stableRemoveDraft = useStableCallback(onRemoveDraft);
  const stableOpenFile = useStableCallback(onOpenFile);
  const stableOpenDiff = useStableCallback(onOpenDiff);
  const stableOpenPlan = useStableCallback(onOpenPlan);
  const stableBuildPlan = useStableCallback(onBuildPlan);
  const stableSecondOpinion = useStableCallback(onSecondOpinion);
  const stableHandoff = useStableCallback(onHandoff);
  const stableEditLastTurn = useStableCallback(onEditLastTurn);
  const stableCanRewindMessage = useStableCallback(canRewindMessage);
  const stableRewindMessage = useStableCallback(onRewindMessage);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const visibleTurnCountRef = useRef(visibleTurnCount);
  visibleTurnCountRef.current = visibleTurnCount;

  useLayoutEffect(() => {
    const previousHeight = prependHeight.current;
    const el = scroller.current;
    if (!el) return;
    if (previousHeight == null) {
      // The opening window grows above the screen. Settle the offset in this
      // commit: a scroll event queued by an earlier pin would otherwise read
      // the taller transcript first and unpin it partway up.
      if (stickToBottom.current) {
        syncTranscriptViewport(el);
        pinToBottom(el);
      } else {
        el.scrollTop = el.scrollHeight - el.clientHeight - distanceFromBottom.current;
      }
      return;
    }
    prependHeight.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
    distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [visibleTurnCount, blocks.length]);

  // Short turns can leave the first paint with empty space above them, and
  // the rest of the window arriving later would then push everything down.
  // Top up before painting until the viewport is covered.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || el.clientHeight === 0) return;
    if (visibleTurnCount >= Math.min(INITIAL_TURNS, turns.length)) return;
    if (el.scrollHeight > el.clientHeight) return;
    setVisibleTurnCount((count) => Math.min(INITIAL_TURNS, count + FIRST_PAINT_TURNS));
  }, [visibleTurnCount, turns.length]);

  useEffect(() => {
    // Interruptible, so switching away before it finishes costs nothing.
    startTransition(() => setVisibleTurnCount((count) => Math.max(count, INITIAL_TURNS)));
  }, []);

  const prepareToPrepend = useCallback(() => {
    const el = scroller.current;
    if (el) prependHeight.current = el.scrollHeight;
    stickToBottom.current = false;
  }, []);

  const loadEarlier = async () => {
    prepareToPrepend();
    if (firstVisibleTurn > 0) {
      setVisibleTurnCount((count) => Math.min(turns.length, count + TURN_PAGE_SIZE));
      return;
    }
    if (remoteHistoryHasMore && onLoadRemoteHistory) {
      const count = await onLoadRemoteHistory();
      setVisibleTurnCount((current) => current + Math.max(1, Number(count) || TURN_PAGE_SIZE));
    }
  };

  const revealBlock = useCallback(
    (blockId: string): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) => turn.some((block) => block.id === blockId));
      if (index < 0) return false;
      const needed = all.length - index;
      if (needed <= visibleTurnCountRef.current) return true;
      prepareToPrepend();
      // Synchronous. The caller finds the turn in the DOM after this call.
      flushSync(() => setVisibleTurnCount(needed));
      return true;
    },
    [prepareToPrepend],
  );

  useEffect(() => {
    onRevealReady?.(revealBlock);
    return () => onRevealReady?.(null);
  }, [revealBlock, onRevealReady]);

  const alignFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(alignFrame.current), []);
  const navigateToBlock = useCallback(
    (blockId: string | null, query = ""): boolean => {
      if (!blockId) {
        setSearchCurrent(null);
        setSearchQuery("");
        return true;
      }
      const turn = turnsRef.current.find((item) => item.some((block) => block.id === blockId));
      if (!turn || !revealBlock(blockId)) return false;
      const turnId = turn[0].id;
      // A result inside folded work needs its row rendered before measuring it.
      flushSync(() => {
        setOpenWork((current) => (current[turnId] ? current : { ...current, [turnId]: true }));
        setSearchCurrent(blockId);
        setSearchQuery(query);
      });
      const el = scroller.current;
      if (!el) return false;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      const align = () => {
        const target =
          el.querySelector<HTMLElement>('[data-transcript-search-current="true"]') ??
          el.querySelector<HTMLElement>(`[data-transcript-turn="${CSS.escape(turnId)}"]`);
        if (!target) return;
        const wordRect = query
          ? transcriptWordRanges(el, query).current?.getBoundingClientRect?.()
          : null;
        const targetTop =
          wordRect && wordRect.height > 0 ? wordRect.top : target.getBoundingClientRect().top;
        const delta = targetTop - el.getBoundingClientRect().top - 42;
        if (Math.abs(delta) > 2) el.scrollTop += delta;
      };
      align();
      cancelAnimationFrame(alignFrame.current);
      alignFrame.current = requestAnimationFrame(align);
      return true;
    },
    [revealBlock],
  );

  useEffect(() => {
    onNavigateReady?.(navigateToBlock);
    return () => onNavigateReady?.(null);
  }, [navigateToBlock, onNavigateReady]);

  useEffect(() => {
    const el = scroller.current;
    const owner = highlightOwner.current;
    if (!el || !visible || !searchQuery) {
      clearTranscriptHighlights(owner);
      return;
    }
    let frame = 0;
    let pending: MutationRecord[] = [];
    const content = el.querySelector("[data-transcript-content]");
    const tail = content?.querySelector<HTMLElement>(".transcript-turn:last-child");
    let history: ReturnType<typeof transcriptWordRanges> | undefined;
    const paint = (resetHistory = false) => {
      if (!busy || !tail) {
        const { matches, current } = transcriptWordRanges(el, searchQuery);
        paintTranscriptHighlights(owner, matches, current);
        return;
      }
      if (resetHistory || !history) history = transcriptWordRanges(el, searchQuery, tail);
      const live = transcriptWordRanges(tail, searchQuery);
      paintTranscriptHighlights(
        owner,
        [...history.matches, ...live.matches],
        history.current ?? live.current,
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) pending.push(record);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const changed = pending;
        pending = [];
        if (transcriptMutationNeedsRepaint(changed, searchQuery))
          paint(changed.some((record) => record.target === content));
      });
    });
    // Completed turns are immutable while streaming. Structural turn changes
    // reconnect this effect; do not watch every historical Markdown subtree.
    if (!busy) observer.observe(el, { childList: true, characterData: true, subtree: true });
    else if (tail)
      observer.observe(tail, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    if (content) observer.observe(content, { childList: true });
    paint();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTranscriptHighlights(owner);
    };
  }, [
    visible,
    searchQuery,
    searchCurrent,
    visibleTurnCount,
    openWork,
    searchHistory,
    lastTurnId,
    busy,
  ]);

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
  }, [retention, scrollerEl, visible]);

  useLayoutEffect(() => {
    const checkpoint = restoreCheckpoint.current;
    const el = scroller.current;
    if (!visible || !el || !checkpoint) return;
    let frame = 0;
    const restore = () => {
      if (!el.clientHeight) return;
      stickToBottom.current = checkpoint.bottomFollow ?? true;
      if (stickToBottom.current) pinToBottom(el);
      else {
        const anchor = [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
          (node) => node.dataset.transcriptTurn === checkpoint.anchorId,
        );
        el.scrollTop = anchor
          ? el.scrollTop +
            anchor.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            (checkpoint.anchorOffset ?? 0)
          : (checkpoint.scrollTop ?? 0);
      }
      distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(!stickToBottom.current);
      // Save geometry only after the checkpoint has been applied.
      restoringCheckpoint.current = false;
      rememberScroll(el);
    };
    restore();
    frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    const content = el.querySelector("[data-transcript-content]");
    if (content) observer.observe(content);
    const stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    const finish = () => {
      restoreCheckpoint.current = undefined;
      restoringCheckpoint.current = false;
      stop();
    };
    // Compensate delayed markdown/highlight layout, until the reader takes over.
    const timeout = setTimeout(finish, 1000);
    el.addEventListener("wheel", finish, { passive: true });
    el.addEventListener("pointerdown", finish);
    el.addEventListener("keydown", finish);
    return () => {
      // Activity and StrictMode replay effects. Keep the checkpoint until a
      // completed restore or reader interaction, rather than clearing on replay.
      stop();
      clearTimeout(timeout);
      el.removeEventListener("wheel", finish);
      el.removeEventListener("pointerdown", finish);
      el.removeEventListener("keydown", finish);
    };
  }, [lastUserId, rememberScroll, scrollerEl, setShowJump, visible]);

  return (
    <PerformanceTraceContext.Provider value={performanceTraceId}>
      <div
        ref={setScroller}
        tabIndex={-1}
        onClickCapture={(event) => {
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
          <div className="sticky inset-bs-0 z-10 flex flex-wrap items-center justify-end gap-2 bg-(--ui-surface) px-4 py-2 font-sans text-xs text-(--ui-text-secondary)">
            <span>{t("After applying: ↑ original, ↓ translation.")}</span>
            <Button
              motion="none"
              variant="ghost"
              type="button"
              aria-pressed={!activeVersion.translatedVisible}
              onClick={() => showTranslation(false)}
            >
              {t("Original text")}
            </Button>
            <Button
              motion="none"
              variant="ghost"
              type="button"
              aria-pressed={activeVersion.translatedVisible}
              onClick={() => showTranslation(true)}
            >
              {t("Translation")}
            </Button>
          </div>
        ) : null}
        <div
          data-transcript-content
          className="transcript-content mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-1 pb-8"
        >
          {historyLoading ? (
            <div role="status" className="px-4 py-3 font-sans text-xs text-(--ui-text-secondary)">
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
                onRemoveDraft={stableRemoveDraft}
                onOpenFile={stableOpenFile}
                onOpenDiff={stableOpenDiff}
                onOpenPlan={stableOpenPlan}
                onBuildPlan={stableBuildPlan}
                onLoadRemoteBlock={stableLoadRemoteBlock}
                onSecondOpinion={stableSecondOpinion}
                onHandoff={stableHandoff}
                onEditLastTurn={stableEditLastTurn}
                canRewindMessage={stableCanRewindMessage}
                onRewindMessage={stableRewindMessage}
              />
            );
          })}
        </div>
        {onAddToChat || onSaveSelectionNote || canOfferTranslation(translationContext) ? (
          <TranscriptSelectionActions
            root={scrollerEl}
            enabled={visible}
            onAddToChat={onAddToChat}
            onAddToNotes={onSaveSelectionNote}
            onTranslate={
              canOfferTranslation(translationContext)
                ? (selection, target) => {
                    const source = persistedBlocks.find(
                      (block) => block.id === selection?.responseId,
                    )?.text;
                    const displayed = sourceBlocks.find(
                      (block) => block.id === selection?.responseId,
                    )?.text;
                    if (selection && source !== undefined && displayed !== undefined)
                      setTranslationRequest({ selection, target, source, displayed });
                  }
                : undefined
            }
          />
        ) : null}
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
  return <Activity mode={props.visible === false ? "hidden" : "visible"}>{transcript}</Activity>;
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
          <div className="mx-4 mb-1 flex items-center gap-2">
            <Button
              motion="none"
              variant="ghost"
              type="button"

              onClick={() =>
                void onLoadRemoteBlock(item.block.id, item.block.remoteContent!.revision)
              }
            >
              {t("Load full output (")}
              {Math.max(1, Math.ceil(item.block.remoteContent.bytes / 1024))}
              {t(" KB)")}
            </Button>
          </div>
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
        const row = (
          <div
            key={turnItemKey(item)}
            data-transcript-search-item
            data-transcript-search-current={isCurrentItem(item) || undefined}
            className="flow-root pb-1"
          >
            {renderItem(item, itemIndex)}
          </div>
        );
        if (itemIndex !== foldLineAt) return row;
        return [foldLineRow, row];
      })}
      {foldLineAt >= items.length ? foldLineRow : null}
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
      className={`min-w-0 pt-3 pb-1 font-sans text-sm text-(--ui-text-secondary) ${embedded ? "" : "px-4"}`}
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
        className="min-w-0 truncate font-sans text-sm text-(--ui-text-secondary)"
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
    <Shimmer className="min-w-0 truncate font-sans text-sm" duration={1}>
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
    <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-(--ui-tone-neutral-border)" />
  );
  return (
    <div
      aria-label={label}
      className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2.5 px-4 pt-1 pb-3 font-sans text-sm text-(--ui-text-secondary)"
    >
      <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {hasOutput ? null : turn.some(
            (block) => block.role === "user" && block.turnOutcome === "stopped",
          ) ? (
          <X className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Check className="size-3.5" strokeWidth={1.75} />
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
                  } satisfies ExpandingButtonGroupItem,
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
                  } satisfies ExpandingButtonGroupItem,
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
                  } satisfies ExpandingButtonGroupItem,
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
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
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
  renderTrigger?: (props: ExpandingButtonGroupTriggerProps) => ReactNode;
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
          title={t("Turn metrics")}
        >
          <ChartBreakoutSquare className="size-3.5" strokeWidth={1.75} />
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

/** One action group; model menus and metric details retain their own state and overlays. */
function TurnOutputActions({
  getText,
  onSave,
  extraItems = [],
}: {
  getText?: () => string;
  onSave?: (text: string) => void | Promise<void>;
  extraItems?: ExpandingButtonGroupItem[];
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [getText]);

  const handleAction = async (action: "copy" | "save") => {
    if (!getText) return false;
    setError(null);
    try {
      if (action === "copy") {
        await copyMessage(getText());
      } else {
        await onSave?.(getText());
      }
      playCue("copy");
      return true;
    } catch (cause) {
      setError(
        (action === "copy" ? t("Copy failed. ") : t("Could not save note. ")) +
          (cause instanceof Error ? cause.message : String(cause)),
      );
      return false;
    }
  };
  if (!getText && extraItems.length === 0) return null;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
      <ExpandingButtonGroup
        label={t("Message actions")}
        size="sm"
        fit
        confirmDuration={2000}
        items={[
          ...(getText
            ? [
                {
                  id: "copy",
                  label: t("Copy response"),
                  icon: <Copy />,
                  doneLabel: t("Copied"),
                  onSelect: () => handleAction("copy"),
                },
              ]
            : []),
          ...(getText && onSave
            ? [
                {
                  id: "save",
                  label: t("Save as note"),
                  icon: <FilePlusCorner />,
                  doneLabel: t("Saved to Notes"),
                  onSelect: () => handleAction("save"),
                },
              ]
            : []),
          ...extraItems,
        ]}
      />
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-(--ui-text-secondary)">
          {error}
        </span>
      ) : null}
    </div>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [copied, setCopied] = useTransientFlag(2000);

  useEffect(() => {
    setCopied(false);
    setError(null);
  }, [text, getText, attachments]);

  return (
    <>
      <Button
        iconOnly={!showLabel}
        label={copied ? t("Copied") : label}
        motion="none"
        variant="ghost"
        type="button"
        disabled={pending}
        title={copied ? t("Copied") : label}
        aria-label={copied ? t("Copied") : label}
        loading={pending}
        startIcon={
          showLabel ? (
            copied ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )
          ) : undefined
        }
        onClick={(event) => {
          event.stopPropagation();
          if (inFlight.current) return;
          inFlight.current = true;
          setError(null);
          setCopied(false);
          setPending(true);
          playCue("copy");
          void copyMessage(text ?? getText?.() ?? "", attachments).then(
            () => {
              inFlight.current = false;
              setPending(false);
              setCopied(true);
            },
            (error: unknown) => {
              inFlight.current = false;
              setPending(false);
              setError(error instanceof Error ? error.message : String(error));
            },
          );
        }}
      >
        {!showLabel &&
          (copied ? (
            <Check className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.75} />
          ))}
        {showLabel ? <span>{copied ? t("Copied") : label}</span> : null}
      </Button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-(--ui-text-secondary)">
          {t("Copy failed. ")}
          {error}
        </span>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [saved, setSaved] = useTransientFlag(2000);

  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [text, getText]);

  return (
    <>
      <Button
        iconOnly={!showLabel}
        label={saved ? t("Saved to Notes") : t("Save as note")}
        motion="none"
        variant="ghost"
        type="button"
        disabled={pending}
        title={saved ? t("Saved to Notes") : t("Save as note")}
        aria-label={saved ? t("Saved to Notes") : t("Save as note")}
        loading={pending}
        startIcon={
          showLabel ? (
            saved ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <FilePlusCorner className="size-3.5" strokeWidth={1.75} />
            )
          ) : undefined
        }
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setError(null);
          setSaved(false);
          setPending(true);
          try {
            await onSave(text ?? getText?.() ?? "");
            playCue("copy");
            setSaved(true);
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            inFlight.current = false;
            setPending(false);
          }
        }}
      >
        {!showLabel &&
          (saved ? (
            <Check className="size-3.5" strokeWidth={1.75} />
          ) : (
            <FilePlusCorner className="size-3.5" strokeWidth={1.75} />
          ))}
        {showLabel ? <span>{saved ? t("Saved to Notes") : t("Save as note")}</span> : null}
      </Button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-(--ui-text-secondary)">
          {t("Could not save note. ")}
          {error}
        </span>
      )}
    </>
  );
}

function MessageEditMenu({
  onEdit,
  editing = false,
  onRewind,
  dismiss,
}: {
  onEdit?: () => void;
  editing?: boolean;
  onRewind?: (mode: "edit" | "return") => void;
  dismiss?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = t("Message actions");
  const items: DropdownMenuItem[] = [
    ...(onEdit
      ? [
          {
            kind: "item",
            id: "resend",
            label: editing ? t("Cancel edit") : t("Edit and resend"),
            icon: <Pencil />,
          } satisfies DropdownMenuItem,
        ]
      : []),
    ...(onRewind
      ? [
          {
            kind: "item",
            id: "edit",
            label: t("Edit this message"),
            icon: <Pencil />,
          } satisfies DropdownMenuItem,
          {
            kind: "item",
            id: "return",
            label: t("Return before this message"),
            icon: <Undo2 />,
          } satisfies DropdownMenuItem,
        ]
      : []),
  ];
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
            } else if (id === "edit") onRewind?.("edit");
            else if (id === "return") onRewind?.("return");
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
                <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed">
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
        onRemoveDraft={onRemoveDraft}
      />
    );
  }

  if (block.role === "image") {
    return block.image ? <GeneratedImage image={block.image} /> : null;
  }

  if (block.role === "tool") {
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
        className="overflow-hidden rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-tone-neutral-solid)/[0.03] font-mono text-ui-caption leading-5"
      >
        <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
          <Terminal
            className="mt-1 size-3 shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-(--ui-tone-neutral-fg)">
            {run.command}
          </span>
          {run.running ? (
            <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-ui-micro text-(--ui-text-secondary)" />
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
  onRemoveDraft?: (block: Block) => boolean | void;
  busy?: boolean;
  questionAnswer?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useRetainedDisclosure<boolean>(`prompt:${block.id}`, false);
  const [ciOpen, setCiOpen] = useRetainedDisclosure<boolean>(`ci:${block.id}`, false);
  const [overflows, setOverflows] = useState(false);
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
  const text =
    card && card.kind !== "handoff"
      ? ""
      : visibleUserPrompt(bycoda ? operatorUserPrompt(block) : block.text);
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
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !text) {
      setOverflows(false);
      return;
    }

    const measure = () => {
      if (!expanded) {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded, visible, compactText]);

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
      {onEdit || (onRewind && canRewind && !block.draft && !block.internal) ? (
        <MessageEditMenu
          onEdit={onEdit}
          editing={editing}
          dismiss={dismiss}
          onRewind={onRewind && canRewind && !block.draft && !block.internal ? onRewind : undefined}
        />
      ) : null}
      {block.startedAt != null ? (
        <Timestamp
          value={block.startedAt}
          className="ms-1 whitespace-nowrap font-sans text-xs text-(--ui-text-secondary)"
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
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  token={referencedTokens[index]}
                  tokenLabelPlacement="overlay"
                />
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
              className="user-message-with-link min-w-0 whitespace-pre-wrap break-words font-sans text-sm"
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
              className={`min-w-0 whitespace-pre-wrap break-words font-sans text-sm ${expanded || questionAnswer ? "" : "line-clamp-4"}`}
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
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs text-(--ui-text-secondary) transition-colors hover:text-(--ui-text-secondary) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--ui-focus-ring-color) [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3 shrink-0 transition-transform group-open/ci:rotate-90" />
                <span>{t("CI context")}</span>
              </summary>
              <p className="mt-2 text-xs text-(--ui-text-secondary)">
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
                className="flex items-center gap-1.5 text-xs text-(--ui-text-secondary)"
                role={delivery ? "status" : undefined}
                title={deliveryDescription}
              >
                <CircleDashed className="size-3.5" strokeWidth={1.75} />
                {deliveryLabel}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  motion="none"
                  variant="ghost"
                  type="button"
                  title={deliveryActive ? heldActionTitle : t("Remove draft")}
                  aria-label={t("Remove draft")}
                  disabled={deliveryActive}
                  onClick={() => onRemoveDraft?.(block)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  {t("Remove")}
                </Button>
                <Button
                  motion="none"
                  variant="ghost"
                  type="button"
                  title={deliveryActive ? heldActionTitle : t("Send draft")}
                  aria-label={t("Send draft")}
                  disabled={deliveryActive}
                  onClick={() => onSendDraft?.(block)}
                >
                  {t("Send")}
                  <ArrowUp className="size-3.5" strokeWidth={2.25} />
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
        {text ||
        block.attachments?.length ||
        block.startedAt != null ||
        onEdit ||
        (onRewind && canRewind) ? (
          <div className="user-message-actions flex max-w-full flex-wrap items-center justify-end gap-1 px-3 pt-1">
            {renderMessageActions()}
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
  const [foldState, setFoldState] = useState<"open" | "opening" | "closing" | "closed">(
    folded ? "closed" : "open",
  );

  useLayoutEffect(() => {
    setFoldState((current) => {
      if (folded) {
        return current === "closed" || current === "closing" ? current : "closing";
      }
      return current === "open" || current === "opening" ? current : "opening";
    });
  }, [folded]);

  useEffect(() => {
    if (foldState !== "opening" && foldState !== "closing") return;
    // Hidden tabs and reduced-motion styles may never fire animationend.
    const timer = window.setTimeout(() => {
      setFoldState(folded ? "closed" : "open");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [foldState, folded]);

  if (folded && foldState === "closed") return null;

  return (
    // `inert` keeps folded work out of tab order and off the screen reader.
    <div
      className="zen-fold-item"
      data-fold-state={foldState}
      inert={folded}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        setFoldState(folded ? "closed" : "open");
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
        <ChevronRight
          className="size-3.5 rotate-90 text-(--ui-text-secondary)"
          strokeWidth={1.75}
        />
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
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
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

/**
 * The turn's work as phases. Related reasoning and calls stay together while
 * assistant prose remains outside as full-size transcript text. The phase the
 * agent is in stays open, with new steps scrolling inside a short window; the
 * moment it moves on the phase folds back to its header.
 */
type ActivityPhasesProps = {
  blocks: Block[];
  cwd?: string;
  done?: boolean;
  /** False inside a nested panel, which supplies its own gutter. */
  padded?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
};

export const ActivityPhases = memo(function ActivityPhases({
  blocks,
  cwd,
  done,
  padded = true,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: ActivityPhasesProps) {
  useLocale();
  const phases = useMemo(() => buildActivityPhases(blocks), [blocks]);

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${padded ? "px-4" : ""}`}>
      {phases.map((phase, index) => (
        <ActivityPhaseGroup
          key={phase.id}
          phase={phase}
          cwd={cwd}
          active={!done && index === phases.length - 1}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}, sameActivity);

/**
 * A settled group is the same calls it was on the last token. Comparing the
 * blocks themselves keeps every earlier turn out of the streaming re-render,
 * which is most of what makes a long transcript stutter while the agent works.
 */
function sameActivity(a: ActivityPhasesProps, b: ActivityPhasesProps): boolean {
  return (
    a.cwd === b.cwd &&
    a.done === b.done &&
    a.padded === b.padded &&
    a.onApproval === b.onApproval &&
    a.onOpenFile === b.onOpenFile &&
    a.onOpenDiff === b.onOpenDiff &&
    a.blocks.length === b.blocks.length &&
    a.blocks.every((block, index) => block === b.blocks[index])
  );
}

/**
 * Hold the reader's place when loaded turns above the viewport change height
 * (images, expanded work or Markdown). Native scroll anchoring is disabled;
 * compensate only the changed turns that were wholly above the reader.
 */
function useTurnScrollAnchor(
  el: HTMLDivElement | null,
  enabled: boolean,
  stickToBottom: RefObject<boolean>,
  onAdjust: (el: HTMLElement) => void,
) {
  useLayoutEffect(() => {
    const inner = el?.querySelector("[data-transcript-content]");
    if (!enabled || !el || !inner) return;
    const heights = new WeakMap<Element, number>();
    const widths = new WeakMap<Element, number>();
    const resetTurn = (turn: Element) => {
      const node = turn as HTMLElement;
      node.style.removeProperty("content-visibility");
      node.style.removeProperty("contain-intrinsic-block-size");
      // A new observation reports the real content even when the old placeholder
      // happened to have the same height. Never invent a height for loaded history.
      resize.unobserve?.(turn);
      resize.observe(turn);
    };
    const resize = new ResizeObserver((entries) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      const viewportTop = el.getBoundingClientRect().top;
      let shift = 0;
      let precedingDelta = 0;
      const remeasure = new Set<Element>();
      // ResizeObserver order is not DOM order. Only sort changed turns so
      // preceding height corrections retain the same anchoring semantics.
      const ordered = [...entries].sort((a, b) =>
        a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      for (const entry of ordered) {
        const width = entry.contentRect.width;
        const previousWidth = widths.get(entry.target);
        widths.set(entry.target, width);
        if (
          previousWidth !== undefined &&
          previousWidth !== width &&
          (entry.target as HTMLElement).style.contentVisibility === "auto"
        ) {
          remeasure.add(entry.target);
          resetTurn(entry.target);
          continue;
        }
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previous = heights.get(entry.target);
        heights.set(entry.target, height);
        if (previous === undefined || stickToBottom.current) continue;
        // Only turns that sat wholly above the view. A turn the reader is
        // looking at grows downward from where they are reading.
        const top = entry.target.getBoundingClientRect().top - precedingDelta;
        if (top + previous <= viewportTop) shift += height - previous;
        precedingDelta += height - previous;
      }
      if (shift) {
        el.scrollTop += shift;
        onAdjust(el);
      }
      // All reads/anchor corrections finish before applying containment. Actual
      // measured content heights preserve the scroll range during upward gestures;
      // estimated `auto 200px` fallbacks previously caused that range to jump.
      for (const entry of ordered) {
        const turn = entry.target as HTMLElement;
        if (
          remeasure.has(turn) ||
          entry.contentRect.height <= 0 ||
          turn.classList.contains("transcript-turn-live") ||
          turn.classList.contains("transcript-turn-anchor")
        )
          continue;
        const width = widths.get(turn);
        if (width !== entry.contentRect.width || !heights.has(turn)) continue;
        turn.style.containIntrinsicBlockSize = `${entry.contentRect.height}px`;
        turn.style.contentVisibility = "auto";
      }
    });
    let observed = new WeakSet<Element>();
    const observeTurns = () => {
      for (const turn of inner.children) {
        if (observed.has(turn) || !turn.classList.contains("transcript-turn")) continue;
        observed.add(turn);
        resize.observe(turn);
      }
    };
    const mutations = new MutationObserver((records) => {
      const listChanged = records.some(
        (record) => record.target === inner && record.type === "childList",
      );
      // Removal is rare (a rewind or edit), so start over rather than hold
      // detached turns. Re-observed turns report the height already stored.
      if (records.some((record) => record.target === inner && record.removedNodes.length > 0)) {
        resize.disconnect();
        observed = new WeakSet();
      }
      const changed = new Set<Element>();
      for (const record of records) {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement;
        const turn = target?.closest(".transcript-turn");
        if (turn && observed.has(turn) && !turn.classList.contains("transcript-turn-live"))
          changed.add(turn);
      }
      for (const turn of changed) resetTurn(turn);
      // Tail text/word-fade mutations must not enumerate every retained turn.
      if (listChanged) observeTurns();
    });
    mutations.observe(inner, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "data-collapsed",
        "data-fold-state",
        "src",
        "width",
        "height",
        "open",
      ],
    });
    const resourceChanged = (event: Event) => {
      const turn =
        event.target instanceof Element ? event.target.closest(".transcript-turn") : null;
      if (turn && observed.has(turn) && !turn.classList.contains("transcript-turn-live"))
        resetTurn(turn);
    };
    inner.addEventListener("load", resourceChanged, true);
    inner.addEventListener("error", resourceChanged, true);
    const fontSignature = () => {
      const turn = inner.querySelector(".transcript-turn");
      if (!turn) return "";
      const style = getComputedStyle(turn);
      return [
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        style.lineHeight,
        style.letterSpacing,
      ].join("|");
    };
    let font = fontSignature();
    const refreshHeights = () => {
      for (const turn of inner.children) if (observed.has(turn)) resetTurn(turn);
    };
    const appearance = new MutationObserver(() => {
      const next = fontSignature();
      if (next === font) return;
      font = next;
      refreshHeights();
    });
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    appearance.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    document.fonts?.addEventListener("loadingdone", refreshHeights);
    observeTurns();
    return () => {
      mutations.disconnect();
      appearance.disconnect();
      document.fonts?.removeEventListener("loadingdone", refreshHeights);
      resize.disconnect();
      inner.removeEventListener("load", resourceChanged, true);
      inner.removeEventListener("error", resourceChanged, true);
      for (const turn of inner.children) {
        (turn as HTMLElement).style.removeProperty("content-visibility");
        (turn as HTMLElement).style.removeProperty("contain-intrinsic-block-size");
      }
    };
  }, [el, enabled, stickToBottom, onAdjust]);
}

/**
 * Keep a live phase body on its newest step. Pinning happens in layout
 * before paint so the window follows without a visible hitch; only a real
 * wheel away from the bottom pauses that.
 */

/**
 * One phase: a header the whole group hangs off, and the steps under it on a
 * rail. Folding is automatic — the group opens while it is the live one and
 * closes when the agent moves on — until you click, after which it stays where
 * you put it. A step still waiting on you keeps the group open regardless.
 * While live, the open body stays a short scrolling window pinned to the
 * newest step; after the turn settles an opened group is full height again.
 */
function ActivityPhaseGroup({
  phase,
  cwd,
  active,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  phase: ActivityPhase;
  cwd?: string;
  active: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`phase:${phase.id}`, null);
  const waiting = phase.steps.some(needsApproval);
  const needsAttention =
    waiting ||
    phase.steps.some((step) => step.role === "tool" && toolCallState(step) === "rejected");
  const open = waiting || (override ?? active);
  const [liveScroller, setLiveScroller] = useState<HTMLDivElement | null>(null);
  useFollowBottom(liveScroller, active && open, phase.steps, NEAR_BOTTOM_PX, true);
  // Steps already here when the group mounted, or that landed while it was
  // folded, are history: only a step you watch arrive gets the entrance.
  const settled = useRef<Set<Block["id"]> | null>(null);
  settled.current ??= new Set(phase.steps.map((step) => step.id));
  useEffect(() => {
    for (const step of phase.steps) settled.current?.add(step.id);
  }, [phase.steps]);
  const turnFor = useStepQueue(phase.steps);
  const title = activityPhaseTitle(phase, active);
  const bycodaPhase = !!bycodaWorkSummary(phase.steps, active);
  let compactCommand: Block | undefined;
  if (active && override !== true && !needsAttention) {
    for (let index = phase.steps.length - 1; index >= 0; index -= 1) {
      const step = phase.steps[index];
      if (step.role === "tool" && step.tool?.kind === "shell") {
        // Recognized app calls already have a compact action row; repeating the
        // shell preview here exposes their full executable path and arguments.
        compactCommand = bycodaToolCall(step) ? undefined : step;
        break;
      }
    }
  }
  // Opening a group on purpose is also how you read the line that titled it,
  // whole. The auto-open while it runs is a live view, not a reading one, and
  // a one-line note the header already shows in full has nothing to add.
  const headline =
    override === true && phase.headline && headlineHasMore(phase.headline)
      ? phase.headline
      : undefined;
  const inert = phase.steps.length === 0 && !headlineHasMore(phase.headline);

  // A lone call the agent never introduced is not a group: a header repeating
  // the single row under it says nothing twice.
  if (!phase.headline && phase.steps.length === 1) {
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        {bycodaPhase ? null : <ActivityPhaseIcon kind={phase.kind} className="mt-[7px]" />}
        <div className="min-w-0 flex-1">
          <ActivityRow
            block={phase.steps[0]}
            cwd={cwd}
            live={active}
            onApproval={onApproval}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        </div>
      </div>
    );
  }

  const label = active ? (
    <Shimmer className="min-w-0 flex-1 truncate font-sans text-sm" duration={1.6}>
      {title}
    </Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and
    // only the answer reads at full strength.
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
      {title}
    </span>
  );

  // A line the agent wrote with nothing under it is just that line.
  if (inert) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-1">
        <ActivityPhaseIcon kind={phase.kind} />
        {label}
      </div>
    );
  }

  return (
    <div className="transcript-activity-group flex min-w-0 flex-col">
      <Button
        motion="none"
        fullWidth
        variant="item"
        type="button"
        selected={open}
        aria-expanded={open}
        title={title}
        aria-label={
          open
            ? t("Hide the steps for {p0}", { p0: title })
            : t("Show the steps for {p0}", { p0: title })
        }
        onClick={() => setOverride(!open)}
        className="w-full min-w-0 text-left"
      >
        {/*
         * The two icons share one 14px box, so the swap is instant: fading
         * between them leaves both half-drawn on top of each other.
         */}
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          {bycodaPhase ? (
            <BycodaMark className="size-3.5" />
          ) : (
            <ActivityPhaseIcon kind={phase.kind} />
          )}
        </span>
        {label}
        <ChevronRight
          className={`size-3.5 shrink-0 text-(--ui-text-secondary) ${open ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
      </Button>
      <div className="zen-phase-body" data-open={open}>
        {open ? (
          <>
            {compactCommand ? (
              <div className="flex min-w-0 items-start gap-1.5 px-2 py-1 text-ui-caption text-(--ui-text-secondary)">
                <Terminal className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span
                  className="line-clamp-2 break-all font-mono"
                  title={toolCallLabel(compactCommand, cwd)}
                >
                  {toolCallLabel(compactCommand, cwd)}
                </span>
              </div>
            ) : null}
            <div
              ref={setLiveScroller}
              className={
                active && override !== true && !needsAttention
                  ? "zen-phase-live zen-phase-summary"
                  : undefined
              }
            >
              <div className="flex min-w-0 flex-col">
                {headline ? (
                  <div className="zen-phase-step py-1">
                    <AgentMarkdown
                      className={headline.role === "reasoning" ? "agent-reasoning" : undefined}
                      text={headline.text}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                ) : null}
                {phase.steps.map((block) => {
                  const arriving = active && !settled.current?.has(block.id);
                  return (
                    <PhaseStep
                      key={block.id}
                      live={active}
                      turn={arriving ? turnFor(block.id) : undefined}
                    >
                      <ActivityRow
                        block={block}
                        cwd={cwd}
                        live={active}
                        onApproval={onApproval}
                        onOpenFile={onOpenFile}
                        onOpenDiff={onOpenDiff}
                      />
                    </PhaseStep>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {open && active && override !== true && !needsAttention && phase.steps.length > 3 ? (
        <Button variant="link" motion="none" onClick={() => setOverride(true)}>
          {t("Show more")}
        </Button>
      ) : null}
    </div>
  );
}

type StepTurn = { wait: number; pace: number };

/**
 * A group's queue of arriving steps: how long each one waits for the step
 * before it to finish, and how long its own entrance then takes. A step keeps
 * the turn it was first given however often the group renders.
 */
function useStepQueue(steps: readonly Block[]) {
  const queue = useRef({ next: 0, turns: new Map<Block["id"], StepTurn>() });
  useEffect(() => {
    const current = new Set(steps.map((step) => step.id));
    for (const id of queue.current.turns.keys()) {
      if (!current.has(id)) queue.current.turns.delete(id);
    }
  }, [steps]);

  return (id: Block["id"]) => {
    const { turns } = queue.current;
    let turn = turns.get(id);
    if (!turn) {
      const now = performance.now();
      const start = Math.max(now, queue.current.next);
      const wait = start - now;
      const backlog = (STEP_QUEUE_MS - wait) / (STEP_QUEUE_MS - STEP_QUEUE_CALM_MS);
      const pace = Math.max(STEP_ENTRANCE_MIN_MS, STEP_ENTRANCE_MS * Math.min(1, backlog));
      queue.current.next = start + pace;
      turn = { wait, pace };
      turns.set(id, turn);
    }
    return turn;
  };
}

/**
 * One step on a phase's rail. A step that lands while you watch makes room
 * first — what is below glides down, the rail runs into the gap and branches
 * off — and only then does the row fade in. One that lands behind others
 * stays out of the layout until its turn. The grid and clipping that does
 * that come off once the row has settled, so nothing inside stays clipped.
 */
function PhaseStep({
  live,
  turn: arrival,
  children,
}: {
  live: boolean;
  /** Set only on the render a step arrives in; later renders drop it. */
  turn?: StepTurn;
  children: ReactNode;
}) {
  useLocale();
  const [turn] = useState(arrival);
  const [stage, setStage] = useState<"waiting" | "entering" | "settled">(() =>
    !turn ? "settled" : turn.wait > 0 ? "waiting" : "entering",
  );

  useEffect(() => {
    if (stage !== "waiting" || !turn) return;
    const timer = window.setTimeout(() => setStage("entering"), turn.wait);
    return () => window.clearTimeout(timer);
  }, [stage, turn]);

  return (
    <div
      className="zen-phase-step"
      style={turn ? ({ "--step-ms": `${Math.round(turn.pace)}ms` } as CSSProperties) : undefined}
      data-live={live || undefined}
      data-waiting={stage === "waiting" || undefined}
      data-entering={stage === "entering" || undefined}
      onAnimationEnd={(e) => {
        // The row's own fade is the last beat; nested rails bubble theirs.
        if (
          e.animationName === "zen-step-in" &&
          (e.target as Element).parentElement === e.currentTarget
        ) {
          setStage("settled");
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Every delegated run in the turn, one row each. The main transcript cycles —
 * work folds behind a line, messages stay visible — and a subagent you are
 * watching must not move while that happens, so these rows are never part of a
 * fold and hold their place from the moment the agents start.
 *
 * A row is a mascot, a name, and what that agent is doing right now. Click it
 * and the agent's own trail opens underneath.
 */
function SubagentStack({
  blocks,
  cwd,
  live = false,
  embedded = false,
  onOpenFile,
  onOpenDiff,
}: {
  blocks: Block[];
  cwd?: string;
  live?: boolean;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  return (
    <div className={`flex min-w-0 flex-col ${embedded ? "" : "px-4"}`}>
      {blocks.map((block) => (
        <SubagentRow
          key={block.id}
          block={block}
          cwd={cwd}
          live={live}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}

/**
 * One delegated run's row, stateful about being opened. A run that died opens
 * itself, so the provider's reason is not buried behind a face that looks like
 * every other finished one. A click takes the row over from there and it stays
 * where the reader puts it. The same row serves inside a settled turn's trail,
 * where the run sits as one step of the work it was spawned from.
 */
function SubagentRow({
  block,
  cwd,
  live = false,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`agent:${block.id}`, null);
  const open = override ?? toolCallState(block) === "rejected";
  // The composer's activity dock opens a run from outside the transcript. The
  // row may only mount after the transcript reveals it, so check on mount too.
  useEffect(() => {
    const openIfAsked = () => {
      if (consumeOpenSubagent(block.id)) setOverride(true);
    };
    openIfAsked();
    window.addEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
    return () => window.removeEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
  }, [block.id]);
  return (
    <SubagentPanel
      block={block}
      cwd={cwd}
      live={live}
      open={open}
      onToggle={() => setOverride(!open)}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/**
 * One delegated run: its name, what it is doing, and — once opened — the trail
 * it left, with the same tool rows, thinking and prose the main transcript
 * shows. While it runs the trail is a short window pinned to the newest step,
 * so a subagent doing hundreds of things cannot push the turn off the screen.
 */
function SubagentPanel({
  block,
  cwd,
  live = false,
  open,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const name = subagentName(block);
  const brief = subagentBrief(block);
  const model = useSubagentModelName(block);
  const state = toolCallState(block);
  const active = live && state === "pending";
  const steps = block.agentRun?.steps ?? [];
  // The run's trail as transcript blocks, so the panel groups it the way the
  // main transcript groups the agent's own work: what it said, then the calls
  // that line introduced, folding behind it once it moves on.
  const stepBlocks = useMemo(() => steps.map(agentStepBlock), [steps]);
  const status = subagentStatusLine(block, steps);
  const report = subagentReport(block);
  const failed = state === "rejected";

  // The name takes the room it needs and gives the rest back: a provider that
  // names a run with its whole brief must not push the row off the pane.
  const label = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      {active ? (
        <Shimmer className="min-w-0 flex-1 truncate font-sans text-sm" duration={1.6}>
          {name}
        </Shimmer>
      ) : (
        <span
          className={`min-w-0 flex-1 truncate font-sans text-sm transition-colors duration-200 ${
            state === "rejected"
              ? "text-(--ui-tone-danger-fg)"
              : "text-(--ui-text-secondary) group-hover:text-(--ui-tone-neutral-fg)"
          }`}
        >
          {name}
        </span>
      )}
      {model || status || block.agentRun?.startedAt !== undefined ? (
        <span className="flex min-w-0 max-w-[55%] shrink-0 items-baseline gap-2 font-sans text-ui-caption text-(--ui-text-secondary)">
          {model ? (
            <span className="truncate" title={t("Model: {p0}", { p0: model })}>
              {model}
            </span>
          ) : null}
          {status ? <span className="shrink-0">{status}</span> : null}
          <AgentClock
            startedAt={block.agentRun?.startedAt}
            endedAt={block.agentRun?.endedAt}
            live={active}
          />
        </span>
      ) : null}
    </span>
  );

  // A run can report its first step late (or never). Its prompt and status
  // remain inspectable in the panel even before the trail arrives.
  if (steps.length === 0 && !report) {
    return (
      <Button
        motion="none"
        variant="item"
        type="button"
        aria-label={t("Open {p0} in its own panel", { p0: name })}
        title={brief}
        onClick={() => requestViewSubagent(block.id)}
        className="-mx-1.5 min-w-0"
      >
        <SubagentMascot name={name} state={state} active={active} />
        {label}
        <span className="size-3.5 shrink-0" />
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="-mx-1.5 flex min-w-0 items-center gap-0.5">
        <Button
          motion="none"
          className="min-w-0 flex-1 text-left"
          variant="item"
          type="button"
          selected={open}
          aria-expanded={open}
          aria-label={
            open ? t("Hide {p0}'s work", { p0: name }) : t("Show {p0}'s work", { p0: name })
          }
          title={brief}
          onClick={onToggle}
          // An open row keeps the wash it lit up under the cursor, so the panel
          // below reads as hanging off it rather than off the transcript.
        >
          <SubagentMascot name={name} state={state} active={active} />
          {label}
          <ChevronRight
            className={`size-3.5 shrink-0 text-(--ui-text-secondary) transition-transform duration-200 group-hover:text-(--ui-text-secondary) ${
              open ? "rotate-90" : ""
            }`}
            strokeWidth={1.75}
          />
        </Button>
        <Button
          motion="none"
          iconOnly
          label={t("Open {p0} in its own panel", { p0: name })}
          variant="ghost"
          type="button"
          aria-label={t("Open {p0} in its own panel", { p0: name })}
          title={t("Open in panel")}
          onClick={() => requestViewSubagent(block.id)}
          className="shrink-0"
        >
          <ExternalLink className="size-3" strokeWidth={1.75} />
        </Button>
      </div>
      <div className="zen-phase-body" data-open={open}>
        {open ? (
          /*
           * No scroll window of its own. Each phase inside already keeps the
           * group the run is working in to a short pinned window; wrapping a
           * second window around them nests one 17.5rem scroller inside
           * another, and the inner one can never reach its own last row.
           */
          <div className="flex min-w-0 flex-col pb-1">
            <ActivityPhases
              blocks={stepBlocks}
              cwd={cwd}
              done={!active}
              padded={false}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
            {report ? (
              <div className="zen-phase-step py-1">
                {failed ? (
                  <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-ui-caption leading-5 text-(--ui-tone-danger-fg)">
                    {report}
                  </pre>
                ) : (
                  <AgentMarkdown text={report} cwd={cwd} onOpenFile={onOpenFile} />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The pixel mascot standing in for a subagent, hopping while it works. The
 * sprite is hashed off the agent's name, so the same reviewer keeps the same
 * face across a session and two agents in a row are told apart at a glance.
 */
function SubagentMascot({
  name,
  state,
  active = false,
}: {
  name: string;
  state: ToolCallState;
  active?: boolean;
}) {
  useLocale();
  return (
    <ProjectMascot
      project={name}
      active={active}
      className={`size-3.5 shrink-0 ${
        state === "rejected"
          ? "text-(--ui-tone-danger-fg)"
          : state === "pending"
            ? "text-(--ui-text-secondary)"
            : "text-(--ui-text-secondary)"
      }`}
    />
  );
}

/**
 * A mirrored step as the transcript block it stands for, so a subagent's trail
 * goes through the same rows — labels, file chips, diffs — as the main agent's.
 */
export function agentStepBlock(step: AgentStep): Block {
  if (step.kind !== "tool") {
    return {
      id: step.id,
      role: step.kind === "reasoning" ? "reasoning" : "assistant",
      text: step.text,
    };
  }
  return {
    id: step.id,
    role: "tool",
    text: step.text,
    tool: {
      callId: step.id,
      title: step.text,
      ...(step.toolKind ? { kind: step.toolKind } : {}),
      ...(step.status ? { status: step.status } : {}),
      ...(step.detail ? { detail: step.detail } : {}),
      ...(step.preview ? { preview: step.preview } : {}),
      ...(step.output ? { output: step.output } : {}),
      ...(step.outputTruncated ? { outputTruncated: true } : {}),
    },
  };
}

/** Whether the line that titled a group has more in it than the header shows. */
function headlineHasMore(block?: Block): boolean {
  if (!block) return false;
  return block.role === "reasoning" || /\n\s*\n/.test(block.text.trim());
}

/** What the group was for, at a glance: look, change, run, think. */
function ActivityPhaseIcon({
  kind,
  className = "",
}: {
  kind: ActivityPhaseKind;
  className?: string;
}) {
  useLocale();
  const props = {
    className: `size-3.5 shrink-0 text-(--ui-text-secondary) ${className}`,
    strokeWidth: 1.75,
  };
  if (kind === "edit") return <PenLine {...props} />;
  if (kind === "research") return <Search {...props} />;
  if (kind === "run") return <Terminal {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  if (kind === "think") return null;
  if (kind === "other") return <Wrench {...props} />;
  return <Minus {...props} />;
}

/**
 * One step of the agent's work, whatever that step was: a tool call, a thought,
 * a paragraph. In a phase the rail draws the bullet, so the row drops its own
 * leading icon and leans on the rail instead.
 */
export function ActivityRow({
  block,
  cwd,
  live = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  if (isThinkingBlock(block)) {
    return <ActivityThinkingRow block={block} cwd={cwd} expandable bare onOpenFile={onOpenFile} />;
  }
  if (block.interjection) {
    return <ActivityInterjectionRow block={block} />;
  }
  if (block.role === "system") {
    return <ActivityStatusRow block={block} />;
  }
  if (isProseBlock(block)) {
    return <ActivityNoteRow block={block} cwd={cwd} bare expandable onOpenFile={onOpenFile} />;
  }
  // Only a settled turn routes a delegated run here; live turns pin the row
  // outside the trail. Either way it is the same row, so it still opens onto
  // the agent's own work.
  if (isSubagentBlock(block)) {
    return (
      <SubagentRow
        block={block}
        cwd={cwd}
        live={live}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }
  return (
    <ActivityToolRow
      block={block}
      cwd={cwd}
      live={live}
      bare
      onApproval={onApproval}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/** A status row folded into the trail: one muted line, nothing to open. */
function ActivityStatusRow({ block }: { block: Block }) {
  useLocale();
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-1">
      <span
        title={block.text}
        className={`min-w-0 flex-1 truncate font-sans text-sm ${block.notice === "interrupt" ? "font-bold text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
      >
        {block.text.trim()}
      </span>
    </div>
  );
}

/**
 * An interjection inside the work trail: one compact line naming where it came
 * from and what it said. It opens on a click, so folding the work never costs
 * you a note you wanted to read.
 */
function ActivityInterjectionRow({ block }: { block: Block }) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(
    `ActivityInterjectionRow:${block.id}`,
    false,
  );
  const meta = block.interjection;
  if (!meta) return null;
  const chrome = interjectionChrome(meta);
  const summary = proseSummary(block.text);
  const label = (
    <span className="min-w-0 flex-1 truncate font-sans text-sm">
      <span className="text-(--ui-text-secondary)">{chrome.label}</span>
      {chrome.severityText ? (
        <span className={`text-ui-micro ${chrome.severityClass}`}> {chrome.severityText}</span>
      ) : null}
      {summary ? (
        <span className="text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
          {" · "}
          {summary}
        </span>
      ) : null}
    </span>
  );

  if (!block.text.trim()) {
    return (
      <div
        aria-label={t("{p0} note", { p0: chrome.label })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={
          open ? t("Hide the {p0} note", { p0: chrome.label }) : `${chrome.label}: ${summary}`
        }
        onClick={() => setOpen((value) => !value)}
        className="min-w-0 text-left"
      >
        {label}
      </Button>
      {open ? (
        <div className="min-w-0 pb-2">
          <pre className={INTERJECTION_BODY}>{block.text}</pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The line that keeps a long think from reading as a stall. Opening the fold
 * around it does not open the thought itself — reasoning is only ever read on
 * purpose, one line until you ask for it.
 */
export function ActivityThinkingRow({
  block,
  cwd,
  expandable = false,
  bare = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  expandable?: boolean;
  bare?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ActivityThinkingRow:${block.id}`, false);
  const text = open ? t("Thinking…") : proseSummary(block.text) || t("Thinking…");
  // In a group the rail is the bullet, so there is nothing to breathe while
  // reasoning streams in — the line itself does.
  const pulse = block.streaming ? "zen-thinking-pulse" : "";
  const icon = bare ? null : (
    <Minus className={`size-3.5 shrink-0 text-(--ui-text-secondary) ${pulse}`} strokeWidth={1.75} />
  );
  const label = (
    <span
      className={`min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary) ${bare ? pulse : ""}`}
    >
      {text}
    </span>
  );

  if (!expandable) {
    return (
      <div
        aria-label={t("Thinking: {p0}", { p0: text })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={open ? t("Hide thinking") : t("Show thinking: {p0}", { p0: text })}
        onClick={() => setOpen((value) => !value)}
        className="min-w-0 text-left"
      >
        {icon}
        <span
          className={`min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary) ${
            bare ? pulse : ""
          }`}
        >
          {text}
        </span>
      </Button>
      {open ? (
        <div className={`min-w-0 pb-2 ${bare ? "" : "pl-5"}`}>
          <AgentMarkdown
            className="agent-reasoning"
            text={block.text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A line the agent wrote mid-run, kept to one line. It opens on click, so
 * folding the work never costs you a paragraph you wanted to read.
 */
function ActivityNoteRow({
  block,
  cwd,
  bare = false,
  expandable = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  bare?: boolean;
  expandable?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ActivityNoteRow:${block.id}`, false);
  const text = proseSummary(block.text);
  const icon = bare ? null : (
    <Minus className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
  );

  if (!expandable) {
    return (
      <div
        aria-label={t("Agent said: {p0}", { p0: text })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary)">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={open ? t("Hide the full note") : t("Agent said: {p0}", { p0: text })}
        onClick={() => setOpen((value) => !value)}
        className="min-w-0 text-left"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-tone-neutral-fg)">
          {text}
        </span>
      </Button>
      {open ? (
        <div className="min-w-0 pb-2">
          <AgentMarkdown text={block.text} cwd={cwd} onOpenFile={onOpenFile} />
        </div>
      ) : null}
    </div>
  );
}

function ActivityToolRow({
  block,
  cwd,
  live = false,
  bare = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  bare?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const [errorOpen, setErrorOpen] = useRetainedDisclosure<boolean>(
    `ActivityToolRow:${block.id}`,
    false,
  );
  const appCall = bycodaToolCall(block);
  if (appCall) {
    return <BycodaCallRow block={block} call={appCall} onApproval={onApproval} />;
  }
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const pending = needsApproval(block);
  const errorDetail = !pending && state === "rejected" ? block.tool?.detail?.trim() : undefined;
  const hasResult = !pending && hasToolInspection(block);
  const inspectionLabel =
    block.tool?.preview?.kind === "write" ? "Show changes for {p2}" : "Show output for {p2}";
  const summary = (
    <ToolCallSummary
      label={label}
      wrap={block.tool?.kind === "shell"}
      preview={block.tool?.preview}
      cwd={cwd}
      chip={bare}
      failed={state === "rejected"}
      status={state}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );

  return (
    <div className="flex min-w-0 flex-col">
      {hasResult ? (
        <div
          aria-label={`${errorDetail ? "Failed tool call" : "Tool call"}: ${label}`}
          className="group flex min-w-0 items-center gap-1.5 py-1"
        >
          {bare ? null : <ActivityToolIcon state={state} live={live} />}
          <div
            className="flex min-w-0 flex-1 cursor-pointer"
            onClick={() => setErrorOpen((value) => !value)}
          >
            {summary}
          </div>
          <ToolCallStatusIcon state={state} />
          <Button
            motion="none"
            variant="ghost"
            type="button"
            aria-expanded={errorOpen}
            aria-label={t(
              errorOpen
                ? errorDetail
                  ? "Hide error details for {p2}"
                  : "Hide output for {p2}"
                : errorDetail
                  ? "Show error details for {p2}"
                  : inspectionLabel,
              { p2: label },
            )}
            onClick={() => setErrorOpen((value) => !value)}
            className="-m-1 shrink-0"
          >
            {block.tool?.preview?.kind === "write" && !errorDetail ? (
              <span className="text-ui-micro text-(--ui-text-secondary)">{t("Changes")}</span>
            ) : null}
            <ChevronRight
              className={`size-3.5 transition-transform ${
                errorDetail ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"
              } ${errorOpen ? "rotate-90" : ""}`}
              strokeWidth={1.75}
            />
          </Button>
        </div>
      ) : (
        <div
          aria-label={t("Tool call: {p0}", { p0: label })}
          className="flex min-w-0 items-center gap-1.5 py-1"
        >
          {bare ? null : <ActivityToolIcon state={state} live={live} />}
          {summary}
          {pending ? null : <ToolCallStatusIcon state={state} />}
        </div>
      )}
      {pending ? <ApprovalControls block={block} onApproval={onApproval} /> : null}
      {errorOpen && hasResult ? (
        <div className={`min-w-0 py-1 ${bare ? "" : "pl-5"}`}>
          <ToolInspectionPanel block={block} />
        </div>
      ) : null}
    </div>
  );
}

function BycodaMark({ className = "size-4" }: { className?: string }) {
  useLocale();
  return <img src={PRODUCT_IDENTITY.logoSrc} alt="" className={`shrink-0 ${className}`} />;
}

/** Bycoda commands keep both successful results and failures available on demand. */
function BycodaCallRow({
  block,
  call,
  onApproval,
}: {
  block: Block;
  call: BycodaToolCall;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const t = useT();
  const state = toolCallState(block);
  const [errorOpen, setErrorOpen] = useRetainedDisclosure<boolean>(
    `BycodaCallRow:${block.id}`,
    false,
  );
  const pendingApproval = needsApproval(block);
  const hasResult = !pendingApproval && hasToolInspection(block);
  const hasError = state === "rejected" && hasResult;
  const command = `${PRODUCT_IDENTITY.displayName} app ${call.action}`;
  const verb = pendingApproval ? "Run" : state === "pending" ? "Running" : "Ran";
  const summary = (
    <>
      <span
        className={`shrink-0 font-sans text-sm ${state === "rejected" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
      >
        {verb}
      </span>
      <span
        className={`flex min-w-0 max-w-full items-center gap-1 rounded bg-(--ui-surface-raised) px-1 font-mono text-ui-secondary ${state === "rejected" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
        title={command}
      >
        <BycodaMark className="size-3.5" />
        <span className="min-w-0 truncate">{command}</span>
      </span>
      <ToolCallStatusIcon state={state} />
      {hasResult ? (
        <ChevronRight
          className={`size-3.5 shrink-0 ${hasError ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"} transition-transform ${errorOpen ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
      ) : null}
    </>
  );
  return (
    <div data-bycoda-tool-call={call.action} className="min-w-0">
      {hasResult ? (
        <Button
          motion="none"
          fullWidth
          variant="item"
          type="button"
          aria-expanded={errorOpen}
          aria-label={t(
            hasError
              ? errorOpen
                ? "Hide error details for {p1}: {p2}"
                : "Show error details for {p1}: {p2}"
              : errorOpen
                ? "Hide output for {p1}: {p2}"
                : "Show output for {p1}: {p2}",
            { p1: PRODUCT_IDENTITY.displayName, p2: call.label },
          )}
          onClick={() => setErrorOpen((value) => !value)}
          className="w-full min-w-0 text-left"
        >
          {summary}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-1">{summary}</div>
      )}
      {errorOpen && hasResult ? <ToolInspectionPanel block={block} /> : null}
      {pendingApproval ? (
        <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-all py-1 pl-5 font-mono text-ui-caption leading-5 text-(--ui-text-secondary)">
          {call.command}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ActivityToolIcon({ state, live = false }: { state: ToolCallState; live?: boolean }) {
  useLocale();
  if (state === "pending") {
    return (
      <CircleDashed
        className={`size-3.5 shrink-0 text-(--ui-text-secondary) ${live ? "zen-tool-spin" : ""}`}
        strokeWidth={1.75}
      />
    );
  }

  return <Minus className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />;
}

/** Failure stays marked. Running and success do not get a trailing icon. */
function ToolCallStatusIcon({ state }: { state: ToolCallState }) {
  useLocale();
  if (state === "rejected") {
    return <X className="size-3.5 shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  return null;
}

function formatWorkingDuration(elapsedMs: number | null, modelName?: string, done = false): string {
  const who = modelName?.trim();
  const elapsed = formatElapsed(elapsedMs);
  const verb = done ? (who ? "worked" : "Worked") : who ? "working" : "Working";
  if (elapsed == null) {
    if (done) return who ? `${who} ${verb}` : verb;
    return who ? `${who} ${verb}…` : `${verb}…`;
  }
  return who ? `${who} ${verb} for ${elapsed}` : `${verb} for ${elapsed}`;
}

function ToolCall({
  block,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  embedded,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  embedded?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ToolCall:${block.id}`, false);
  const preview = block.tool?.preview;
  const label = toolCallLabel(block, cwd);
  const detail = block.tool?.detail?.trim();
  const expanded = detail && detail !== label ? detail : label;
  const state = toolCallState(block);
  const stateLabel =
    state === "accepted" ? "Accepted" : state === "rejected" ? "Rejected" : "Pending";
  const editTool = isEditTool(block.tool?.kind, block.text || block.tool?.title, preview);
  const compact =
    isReadTool(block.tool?.kind, label, preview) || isSearchTool(block.tool?.kind, label, preview);
  const expandable = !compact && !!detail && detail !== label;

  const frame = embedded ? "py-0.5" : "px-4 py-1";

  const appCall = bycodaToolCall(block);
  if (appCall) {
    return (
      <div className={frame}>
        <BycodaCallRow block={block} call={appCall} onApproval={onApproval} />
      </div>
    );
  }

  if (!needsApproval(block)) {
    if (isIncompleteTool(block, label, state)) return null;
    return (
      <div className={frame}>
        <ActivityToolRow block={block} cwd={cwd} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
      </div>
    );
  }

  if (editTool) {
    return (
      <div className={frame}>
        {needsApproval(block) ? (
          <FilePreview
            preview={preview ?? stubFilePreview(block.tool?.kind, label)}
            status={state}
            cwd={cwd}
            onOpenFile={onOpenDiff ?? onOpenFile}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2 py-1">
            <ToolCallIcon state={state} />
            <ToolCallSummary
              label={label}
              wrap={block.tool?.kind === "shell"}
              preview={preview}
              cwd={cwd}
              failed={state === "rejected"}
              status={state}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          </div>
        )}
        <ApprovalControls block={block} onApproval={onApproval} />
      </div>
    );
  }

  if (isIncompleteTool(block, label, state)) return null;

  return (
    <div className={frame}>
      {expandable ? (
        <Button
          motion="none"
          fullWidth
          variant="item"
          type="button"
          selected={open}
          aria-expanded={open}
          aria-label={t("{p0} tool call: {p1}", { p0: stateLabel, p1: label })}
          onClick={() => setOpen((value) => !value)}
          className="w-full min-w-0 text-left"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            wrap={block.tool?.kind === "shell"}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
          <ChevronRight
            className={`size-3.5 shrink-0 text-(--ui-text-secondary) transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.75}
          />
        </Button>
      ) : (
        <div
          aria-label={t("{p0} tool call: {p1}", { p0: stateLabel, p1: label })}
          className="flex w-full min-w-0 items-center gap-2"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            wrap={block.tool?.kind === "shell"}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
      {open && expandable ? (
        <pre className="mt-1.5 min-w-0 whitespace-pre-wrap break-words px-2.5 font-mono text-ui-caption leading-5 text-(--ui-text-secondary)">
          {expanded}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ToolCallSummary({
  label,
  wrap = false,
  preview,
  cwd,
  onOpenFile,
  onOpenDiff,
  interactive = true,
  chip = false,
  failed = false,
  status = "accepted",
}: {
  label: string;
  wrap?: boolean;
  preview?: ToolPreview;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  interactive?: boolean;
  /** Sets the file off in a chip, for rows that lean on a rail for structure. */
  chip?: boolean;
  failed?: boolean;
  status?: ToolCallState;
}) {
  useLocale();
  const { action, target, fileName, filePath, isFile, previewMatchesFile } = useToolCallDisplay(
    label,
    preview,
    cwd,
  );
  if (!action || !target) {
    return (
      <span
        className={`min-w-0 flex-1 ${wrap ? "tool-command-label" : "truncate"} font-mono text-ui-secondary ${
          failed
            ? "text-(--ui-tone-danger-fg)"
            : chip
              ? "text-(--ui-text-secondary)"
              : "text-(--ui-text-secondary)"
        }`}
        title={label}
      >
        {label}
      </span>
    );
  }
  const openFile =
    action === "Edit" || action === "Write" ? (onOpenDiff ?? onOpenFile) : onOpenFile;
  const canOpen = interactive && !!openFile && !!filePath;
  const canPreview =
    interactive &&
    preview?.kind === "write" &&
    previewMatchesFile &&
    (preview.contentOnly || preview.lines?.some((line) => line.kind !== "context"));
  const actionTone = failed ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)";
  const targetTone = failed
    ? "text-(--ui-tone-danger-fg)"
    : chip
      ? "text-(--ui-text-secondary)"
      : "text-(--ui-text-secondary)";

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ui-secondary">
      <span className={`shrink-0 font-sans text-sm ${actionTone}`}>{action}</span>
      {isFile ? (
        canPreview ? (
          <ToolDiffPreview
            preview={preview}
            label={target}
            status={status}
            cwd={cwd}
            onOpen={openFile && filePath ? () => openFile(filePath) : undefined}
            onOpenFile={onOpenFile}
            className={`-my-0.5 flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left hover:text-(--ui-tone-info-fg) ${
              chip
                ? `max-w-full bg-(--ui-surface-raised) hover:bg-(--ui-surface-raised) ${targetTone}`
                : `flex-1 hover:bg-(--ui-surface-raised) ${targetTone}`
            }`}
          >
            <FileTypeIcon name={fileName} isDir={false} />
            <span className="min-w-0 truncate">{target}</span>
          </ToolDiffPreview>
        ) : canOpen ? (
          <Button
            motion="none"
            className="-my-0.5 min-w-0 text-left max-w-full flex-1"
            fullWidth
            variant="item"
            type="button"

            title={target}
            onClick={(event) => {
              event.stopPropagation();
              openFile?.(filePath);
            }}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{target}</span>
          </Button>
        ) : (
          <span
            className={`flex min-w-0 items-center gap-1 rounded px-1 ${
              chip ? `max-w-full bg-(--ui-surface-raised) ${targetTone}` : `flex-1 ${targetTone}`
            }`}
            title={target}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{target}</span>
          </span>
        )
      ) : (
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 pl-1 ${targetTone}`}
          title={target}
        >
          <span className="min-w-0 truncate">{target}</span>
        </span>
      )}
    </span>
  );
}

function ToolCallIcon({ state }: { state: ToolCallState }) {
  useLocale();
  if (state === "rejected") {
    return <X className="size-3.5 shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  if (state === "pending") {
    return (
      <CircleDashed className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
    );
  }
  return null;
}

function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const t = useT();
  const approval = block.approval;
  if (!approval || approval.decided || !onApproval) return null;
  return (
    <div className="mt-1.5 flex gap-2">
      <Button
        motion="none"
        variant="primary"
        type="button"

        onClick={() => onApproval(approval.requestId, "allow")}
      >
        {t("Allow")}
      </Button>
      <Button
        motion="none"
        variant="ghost"
        tone="danger"
        type="button"

        onClick={() => onApproval(approval.requestId, "deny")}
      >
        {t("Deny")}
      </Button>
    </div>
  );
}

function HandoffDivider({ block }: { block: Block }) {
  const t = useT();
  const meta = block.handoff;
  if (!meta) return null;

  const preparing = meta.status === "preparing";
  const label = preparing ? "Preparing a handoff" : HARNESS_TITLE[meta.to];

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
        <div
          role="separator"
          aria-label={
            preparing
              ? t("Preparing a handoff to {p0}", { p0: HARNESS_TITLE[meta.to] })
              : t("Continued with {p0}", { p0: label })
          }
          className="flex max-w-[min(100%,20rem)] items-center gap-1.5 px-1.5 font-sans text-ui-caption text-(--ui-text-secondary)"
        >
          {preparing ? (
            <>
              <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-ui-micro leading-none text-(--ui-text-secondary)" />
              <Shimmer duration={1.4}>{label}</Shimmer>
            </>
          ) : (
            <>
              <HarnessIcon harness={meta.to} className="size-3.5 shrink-0" />
            </>
          )}
        </div>
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
      </div>
    </div>
  );
}

/** The label and severity chrome an interjection wears, wherever it sits. */
function interjectionChrome(meta: InterjectionMeta): {
  label: string;
  severityText?: string;
  severityClass: string;
} {
  const label =
    meta.customType === "advisor"
      ? "Advisor"
      : meta.customType === "custom"
        ? "Notice"
        : meta.customType;
  const severityText =
    meta.severity === "blocker"
      ? "Blocker"
      : meta.severity === "concern"
        ? "Concern"
        : meta.severity === "nit"
          ? "Nit"
          : undefined;
  const severityClass =
    meta.severity === "blocker"
      ? "text-(--ui-tone-danger-fg)"
      : meta.severity === "concern"
        ? "text-(--ui-tone-warning-fg)"
        : "text-(--ui-text-secondary)";
  return { label, severityText, severityClass };
}

/** The advisory body under an interjection, wherever the note is surfaced. */
const INTERJECTION_BODY =
  "min-w-0 whitespace-pre-wrap break-words font-sans text-ui-secondary leading-5 text-(--ui-text-secondary)";

/** A mid-turn interjection, e.g. OMP advisor notes: a labeled boundary with
 * a collapsible advisory body below it. */
function InterjectionDivider({ block }: { block: Block }) {
  const t = useT();
  const [expanded, setExpanded] = useRetainedDisclosure<boolean>(`interjection:${block.id}`, false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !block.text) {
      setOverflows(false);
      return;
    }
    const measure = () => {
      if (!expanded) {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [block.text, expanded]);

  const meta = block.interjection;
  if (!meta) return null;
  const { label, severityText, severityClass } = interjectionChrome(meta);
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
        <div
          role="separator"
          aria-label={t("Interjection: {p0}", { p0: label })}
          className="flex items-center gap-2 px-1.5 font-sans text-ui-caption text-(--ui-text-secondary)"
        >
          <span>{label}</span>
          {severityText ? (
            <span className={`text-ui-micro ${severityClass}`}>{severityText}</span>
          ) : null}
        </div>
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
      </div>
      {block.text ? (
        <div className="mt-2 px-2">
          <pre ref={textRef} className={`${INTERJECTION_BODY} ${expanded ? "" : "line-clamp-2"}`}>
            {block.text}
          </pre>
          {overflows ? (
            <Button
              motion="none"
              variant="ghost"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1"
            >
              {expanded ? t("Show less") : t("Show more")}
            </Button>
          ) : null}
        </div>
      ) : null}
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

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function scrollClampedToBottom(el: HTMLElement, previousTop: number): boolean {
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
  return previousTop > bottom && Math.abs(el.scrollTop - bottom) < 1;
}

function pinToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/** Bottom padding of each transcript's inner column, read once per resize. */
const viewportPadding = new WeakMap<Element, number>();

/** Keep the live turn's min-height in lockstep with the visible transcript. */
function syncTranscriptViewport(el: HTMLElement | null, refreshPadding = false) {
  if (!el || el.clientHeight <= 0) return;
  const inner = el.firstElementChild as HTMLElement | null;
  let pad = 0;
  if (inner) {
    const cached = viewportPadding.get(inner);
    if (cached === undefined || refreshPadding) {
      pad = Number.parseFloat(getComputedStyle(inner).paddingBottom) || 0;
      viewportPadding.set(inner, pad);
    } else {
      pad = cached;
    }
  }
  const next = `${Math.max(0, el.clientHeight - pad)}px`;
  if (el.style.getPropertyValue("--transcript-viewport") === next) return;
  el.style.setProperty("--transcript-viewport", next);
}

/** Selection gestures update the floating actions, never regroup the transcript. */
const TranscriptSelectionActions = memo(function TranscriptSelectionActions({
  root,
  enabled,
  onAddToChat,
  onAddToNotes,
  onTranslate,
}: {
  root: HTMLElement | null;
  enabled: boolean;
  onAddToChat?: (text: string) => void;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onTranslate?: (selection: TranscriptSelection, target: TextActionTarget) => void;
}) {
  const { selection, dismissSelection } = useTranscriptSelection(root, enabled);
  return (
    <TranscriptSelectionMenu
      selection={selection}
      onDismiss={dismissSelection}
      onAddToChat={onAddToChat}
      onAddToNotes={onAddToNotes}
      onTranslate={
        onTranslate && selection ? (target) => onTranslate(selection, target) : undefined
      }
    />
  );
});
