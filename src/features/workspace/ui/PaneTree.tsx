import { Button } from "../../../shared/ui/Button";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { RecoveryBoundary } from "../../../shared/ui/RecoveryBoundary";
import { useT } from "../../../shared/i18n";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clearDropIndicator,
  setDropFeedback,
  setDropIndicator,
  setGrabbing,
  suppressTextSelection,
  type DropPlacement,
} from "../../../shared/lib/drag";
import { Maximize2, Minimize2 } from "../../../shared/ui/icons";
import { Sash as ResizeSash } from "../../../shared/ui/Sash";
import {
  isPointerOutsideWindow,
  pointerWindowMovePosition,
  type WindowMovePosition,
} from "../../../app/model/windowTransferPopout";
import { beginWindowTabDrag } from "../../../app/model/windowDragPreview";
import {
  paneDropFromPoint,
  samePaneDrop,
  setExternalTitleTabDrop,
  titleTabDropFromPoint,
  useExternalPaneDrop,
  type TitleTabDropPosition,
  type PaneDrop,
} from "../model/paneDrop";
import type { ApprovalDecision, UserQuestionReply } from "../../../integrations/harness";
import type { EditorNavigationTarget, OpenFileFn } from "../../search/model/search";
import type { ProjectAction } from "../../projects/model/projectActions";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import {
  layoutLeaves,
  layoutSashes,
  isFilesystemTab,
  MIN_PANE_RATIO,
  setSplitRatio,
  type EditorPane,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutSash,
  type PaneEdge,
  type PaneTabDropPosition,
} from "../model/layout";
import { sameProjectPath, type RecentProject } from "../../projects/model/recents";
import type { TerminalMetaPatch } from "../../terminal/model/terminalTab";
import {
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
} from "../../sessions/model/session";
import { FilePane } from "../../files/ui/FilePane";
import { MediaVisibilityContext } from "../../files/model/mediaVisibility";
import { SessionPane, type SessionPaneProps } from "../../sessions/ui/SessionPane";
import { paneBackgroundPlacement, syncPaneBackgrounds } from "../../../shared/lib/paneBackground";
import { paneRectStyle, sashKey, sashStyle, writeLayoutPreview } from "./paneTreePreview";
import { useShellSessionsSelector } from "../../sessions/model/sessionsStore";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import type { TranscriptPool } from "../../sessions/ui/TranscriptPool";
import type { SessionFolderTarget } from "../../sessions/model/sessionFolders";
import type { SessionOrganizationResult } from "../../sessions/model/sessionOrganizationStore";
import type { Worktree } from "../../source-control/model/worktrees";

type Shared = {
  workspaceSwitchingSessionId?: string;
  visible: boolean;
  /** Sessions to show. Omitted in the workspace: each pane then follows its own
   * session in the shell store, so a change elsewhere does not re-render the tree. */
  sessions?: Session[];
  editorPanes: EditorPane[];
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  focusedId: string;
  maximizedPaneId?: string | null;
  onToggleMaximizePane?: (paneId: string) => void;
  addToChatSessionId?: string;
  composerFocused: boolean;
  composerFocusToken?: number;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  onFocus: (paneId: string) => void;
  onSessionInteraction?: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRemoteSnapshot?: SessionPaneProps["onRemoteSnapshot"];
  onRefreshAdoptedSession?: SessionPaneProps["onRefreshAdoptedSession"];
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string, direction?: "left" | "right") => void;
  onOpenInNewWindow?: (paneId: string, fileId: string, position?: WindowMovePosition) => void;
  onPinFile?: (fileId: string) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  onMoveFile?: (
    fileId: string,
    targetPaneId: string,
    edge: PaneEdge,
    targetFileId?: string,
    position?: PaneTabDropPosition,
  ) => void;
  onFileDirtyChange: (fileId: string, dirty: boolean) => void;
  onFileErrorCountChange: (fileId: string, count: number) => void;
  onRatio: (splitId: string, index: number, ratio: number) => void;
  onCwdChange: (sessionId: string, cwd: string) => void;
  onBranchChange: (sessionId: string) => void;
  onWorktreeChange?: (sessionId: string, tree: Worktree) => Promise<void>;
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
  onRewindMessage?: SessionPaneProps["onRewindMessage"];
  onNewSession?: SessionPaneProps["onNewSession"];
  onPlaceSessionInFolder: (
    sessionId: string,
    target: SessionFolderTarget,
  ) => void | Promise<void | SessionOrganizationResult>;
  onResumeProviderSession?: (sessionId: string) => void;
  onDeleteQueuedMessage: (
    sessionId: string,
    messageId: string,
  ) => import("../../sessions").QueueRemoval;
  onEditQueuedMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    attachments: Attachment[],
  ) => void;
  onQueuedMessageEditingChange: (sessionId: string, messageId?: string) => void;
  onReorderQueuedMessages?: (sessionId: string, messageIds: string[]) => void;
  onSteerQueuedMessage: (sessionId: string, messageId: string) => void;
  onResumeQueue: (sessionId: string) => void;
  onUsageLimitResume: (sessionId: string) => void;
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
  onApproval: (sessionId: string, requestId: number, decision: ApprovalDecision) => void;
  onQuestionReply: (sessionId: string, requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (sessionId: string, requestId: number) => void;
  onOpenFile: OpenFileFn;
  editorNavigation?: EditorNavigationTarget | null;
  onOpenDiff: (path?: string, session?: { sessionId: string; cwd: string }) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
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
  onMovePane: (
    fromId: string,
    toId: string,
    edge: PaneEdge,
    tabPosition?: PaneTabDropPosition,
  ) => void;
  onPopOutPane?: (paneId: string, position: WindowMovePosition) => void;
  onDetachPane: (paneId: string, targetTabId: string, position: TitleTabDropPosition) => void;
  onNewTerminal: (sessionId: string) => void;
  onRunProjectAction?: (sessionId: string, action: ProjectAction) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
  transcriptPool?: TranscriptPool;
};

type Props = Shared & { layout: LayoutNode };

type PaneDrag = PaneDrop;

const DRAG_THRESHOLD = 5;

function PaneTreeComponent({
  visible,
  layout,
  sessions,
  editorPanes,
  dirtyFileIds,
  fileErrorCounts,
  focusedId,
  maximizedPaneId,
  onToggleMaximizePane,
  addToChatSessionId,
  composerFocused,
  composerFocusToken,
  recents,
  hideProjectPicker,
  workspaceSwitchingSessionId,
  onFocus,
  onSessionInteraction,
  onClose,
  onRemoteSnapshot,
  onRefreshAdoptedSession,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onOpenInNewWindow,
  onPinFile,
  onReorderFiles,
  onMoveFile,
  onFileDirtyChange,
  onFileErrorCountChange,
  onRatio,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
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
  onRewindMessage,
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
  editorNavigation,
  onOpenDiff,
  onOpenPlan,
  onUpdatePlan,
  onBuildPlan,
  onSecondOpinion,
  onBtwSubmit,
  onBtwRetry,
  onBtwDelete,
  onBtwStop,
  onBtwModelChange,
  onHandoff,
  onMovePane,
  onDetachPane,
  onPopOutPane,
  onNewTerminal,
  onRunProjectAction,
  onTerminalMetaChange,
  transcriptPool,
}: Props) {
  "use memo";
  const t = useT();
  const treeRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  // After every render: a new layout moves the leaves. A sash drag does not render;
  // it writes the boxes itself (`writeLayoutPreview`) and commits once at the end.
  useLayoutEffect(() => syncPaneBackgrounds(treeRef.current));
  const [paneDrag, setPaneDragState] = useState<PaneDrag | null>(null);
  const setPaneDrag = useCallback((next: PaneDrag | null) => {
    setPaneDragState((current) => (samePaneDrop(current, next) ? current : next));
  }, []);
  const [localMaximizedId, setLocalMaximizedId] = useState<string | null>(null);
  const externalDrop = useExternalPaneDrop(visible);
  const drop = paneDrag ?? externalDrop;
  // What a pane drag reads while it runs: the latest values, not the render it started in.
  const dragContents = useRef({
    editorPanes,
    sessionById: new Map<string, Session>() as ReadonlyMap<string, Session>,
    onFocus,
    onMovePane,
    onDetachPane,
    onPopOutPane,
  });
  const cancelPaneDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelPaneDrag.current?.(), []);
  useEffect(() => {
    if (!visible) cancelPaneDrag.current?.();
  }, [visible]);

  const leaves = layoutLeaves(layout);
  const maximumId = maximizedPaneId === undefined ? localMaximizedId : maximizedPaneId;
  const maximum = leaves.find(
    (pane) => pane.id === maximumId || pane.tabIds?.includes(maximumId ?? ""),
  );
  const toggleMaximum = (paneId: string) => {
    if (onToggleMaximizePane) onToggleMaximizePane(paneId);
    else setLocalMaximizedId(maximum ? null : paneId);
  };
  // A local maximum whose pane left the layout is forgotten. Previews only
  // change split ratios, so the previewed tree has the same leaves.
  if (
    localMaximizedId &&
    !leaves.some((pane) => pane.id === localMaximizedId || pane.tabIds?.includes(localMaximizedId))
  )
    setLocalMaximizedId(null);
  // Keep inactive group members mounted: editors retain unsaved buffers and
  // sessions retain their composer and streaming subscriptions.
  const renderLeaves = leaves.flatMap((pane) =>
    (pane.tabIds ?? [pane.id]).map((id) => ({ ...pane, id, hidden: id !== pane.id })),
  );
  // The pane edge, centre or whole tree a drop would land on. Drawn by the shared drop indicator
  // (not by a pane child) so a pane, a tab and a session row read the same; the cursor badge
  // alone carries the instruction.
  const dropMark = paneDropMark(drop, renderLeaves, leaves, maximum);
  const dropMarkId = dropMark?.id ?? null;
  const dropMarkPlacement = dropMark?.placement ?? null;
  useEffect(() => {
    if (!dropMarkPlacement) return;
    const tree = treeRef.current;
    const element = dropMarkId
      ? [...(tree?.querySelectorAll<HTMLElement>("[data-pane-id]") ?? [])].find(
          (pane) => pane.dataset.paneId === dropMarkId,
        )
      : tree;
    setDropIndicator(element ?? null, dropMarkPlacement);
    return () => clearDropIndicator();
  }, [dropMarkId, dropMarkPlacement]);
  const sashes = maximum ? [] : layoutSashes(layout);
  const inSplit = leaves.length > 1;
  // Split rectangles follow the available workspace width. Keep saved ratios
  // and mounted drafts as the sidebar grows; each pane owns its content overflow.
  // Only this tree's sessions (its panes, tab groups and agent file tabs), so a
  // status change in an unrelated session leaves the tree alone.
  // A hidden tree keeps what it last showed, as the memo below keeps its props.
  const shownIds = paneSessionIds(renderLeaves, editorPanes);
  const heldSessions = useRef<PaneSessions | null>(null);
  const paneSessions = useShellSessionsSelector(
    (shell) =>
      !visible && heldSessions.current
        ? heldSessions.current
        : selectPaneSessions(sessions ?? shell, shownIds),
    samePaneSessions,
  );
  const sessionById = paneSessions.byId;
  useLayoutEffect(() => {
    heldSessions.current = paneSessions;
    dragContents.current = {
      editorPanes,
      sessionById,
      onFocus,
      onMovePane,
      onDetachPane,
      onPopOutPane,
    };
  });

  // A pane split into an existing layout slides in from the edge it was added
  // on, like the linked work item panel. The neighbours reflow once up front;
  // only the new pane's content moves, so nothing rewraps mid-animation.
  // Panes present when the tree mounts, or swapped in place, just appear.
  const leafKey = leaves.map((leaf) => leaf.id).join("\0");
  const [seen, setSeen] = useState(() => ({ key: leafKey, size: leaves.length }));
  const [entering, setEntering] = useState<ReadonlyMap<string, PaneEnterFrom>>(() => new Map());
  if (seen.key !== leafKey) {
    const known = new Set(seen.key.split("\0"));
    const next = new Map([...entering].filter(([id]) => leaves.some((leaf) => leaf.id === id)));
    if (
      leaves.length > seen.size &&
      !document.hidden &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      for (const leaf of leaves) if (!known.has(leaf.id)) next.set(leaf.id, paneEnterFrom(leaf));
    setSeen({ key: leafKey, size: leaves.length });
    setEntering(next);
  }

  const enteringIds = [...entering.keys()].join("\0");
  useEffect(() => {
    if (!enteringIds) return;
    const finish = () => {
      setEntering(new Map());
    };
    const timer = window.setTimeout(finish, 320);
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enteringIds]);

  // One handler for every pane and tab: `SessionPane` compares props shallowly, so a
  // fresh handler per render would re-render the whole session subtree (transcript,
  // composer, picker). The pane comes from the nearest tab or pane element.
  const startPaneDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    const owner = handle.closest<HTMLElement>("[data-pane-tab-id], [data-pane-leaf]");
    const ownerId = owner?.dataset.paneTabId ?? owner?.dataset.paneLeaf;
    if (!ownerId) return;
    const fromId: string = ownerId; // hoisted inner functions do not keep the narrowing
    cancelPaneDrag.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let windowDrag: ReturnType<typeof beginWindowTabDrag> | undefined;
    const canPopOut = () =>
      Boolean(dragContents.current.onPopOutPane) &&
      !dragContents.current.editorPanes
        .find((pane) => pane.id === fromId)
        ?.files.some((file) => file.terminal);

    let lastX = startX;
    let lastY = startY;
    let screenX = event.screenX;
    let screenY = event.screenY;
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();
    const dropTarget = (x: number, y: number) => {
      const over = paneDropFromPoint(x, y);
      if (over?.tabPosition) return over;
      if (over?.id !== fromId) return over;
      const group = layoutLeaves(layoutRef.current).find((pane) => pane.id === fromId);
      const sibling = group?.tabIds?.find((id) => id !== fromId);
      return sibling ? { ...over, id: sibling } : over;
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      screenX = ev.screenX;
      screenY = ev.screenY;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) {
          return;
        }
        active = true;
        setGrabbing(true);
        dragContents.current.onFocus(fromId);
        setPaneDrag({ fromId, overId: null, edge: "left" });
      }
      const titleTab = titleTabDropFromPoint(ev.clientX, ev.clientY);
      if (canPopOut()) {
        if (!windowDrag) {
          const editor = dragContents.current.editorPanes.find((pane) => pane.id === fromId);
          const file = editor?.files.length === 1 ? editor.files[0] : undefined;
          const fileOnly = file && isFilesystemTab(file) && !file.terminal;
          windowDrag = beginWindowTabDrag(fileOnly ? `file:${file.id}` : fromId, [
            fromId,
            ...(editor?.files.map((entry) => entry.id) ?? []),
          ]);
        }
        windowDrag.move(ev);
      }
      setExternalTitleTabDrop(titleTab ? { fromId, ...titleTab } : null);
      if (
        canPopOut() &&
        isPointerOutsideWindow(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)
      ) {
        setDropFeedback(
          "window",
          ev,
          dragContents.current.sessionById.get(fromId)?.busy
            ? "Move after response finishes"
            : undefined,
        );
        setPaneDrag({ fromId, overId: null, edge: "left" });
        return;
      }
      if (titleTab) {
        setDropFeedback("move", ev, "Release to create a tab");
        setPaneDrag({ fromId, overId: null, edge: "left" });
        return;
      }
      const over = dropTarget(ev.clientX, ev.clientY);
      if (!over || over.invalid || (over.id === fromId && over.edge === "center")) {
        setDropFeedback("blocked", ev);
        setPaneDrag({
          fromId,
          overId: over?.id ?? null,
          edge: over?.edge ?? "left",
          invalid: true,
        });
        return;
      }
      setPaneDrag({ fromId, overId: over.id, edge: over.edge, tabPosition: over.tabPosition });
      setDropFeedback(
        "move",
        ev,
        over.id === fromId
          ? `Split ${over.edge} with a new session`
          : over.edge === "center"
            ? "Add as pane tab"
            : `Place ${over.edge}`,
      );
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      onMove(ev);
      finish(true);
    };
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      finish(false);
    };

    function finish(commit: boolean) {
      windowDrag?.finish();
      cancelPaneDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onCancel);
      handle.removeEventListener("lostpointercapture", onCancel);
      restoreSelection();
      setGrabbing(false);
      setPaneDrag(null);
      setExternalTitleTabDrop(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!active || !commit) return;
      if (
        canPopOut() &&
        isPointerOutsideWindow(lastX, lastY, window.innerWidth, window.innerHeight)
      ) {
        dragContents.current.onPopOutPane?.(
          fromId,
          pointerWindowMovePosition({
            screenX,
            screenY,
            clientX: lastX,
            clientY: lastY,
          }),
        );
        return;
      }
      const titleTab = titleTabDropFromPoint(lastX, lastY);
      if (titleTab) {
        dragContents.current.onDetachPane(fromId, titleTab.targetTabId, titleTab.position);
        return;
      }
      const over = dropTarget(lastX, lastY);
      if (over && !over.invalid && (over.id !== fromId || over.edge !== "center")) {
        if (over.tabPosition)
          dragContents.current.onMovePane(fromId, over.id, over.edge, over.tabPosition);
        else dragContents.current.onMovePane(fromId, over.id, over.edge);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
    handle.addEventListener("lostpointercapture", onCancel);
    cancelPaneDrag.current = onCancel;
  }, []);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      <div
        ref={treeRef}
        className="relative h-full min-h-0 min-w-0"
        data-pane-maximized={maximum?.id}
      >
        {renderLeaves.map((leaf) => {
          const editorPane = editorPanes.find((pane) => pane.id === leaf.id);
          const session = sessionById.get(leaf.id);
          const dragging = drop?.fromId === leaf.id;
          const groupSelected = leaves.find(
            (pane) => pane.id === leaf.id || pane.tabIds?.includes(leaf.id),
          );
          const hidden = leaf.hidden || Boolean(maximum && groupSelected?.id !== maximum.id);
          const rect = maximum ? { x: 0, y: 0, w: 1, h: 1 } : leaf.rect;
          const onPaneDragStart = startPaneDrag;
          return (
            <div
              key={leaf.id}
              data-pane-leaf={leaf.id}
              data-pane-background={paneBackgroundPlacement(rect)}
              data-pane-id={hidden ? undefined : leaf.id}
              data-pane-active={focusedId === leaf.id ? "true" : undefined}
              // User interaction keeps a browsing tab; automatic composer focus does not.
              onPointerDownCapture={() => {
                if (!session) return;
                if (focusedId !== session.id) onFocus(session.id);
                onSessionInteraction?.(session.id);
              }}
              onKeyDownCapture={() => {
                if (!session) return;
                if (focusedId !== session.id) onFocus(session.id);
                onSessionInteraction?.(session.id);
              }}
              onKeyUpCapture={(event) => {
                if (event.key === "Tab" && session) onSessionInteraction?.(session.id);
              }}
              onInputCapture={() => session && onSessionInteraction?.(session.id)}
              data-pane-can-maximize={(inSplit || maximum) && !hidden ? "true" : undefined}
              className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden ${dragging ? "opacity-40" : ""}`}
              // The new pane focuses its composer or editor while it is still
              // offscreen, and focus scrolls this clip box to reveal it, which
              // fights the slide. Scroll events land before paint, so undoing
              // it here never shows.
              onScroll={(event) => {
                if (!entering.has(leaf.id)) return;
                event.currentTarget.scrollLeft = 0;
                event.currentTarget.scrollTop = 0;
              }}
              style={{ display: hidden ? "none" : undefined, ...paneRectStyle(rect) }}
            >
              {leaf.tabIds && leaf.tabIds.length > 1 ? (
                <Tabs value={leaf.id} onValueChange={onFocus} panels="none">
                  <TabList
                    label={t("Pane sessions")}
                    className="flex shrink-0 overflow-x-auto border-b border-stroke bg-surface"
                  >
                    {leaf.tabIds.map((id) => (
                      <Tab
                        key={id}
                        value={id}
                        type="button"
                        data-pane-tab-id={id}
                        className={`relative max-w-48 shrink-0 truncate `}
                        onClick={(event) => {
                          event.preventDefault();
                          onFocus(id);
                        }}
                        onKeyDown={(event) => {
                          // Plain arrows, Home and End are the shared tab list's; Alt+Shift moves the pane.
                          const delta =
                            event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                          if (!event.altKey || !event.shiftKey || !delta) return;
                          const ids = leaf.tabIds!;
                          event.preventDefault();
                          event.stopPropagation();
                          const to = ids[(ids.indexOf(id) + delta + ids.length) % ids.length];
                          onMovePane(id, to, "center", delta < 0 ? "before" : "after");
                        }}
                        onPointerDown={startPaneDrag}
                        tooltip={
                          sessionById.get(id)?.title ||
                          editorPanes
                            .find((pane) => pane.id === id)
                            ?.files[0]?.path.split(/[\\/]/)
                            .pop() ||
                          t("Session")
                        }
                        tooltipWhen="overflow"
                      >
                        {sessionById.get(id)?.title ||
                          editorPanes
                            .find((pane) => pane.id === id)
                            ?.files[0]?.path.split(/[\\/]/)
                            .pop() ||
                          t("Session")}
                        {drop?.overId === id && drop.tabPosition ? (
                          <span
                            data-pane-tab-drop={drop.tabPosition}
                            className={`pointer-events-none absolute inset-y-0 w-(--ui-drop-line-size) rounded-full ${drop.tabPosition === "before" ? "start-0" : "end-0"} ${drop.invalid ? "bg-(--ui-drop-blocked)" : "bg-(--ui-drop-line)"}`}
                          />
                        ) : null}
                      </Tab>
                    ))}
                  </TabList>
                </Tabs>
              ) : null}
              {(inSplit || maximum) && !hidden ? (
                <Button
                  iconOnly
                  label={t(maximum ? "Restore panel layout" : "Maximize panel")}
                  variant="ghost"
                  motion="none"
                  type="button"
                  aria-label={t(maximum ? "Restore panel layout" : "Maximize panel")}
                  aria-pressed={Boolean(maximum)}
                  data-pane-maximize={leaf.id}
                  onClick={() => toggleMaximum(leaf.id)}
                  className="absolute [inset-block-start:0.25rem] end-2 z-1 grid place-items-center"
                >
                  {maximum ? <Minimize2 className="icon-sm" /> : <Maximize2 className="icon-sm" />}
                </Button>
              ) : null}
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col"
                data-pane-enter={entering.get(leaf.id)}
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (!entering.has(leaf.id)) return;
                  const next = new Map(entering);
                  next.delete(leaf.id);
                  setEntering(next);
                }}
              >
                <MediaVisibilityContext.Provider value={visible && !hidden}>
                  {editorPane ? (
                    <RecoveryBoundary
                      resetKeys={[leaf.id, editorPane.activeFileId]}
                      onBack={() => onCloseFile(editorPane.id, editorPane.activeFileId)}
                    >
                      <FilePane
                        pane={editorPane}
                        focused={focusedId === editorPane.id}
                        visible={visible && !hidden}
                        showTabs
                        dirtyFileIds={dirtyFileIds}
                        fileErrorCounts={fileErrorCounts}
                        sessions={paneSessions.list}
                        onFocus={onFocus}
                        onSelectFile={onSelectFile}
                        onCloseFile={onCloseFile}
                        onCloseOtherFiles={onCloseOtherFiles}
                        onOpenInNewWindow={onOpenInNewWindow}
                        onPinFile={onPinFile}
                        onReorderFiles={onReorderFiles}
                        onMoveFile={onMoveFile}
                        onDirtyChange={onFileDirtyChange}
                        onErrorCountChange={onFileErrorCountChange}
                        onOpenFile={onOpenFile}
                        onUpdatePlan={onUpdatePlan}
                        onBuildPlan={onBuildPlan}
                        editorNavigation={editorNavigation}
                        onPaneDragStart={onPaneDragStart}
                        onTerminalMetaChange={onTerminalMetaChange}
                      />
                    </RecoveryBoundary>
                  ) : session ? (
                    <RecoveryBoundary
                      resetKeys={[leaf.id, session.id]}
                      onBack={() => onClose(session.id)}
                    >
                      <SessionPane
                        session={session}
                        workspaceSwitchingSessionId={workspaceSwitchingSessionId}
                        reviewUndoLocked={paneSessions.undoLocked.has(session.id)}
                        visible={visible && !hidden}
                        focused={focusedId === session.id}
                        addToChatTarget={addToChatSessionId === session.id}
                        inSplit={inSplit}
                        composerFocused={composerFocused}
                        composerFocusToken={composerFocusToken}
                        recents={recents}
                        hideProjectPicker={hideProjectPicker}
                        onFocus={onFocus}
                        onClose={onClose}
                        onRemoteSnapshot={onRemoteSnapshot}
                        onRefreshAdoptedSession={onRefreshAdoptedSession}
                        onCwdChange={onCwdChange}
                        onBranchChange={onBranchChange}
                        onWorktreeChange={onWorktreeChange}
                        onWorkspaceModeChange={onWorkspaceModeChange}
                        onWorktreeBaseChange={onWorktreeBaseChange}
                        onManageWorktrees={onManageWorktrees}
                        onModelChange={onModelChange}
                        onModelSettingsChange={onModelSettingsChange}
                        onRuntimeModeChange={onRuntimeModeChange}
                        onSaveDraft={onSaveDraft}
                        onRemoveDraft={onRemoveDraft}
                        onSubmit={onSubmit}
                        onStop={onStop}
                        onCompactContext={onCompactContext}
                        onRewindMessage={onRewindMessage}
                        onNewSession={onNewSession}
                        onPlaceSessionInFolder={onPlaceSessionInFolder}
                        onResumeProviderSession={onResumeProviderSession}
                        onDeleteQueuedMessage={onDeleteQueuedMessage}
                        onEditQueuedMessage={onEditQueuedMessage}
                        onQueuedMessageEditingChange={onQueuedMessageEditingChange}
                        onReorderQueuedMessages={onReorderQueuedMessages}
                        onSteerQueuedMessage={onSteerQueuedMessage}
                        onResumeQueue={onResumeQueue}
                        onUsageLimitResume={onUsageLimitResume}
                        onUsageLimitResumeAtReset={onUsageLimitResumeAtReset}
                        onUsageLimitDismiss={onUsageLimitDismiss}
                        onSelectProviderAccount={onSelectProviderAccount}
                        onInboxCardDismiss={onInboxCardDismiss}
                        onLinkedWorkItemUpdateCardDismiss={onLinkedWorkItemUpdateCardDismiss}
                        onNoteCardDismiss={onNoteCardDismiss}
                        onHandoffCardDismiss={onHandoffCardDismiss}
                        onOpenLinkedWorkItem={onOpenLinkedWorkItem}
                        onArchiveSession={onArchiveSession}
                        onDeleteSession={onDeleteSession}
                        onApproval={onApproval}
                        onQuestionReply={onQuestionReply}
                        onQuestionInteraction={onQuestionInteraction}
                        onOpenFile={onOpenFile}
                        onOpenDiff={onOpenDiff}
                        onOpenPlan={onOpenPlan}
                        onBuildPlan={onBuildPlan}
                        onSecondOpinion={onSecondOpinion}
                        onHandoff={onHandoff}
                        onBtwSubmit={onBtwSubmit}
                        onBtwRetry={onBtwRetry}
                        onBtwDelete={onBtwDelete}
                        onBtwStop={onBtwStop}
                        onBtwModelChange={onBtwModelChange}
                        onNewTerminal={onNewTerminal}
                        onRunProjectAction={onRunProjectAction}
                        onPaneDragStart={onPaneDragStart}
                        transcriptPool={transcriptPool}
                      />
                    </RecoveryBoundary>
                  ) : null}
                </MediaVisibilityContext.Provider>
              </div>
            </div>
          );
        })}
        {sashes.map((sash) => (
          <PaneSash
            key={`${sash.splitId}:${sash.index}`}
            sash={sash}
            containerRef={treeRef}
            onPreview={(ratio) =>
              writeLayoutPreview(
                treeRef.current,
                setSplitRatio(layoutRef.current, sash.splitId, sash.index, ratio),
              )
            }
            onCommit={(ratio) => onRatio(sash.splitId, sash.index, ratio)}
            onCancel={() => writeLayoutPreview(treeRef.current, layoutRef.current)}
          />
        ))}
      </div>
    </div>
  );
}

const MemoPaneTree = memo(
  PaneTreeComponent,
  (previous, next) => (!previous.visible && !next.visible) || sameProps(previous, next),
);

/** Hidden trees never re-render; a visible one only when a value it shows
 * changed. Handlers are stable proxies, so recreated callbacks do not count. */
export function PaneTree(props: Props) {
  return <MemoPaneTree {...useStableHandlers(props)} />;
}

function sameProps(a: Props, b: Props): boolean {
  const keys = Object.keys(a) as (keyof Props)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

type PaneSessions = {
  byId: ReadonlyMap<string, Session>;
  list: Session[];
  /** Sessions whose review undo waits for another busy session in the same checkout. */
  undoLocked: ReadonlySet<string>;
};

function paneSessionIds(
  leaves: readonly { id: string }[],
  editorPanes: readonly EditorPane[],
): string[] {
  const ids = new Set(leaves.map((leaf) => leaf.id));
  for (const pane of editorPanes)
    for (const file of pane.files) if (file.agent?.sessionId) ids.add(file.agent.sessionId);
  return [...ids];
}

function selectPaneSessions(sessions: readonly Session[], ids: readonly string[]): PaneSessions {
  const wanted = new Set(ids);
  const byId = new Map<string, Session>();
  for (const session of sessions) if (wanted.has(session.id)) byId.set(session.id, session);
  const busy = sessions.filter((session) => session.busy);
  const undoLocked = new Set<string>();
  if (busy.length > 0)
    for (const session of byId.values()) {
      const cwd = sessionWorkCwd(session);
      if (
        busy.some((other) => other.id !== session.id && sameProjectPath(sessionWorkCwd(other), cwd))
      )
        undoLocked.add(session.id);
    }
  return { byId, list: [...byId.values()], undoLocked };
}

function samePaneSessions(a: PaneSessions, b: PaneSessions): boolean {
  if (a.byId.size !== b.byId.size || a.undoLocked.size !== b.undoLocked.size) return false;
  for (const [id, session] of a.byId) if (b.byId.get(id) !== session) return false;
  for (const id of a.undoLocked) if (!b.undoLocked.has(id)) return false;
  return true;
}

type PaneEnterFrom = "left" | "right" | "top" | "bottom" | "fade";

function paneEnterFrom({ rect, axis }: LayoutLeaf): PaneEnterFrom {
  const edge = 0.001;
  if (axis === "x") {
    if (rect.x + rect.w >= 1 - edge) return "right";
    if (rect.x <= edge) return "left";
  } else {
    if (rect.y + rect.h >= 1 - edge) return "bottom";
    if (rect.y <= edge) return "top";
  }
  return "fade";
}

const PANE_EDGE_PLACEMENT: Record<PaneEdge, DropPlacement> = {
  left: "split-start",
  right: "split-end",
  top: "split-top",
  bottom: "split-bottom",
  center: "inside",
};

/**
 * Where the shared drop indicator goes for the current pane drop: the visible pane that would
 * receive it (edge half to split, whole pane for a tab), or the whole tree when the pointer is over
 * no valid pane. A refused target is marked "blocked" so it never reads as an accepted split.
 */
function paneDropMark(
  drop: PaneDrop | null,
  renderLeaves: readonly (LayoutLeaf & { hidden: boolean })[],
  leaves: readonly LayoutLeaf[],
  maximum: LayoutLeaf | undefined,
): { id: string | null; placement: DropPlacement } | null {
  if (!drop || drop.targetFileId) return null;
  if (drop.invalid && !drop.overId) return { id: null, placement: "blocked" };
  const leaf = renderLeaves.find((candidate) => {
    const groupSelected = leaves.find(
      (pane) => pane.id === candidate.id || pane.tabIds?.includes(candidate.id),
    );
    const hidden = candidate.hidden || Boolean(maximum && groupSelected?.id !== maximum.id);
    return (
      !hidden &&
      (drop.overId === candidate.id || candidate.tabIds?.includes(drop.overId ?? "")) &&
      (drop.fromId !== candidate.id ||
        drop.edge !== "center" ||
        (candidate.tabIds?.length ?? 0) > 1)
    );
  });
  if (!leaf) return null;
  return {
    id: leaf.id,
    placement: drop.invalid ? "blocked" : PANE_EDGE_PLACEMENT[drop.edge],
  };
}

function PaneSash({
  sash,
  containerRef,
  onPreview,
  onCommit,
  onCancel,
}: {
  sash: LayoutSash;
  containerRef: { current: HTMLDivElement | null };
  onPreview: (ratio: number) => void;
  onCommit: (ratio: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const gesture = useRef({ start: 0, span: 0 });
  const row = sash.dir === "right";
  const boundary = sash.sizes.slice(0, sash.index + 1).reduce((sum, size) => sum + size, 0);
  const before = sash.sizes.slice(0, sash.index).reduce((sum, size) => sum + size, 0);
  const pairSize = sash.sizes[sash.index] + sash.sizes[sash.index + 1];
  const minimum = Math.min(MIN_PANE_RATIO, pairSize / 2);
  const group = sash.group;
  const ratioAt = (delta: number) =>
    gesture.current.start + (gesture.current.span > 0 ? delta / gesture.current.span : 0);

  return (
    <ResizeSash
      orientation={row ? "vertical" : "horizontal"}
      label={t(row ? "Resize columns" : "Resize rows")}
      value={Math.round(boundary * 100)}
      min={Math.round((before + minimum) * 100)}
      max={Math.round((before + pairSize - minimum) * 100)}
      className="absolute"
      data-pane-sash={sashKey(sash)}
      onResizeStart={() => {
        const rect = containerRef.current?.getBoundingClientRect();
        gesture.current = {
          start: boundary,
          span: rect ? (row ? group.w * rect.width : group.h * rect.height) : 0,
        };
      }}
      onResize={(delta) => {
        if (gesture.current.span > 0) onPreview(ratioAt(delta));
      }}
      onResizeEnd={(delta, { cancelled, moved }) => {
        if (cancelled || !moved || gesture.current.span <= 0) onCancel();
        else {
          // The last frame may not have run; commit the box the pointer ended on.
          onPreview(ratioAt(delta));
          onCommit(ratioAt(delta));
        }
      }}
      onKeyDown={(event) => {
        const decrease = row ? "ArrowLeft" : "ArrowUp";
        const increase = row ? "ArrowRight" : "ArrowDown";
        let next: number;
        if (event.key === decrease) next = boundary - (event.shiftKey ? 0.1 : 0.02);
        else if (event.key === increase) next = boundary + (event.shiftKey ? 0.1 : 0.02);
        else if (event.key === "Home") next = before;
        else if (event.key === "End") next = before + pairSize;
        else if (event.key === "Enter") next = before + pairSize / 2;
        else return;
        event.preventDefault();
        event.stopPropagation();
        onCommit(next);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCommit(before + pairSize / 2);
      }}
      style={sashStyle(sash)}
    />
  );
}
