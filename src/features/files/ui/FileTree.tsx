import { TextField } from "../../../shared/ui/TextField";
import {
  TreeRow,
  TreeRowIcon,
  TreeRowLabel,
  TreeRowToggle,
  TreeRowTrailing,
} from "../../../shared/ui/TreeRow";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Spinner } from "../../../shared/ui/Spinner";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Alert } from "../../../shared/ui/Alert";
import { getLocale, t, useLocale } from "../../../shared/i18n/technical";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePlus,
  FolderPlus,
  FolderOpen,
  FoldVertical,
  RefreshCw,
  Search,
  MoreHorizontal,
  ListFilter,
} from "../../../shared/ui/icons";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { leafName, validateFileName, type NameIssue } from "../model/fileName";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isImeComposition } from "../../../shared/lib/keyboard";
import {
  loadShowExcludedFiles,
  saveShowExcludedFiles,
  SHOW_EXCLUDED_FILES_DEFAULT,
  subscribeShowExcludedFiles,
} from "../../settings/public/appearance";
import {
  createParentOf,
  listCachedDir,
  loadExpanded,
  loadSelected,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  verifiedDirAt,
  saveExpanded,
  saveSelected,
  announceDirListings,
  subscribeDirListings,
  TREE_WINDOW_CHUNK,
  windowEntries,
  displayDirEntries,
} from "../model/fileTree";
import { GIT_ACTIONS, useRemoteSupports } from "../../connections/public/remoteCapabilities";
import { useRemoteLoadFailure } from "../../connections/public/remoteHealth";
import { RemoteLoadError } from "../../connections/public/RemoteLoadError";
import type { RemoteDataState } from "../../connections";
import { basename, clipboardFilePaths, type FsEntry } from "../../../platform/tauri/fs";
import { parentPath } from "../../../shared/lib/paths";
import { MOD } from "../../../platform/tauri/platform";
import type { OpenFileFn } from "../../search/model/search";
import {
  gitStatusForPath,
  type GitStatusMap,
} from "../../source-control/public/useGitFileStatuses";
import {
  announceDrag,
  clearDropFeedback,
  emitExplorerFilePointerDrag,
  setDropFeedback,
  setDropIndicator,
  setGrabbing,
  suppressTextSelection,
} from "../../../shared/lib/drag";
import { ExplorerMenu } from "./ExplorerMenu";
import {
  explorerHeaderItems,
  explorerItems,
  gateBusyMenuItems,
  menuCreateParent,
} from "./explorerMenuItems";
import { FileTypeIcon } from "./FileTypeIcon";
import { useRemoteFolderBrowser } from "./useRemoteFolderBrowser";
import {
  isDirAt,
  type Clip,
  type Creating,
  type MenuState,
  type RefreshFailure,
} from "./fileTreeSupport";
import { useFileTreeExternalDrop } from "./useFileTreeExternalDrop";
import { rowPath, useFileTreeKeyboard } from "./useFileTreeKeyboard";
import { transferVerdict, useFileTreeOperations } from "./useFileTreeOperations";
import { useFileTreePolling } from "./useFileTreePolling";
import {
  selectTreePaths,
  topLevelTreePaths,
  type TreeSelectionModifiers,
} from "../model/treeSelection";
// Status is never colour-only: each state also carries a letter marker.
const GIT_STATUS_MARK: Record<string, { mark: string; label: string }> = {
  modified: { mark: "M", label: "Modified" },
  added: { mark: "A", label: "Added" },
  untracked: { mark: "U", label: "Untracked" },
  deleted: { mark: "D", label: "Deleted" },
};
const GIT_STATUS_COLOR: Record<string, string> = {
  modified: "text-(--ui-tone-warning-fg)",
  added: "text-diff-add-fg",
  untracked: "text-diff-add-fg",
  deleted: "text-diff-del-fg",
};

type Props = {
  cwd: string;
  /** Display identity for the root when it differs from the physical folder. */
  rootLabel?: string;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  onSearch?: () => void;
  onCloseSearch?: () => void;
  /** Shown under the toolbar in place of the tree while project search is open. */
  search?: ReactNode;
  gitStatuses?: GitStatusMap;
  /** False while another sidebar tab covers the tree: its refresh poll pauses. */
  visible?: boolean;
};

/** Header widths below this fold Collapse All and Search into the Explorer actions menu. */
const NARROW_HEADER_WIDTH = 200;

// Changing state: only TreeChildren reads it and hands each TreeNode
// primitive per-node props, so a node re-renders only when its own values change.
type TreeStateValue = {
  expanded: Set<string>;
  selectedPaths: Set<string>;
  creating: Creating | null;
  renaming: string | null;
  cutPaths: Set<string>;
  dragOverPath: string | null;
  showExcludedFiles: boolean;
  gitStatuses?: GitStatusMap;
};

// Referentially stable wrappers that call the latest handlers.
type TreeActions = {
  onToggle: (path: string) => void;
  onSelect: (path: string, modifiers?: TreeSelectionModifiers) => void;
  onFilePointerDown: (path: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  consumeFileClick: () => boolean;
  onOpenFile: OpenFileFn;
  onCreateCommit: (id: number, raw: string) => Promise<void>;
  onCreateCancel: (id: number) => void;
  onRenameCommit: (path: string, raw: string) => Promise<void>;
  onRenameCancel: () => void;
  onItemContextMenu: (entry: { path: string; isDir: boolean }, e: ReactMouseEvent) => void;
};

type TreeStore = ReturnType<typeof createTreeStore>;
function createTreeStore(initial: TreeStateValue) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: TreeStateValue) {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
const TreeStateCtx = createContext<TreeStore | null>(null);
const TreeActionsCtx = createContext<TreeActions | null>(null);

/**
 * The snapshot reader for one directory: it keeps returning the previous state object until
 * something its immediate rows read has changed. The memo is private to that directory.
 */
function createDirectorySnapshot(store: TreeStore, parent: string, entries: FsEntry[] | null) {
  let previous = store.getSnapshot();
  return () => {
    const next = store.getSnapshot();
    const changed =
      next.showExcludedFiles !== previous.showExcludedFiles ||
      (next.creating?.parent === parent ? next.creating : null) !==
        (previous.creating?.parent === parent ? previous.creating : null) ||
      (entries ?? []).some(
        ({ path, isDir }) =>
          next.expanded.has(path) !== previous.expanded.has(path) ||
          next.selectedPaths.has(path) !== previous.selectedPaths.has(path) ||
          (next.renaming === path) !== (previous.renaming === path) ||
          next.cutPaths.has(path) !== previous.cutPaths.has(path) ||
          (next.dragOverPath === path) !== (previous.dragOverPath === path) ||
          gitStatusForPath(isDir ? next.gitStatuses?.dirs : next.gitStatuses?.files, path) !==
            gitStatusForPath(
              isDir ? previous.gitStatuses?.dirs : previous.gitStatuses?.files,
              path,
            ),
      );
    if (changed) previous = next;
    return previous;
  };
}

/** A directory observes only the state read by its immediate rows. */
function useTreeState(parent: string, entries: FsEntry[] | null): TreeStateValue {
  const store = useContext(TreeStateCtx);
  if (!store) throw new Error("TreeStateCtx missing");
  const snapshot = useMemo(
    () => createDirectorySnapshot(store, parent, entries),
    [store, parent, entries],
  );
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

function useTreeActions(): TreeActions {
  const ctx = useContext(TreeActionsCtx);
  if (!ctx) throw new Error("TreeActionsCtx missing");
  return ctx;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    const focused = document.activeElement;
    try {
      el.select();
      if (!document.execCommand("copy")) throw new Error(t("Could not copy. Try again."));
    } finally {
      el.remove();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    }
  }
}

/** Click suppression after a drag reads the clock only in event handlers. */
function clickStillSuppressed(until: number): boolean {
  return performance.now() < until;
}

function FileTreeInner({
  cwd,
  rootLabel,
  onOpenFile,
  onOpenTerminal,
  onFileMoved,
  onFileDeleted,
  onSearch,
  onCloseSearch,
  search,
  gitStatuses,
  visible = true,
}: Props) {
  useLocale();
  const [expanded, setExpanded] = useState(() => loadExpanded(cwd));
  const [selectedPath, setSelectedPath] = useState(() => loadSelected(cwd));
  // Handlers compute the next expansion/selection from these (the latest
  // committed or just-issued value) and persist once, outside state updaters.
  const expandedRef = useRef(expanded);
  const selectedPathRef = useRef(selectedPath);
  useLayoutEffect(() => {
    expandedRef.current = expanded;
    selectedPathRef.current = selectedPath;
  }, [expanded, selectedPath]);
  const commitExpanded = (next: Set<string>) => {
    expandedRef.current = next;
    setExpanded(next);
    saveExpanded(cwd, next);
  };
  const commitSelectedPath = (next: string | null) => {
    selectedPathRef.current = next;
    setSelectedPath(next);
    saveSelected(cwd, next);
  };
  const [selectedPaths, setSelectedPaths] = useState(
    () => new Set(selectedPath ? [selectedPath] : []),
  );
  const selectionAnchor = useRef(selectedPath);
  const [children, setChildren] = useState<FsEntry[] | null>(() => peekDir(cwd));
  const [error, setError] = useState<string | null>(null);
  const [rootRefreshing, setRootRefreshing] = useState(false);
  const [rootUpdatedAt, setRootUpdatedAt] = useState<number | undefined>(() =>
    peekDir(cwd) ? verifiedDirAt(cwd) : undefined,
  );
  const rootRefreshRequest = useRef(0);
  useEffect(
    () => () => {
      rootRefreshRequest.current++;
    },
    [],
  );
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  // An inline create/rename that has been submitted and is waiting on the filesystem.
  const [editPending, setEditPending] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copyFailedText, setCopyFailedText] = useState<string | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const headerMenuRef = useRef<HTMLButtonElement>(null);
  // The tree is keyed by cwd, so its root never changes for this instance.
  const activeRoot = useRef(cwd);
  const [refreshFailure, setRefreshFailure] = useState<RefreshFailure | null>(null);
  const { revealInFileManager, folderBrowser } = useRemoteFolderBrowser(onOpenFile);
  // Re-runs the root listing effect only when the root's own listing changes.
  const rootListing = useSyncExternalStore(
    subscribeDirListings,
    () => peekDir(cwd),
    () => peekDir(cwd),
  );
  const showExcludedFiles = useSyncExternalStore(
    subscribeShowExcludedFiles,
    loadShowExcludedFiles,
    loadShowExcludedFiles,
  );
  const creatingRef = useRef(creating);
  useLayoutEffect(() => {
    creatingRef.current = creating;
  }, [creating]);
  const fileDragCleanup = useRef<(() => void) | null>(null);
  const suppressFileClickUntil = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const name = rootLabel?.trim() || basename(cwd);
  const rootOpen = expanded.has(cwd);
  // File History and Blame need this computer or a host with `git.actions`.
  const canInspectGit = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const connectionFailure = useRemoteLoadFailure(cwd, "files");
  // Why creating cannot start at all: no folder to create in, or a remote machine that cannot be
  // asked. These are the capability signals the tree already has; there is no per-folder permission.
  const createUnavailableReason =
    !cwd || cwd === "~"
      ? t("Open a project folder first")
      : connectionFailure?.kind === "unreachable"
        ? t("This machine is unreachable")
        : connectionFailure?.kind === "identity"
          ? t("Pair this machine again to change files")
          : connectionFailure?.kind === "outdated"
            ? t("Update the host to change files")
            : undefined;

  const toggle = (path: string) => {
    const next = new Set(expandedRef.current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    commitExpanded(next);
  };

  const onSelect = (path: string, modifiers: TreeSelectionModifiers = {}) => {
    const visible = modifiers.shiftKey
      ? visibleRows()
          .map((row) => rowPath(row))
          .filter((value) => value !== cwd)
      : [];
    const anchor = selectionAnchor.current;
    setSelectedPaths((current) =>
      path === cwd ? new Set() : selectTreePaths(current, path, anchor, visible, modifiers),
    );
    if (!modifiers.shiftKey) selectionAnchor.current = path;
    commitSelectedPath(path);
  };

  const actionPaths = (path: string) =>
    path === cwd
      ? []
      : selectedPaths.size
        ? [...selectedPaths].filter((value) => value !== cwd)
        : [path];

  // Keep the selection stable, but make hidden mutation targets explicit.
  const hiddenSelectedPaths = [...selectedPaths].filter((path) => {
    if (path === cwd) return false;
    let current = path;
    while (current !== cwd) {
      const parent = parentPath(current);
      if (!parent || parent === current) return true;
      if (!expanded.has(parent)) return true;
      const entry = peekDir(parent)?.find((value) => value.path === current);
      if (!showExcludedFiles && entry?.ignored) return true;
      current = parent;
    }
    return false;
  });

  const copyPathText = async (value: string) => {
    setCopyNotice(null);
    setCopyFailedText(null);
    setOpError(null);
    try {
      await copyText(value);
      if (activeRoot.current === cwd) setCopyNotice(t("Copied"));
    } catch (error) {
      if (activeRoot.current === cwd) {
        setCopyFailedText(value);
        setOpError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const setClipboard = (mode: "copy" | "cut", path: string) => {
    setClip({
      mode,
      systemFiles: clipboardFilePaths().catch(() => null),
      entries: topLevelTreePaths(actionPaths(path)).map((value) => ({
        path: value,
        isDir: isDirAt(cwd, value),
      })),
    });
  };

  const internalDropTarget = (x: number, y: number): string | null => {
    const element = document.elementFromPoint?.(x, y);
    if (!element || !rootRef.current?.contains(element)) return null;
    const row = element.closest<HTMLElement>("[role='treeitem'], [data-explorer-root]");
    return row ? createParentOf(cwd, rowPath(row)) : null;
  };

  const onFilePointerDown = (path: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      fileDragCleanup.current
    )
      return;
    const dragPaths = topLevelTreePaths(selectedPaths.has(path) ? [...selectedPaths] : [path]);
    const attachmentPaths = dragPaths.filter((value) => !isDirAt(cwd, value));
    const dragDetail = attachmentPaths.length > 1 ? { paths: attachmentPaths } : {};
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let active = false;
    let restoreSelection: (() => void) | undefined;
    let preview: HTMLDivElement | null = null;
    // True while this gesture owns the cursor badge and the folder mark (a tree row is the target).
    let showingTarget = false;
    let announcedTarget = "";
    let copyIntent = false;

    const movePreview = () => {
      if (!preview) return;
      const edge = 8;
      const grabX = 12;
      const grabY = 13;
      const width = preview.offsetWidth;
      const height = preview.offsetHeight;
      const x = Math.min(
        Math.max(edge, lastX - grabX),
        Math.max(edge, window.innerWidth - width - edge),
      );
      const y = Math.min(
        Math.max(edge, lastY - grabY),
        Math.max(edge, window.innerHeight - height - edge),
      );
      preview.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    };

    const createPreview = () => {
      preview = document.createElement("div");
      preview.setAttribute("aria-hidden", "true");
      preview.classList.add("explorer-file-drag-preview");

      // Keep the useful identity of the row without dragging its full-width
      // layout, indentation spacer, selection state, or button behavior.
      const icon = handle.children.item(1)?.cloneNode(true);
      const label = handle.children.item(2)?.cloneNode(true);
      if (icon) preview.append(icon);
      if (label) preview.append(label);
      if (dragPaths.length > 1) {
        const count = document.createElement("span");
        count.textContent = ` (${dragPaths.length})`;
        preview.append(count);
      }

      document.body.append(preview);
      movePreview();
    };

    // One badge says whether releasing moves or copies and where; the folder row carries the mark
    // (inside, or blocked with the reason in the badge). Copy follows Ctrl/Cmd/Alt, as on release.
    const showTarget = (target: string) => {
      const verdict = operationRunning.current
        ? "busy"
        : transferVerdict(cwd, dragPaths, target, copyIntent);
      const folder = parentLabel(target);
      const label =
        verdict === "busy"
          ? t("Wait for the current file operation to finish")
          : verdict === "into-itself"
            ? t("Cannot drop a folder into itself")
            : verdict === "same-folder"
              ? t("Already in {p0}", { p0: folder })
              : copyIntent
                ? t("Copy to {p0}", { p0: folder })
                : t("Move to {p0}", { p0: folder });
      const blocked = verdict !== "ok";
      setDropFeedback(blocked ? "blocked" : "move", { clientX: lastX, clientY: lastY }, label);
      setDropIndicator(
        visibleRows().find((row) => rowPath(row) === target) ?? null,
        blocked ? "blocked" : "inside",
      );
      showingTarget = true;
      if (label !== announcedTarget) {
        announcedTarget = label;
        announceDrag(label);
      }
    };

    const hideTarget = () => {
      if (!showingTarget) return;
      showingTarget = false;
      announcedTarget = "";
      clearDropFeedback();
    };

    const release = () => {
      delete handle.dataset.explorerDragging;
      preview?.remove();
      preview = null;
      document.documentElement.classList.remove("is-explorer-file-dragging");
      if (restoreSelection) {
        restoreSelection();
        restoreSelection = undefined;
        setGrabbing(false);
      }
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    };

    const reset = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onCancel);
      release();
      if (active && attachmentPaths.length)
        emitExplorerFilePointerDrag({ type: "end", path: attachmentPaths[0] });
      setDragOverPath(null);
      fileDragCleanup.current = null;
    };

    const activate = () => {
      active = true;
      if (!selectedPaths.has(path)) onSelect(path);
      restoreSelection = suppressTextSelection();
      setGrabbing(true);
      createPreview();
      document.documentElement.classList.add("is-explorer-file-dragging");
      handle.dataset.explorerDragging = "true";
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* window listeners still track the gesture */
      }
    };

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active) {
        if (Math.hypot(lastX - startX, lastY - startY) < 5) return;
        activate();
      }
      moveEvent.preventDefault();
      movePreview();
      copyIntent = moveEvent.ctrlKey || moveEvent.metaKey || moveEvent.altKey;
      const target = internalDropTarget(lastX, lastY);
      if (target) showTarget(target);
      else {
        hideTarget();
        if (attachmentPaths.length)
          emitExplorerFilePointerDrag({
            type: "move",
            path: attachmentPaths[0],
            ...dragDetail,
            x: lastX,
            y: lastY,
          });
      }
    }

    function finish(commit: boolean, upEvent?: PointerEvent) {
      if (commit && upEvent) onMove(upEvent);
      if (active) {
        suppressFileClickUntil.current = performance.now() + 400;
        if (!commit) announceDrag(t("Drag cancelled"));
        if (commit) {
          const target = internalDropTarget(lastX, lastY);
          const copy = !!(upEvent?.ctrlKey || upEvent?.metaKey || upEvent?.altKey);
          if (target) {
            const verdict = transferVerdict(cwd, dragPaths, target, copy);
            void run(async () => {
              await transferPaths(dragPaths, target, copy);
              if (verdict === "ok")
                announceDrag(
                  copy
                    ? t("Copied to {p0}", { p0: parentLabel(target) })
                    : t("Moved to {p0}", { p0: parentLabel(target) }),
                );
            });
          } else if (attachmentPaths.length)
            emitExplorerFilePointerDrag({
              type: "drop",
              path: attachmentPaths[0],
              ...dragDetail,
              x: lastX,
              y: lastY,
            });
        }
      }
      reset();
    }

    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId === pointerId) finish(true, upEvent);
    }
    function onCancel() {
      finish(false);
    }
    function onKey(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        finish(false);
        return;
      }
      // Pressing or releasing the copy modifier switches the badge without moving the pointer.
      if (!active || !["Control", "Meta", "Alt"].includes(keyEvent.key)) return;
      copyIntent = keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey;
      const target = internalDropTarget(lastX, lastY);
      if (target) showTarget(target);
    }

    fileDragCleanup.current = onCancel;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onCancel);
  };

  const consumeFileClick = () => clickStillSuppressed(suppressFileClickUntil.current);

  useEffect(() => () => fileDragCleanup.current?.(), []);

  const {
    operationRunning,
    dropFilesRef,
    refreshAfterMutation,
    startCreate,
    startRename,
    onCreateCancel,
    onCreateCommit,
    onRenameCancel,
    onRenameCommit,
    removeEntries,
    transferPaths,
    pasteAt,
    run,
    openMenu,
    runAction,
  } = useFileTreeOperations({
    cwd,
    createUnavailable: Boolean(createUnavailableReason),
    activeRoot,
    expandedRef,
    selectedPath,
    selectedPathRef,
    selectionAnchor,
    creatingRef,
    clip,
    selectedPaths,
    hiddenSelectedPaths,
    commitExpanded,
    commitSelectedPath,
    onSelect,
    actionPaths,
    setClipboard,
    copyPathText,
    revealInFileManager,
    onOpenFile,
    onOpenTerminal,
    onFileMoved,
    onFileDeleted,
    setRefreshFailure,
    setSelectedPaths,
    setClip,
    setCreating,
    setRenaming,
    setMenu,
    setOperationPending,
    setEditPending,
    setOpError,
    setCopyNotice,
    setCopyFailedText,
  });

  const onItemContextMenu = (entry: { path: string; isDir: boolean }, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ path: entry.path, isDir: entry.isDir, isRoot: false }, e.clientX, e.clientY);
  };

  const onBackgroundMenu = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    e.preventDefault();
    openMenu({ path: cwd, isDir: true, isRoot: true }, e.clientX, e.clientY);
  };

  const visibleRows = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-explorer-root], [role='treeitem']") ??
        [],
    );

  // Toolbar and header menu share one create owner (startCreate) with the context menu and keyboard.
  const runHeaderAction = (id: string) => {
    if (id === "new-file" || id === "new-folder") {
      if (search) onCloseSearch?.();
      startCreate(id === "new-folder");
    } else if (id === "collapse") {
      if (search) onCloseSearch?.();
      collapseAll();
    }
  };
  // Collapse keeps the root, the selection and any open name editor (and its draft) in view.
  const collapseAll = () => {
    const keep = new Set([cwd]);
    const keepChain = (start: string) => {
      let current = start;
      while (current && current !== cwd && !keep.has(current)) {
        keep.add(current);
        const parent = parentPath(current);
        if (!parent || parent === current) break;
        current = parent;
      }
    };
    if (creating) keepChain(creating.parent);
    if (renaming) keepChain(parentPath(renaming));
    commitExpanded(keep);
  };
  // Creating is unavailable without a usable root and while any file operation or inline name commit is in flight.
  const createBlockedReason =
    createUnavailableReason ??
    (operationPending || editPending
      ? t("Wait for the current file operation to finish")
      : undefined);
  const createLabel = (label: string) =>
    createBlockedReason ? `${label} (${createBlockedReason})` : label;
  // Visible name of a folder in this tree: the root keeps its display identity (worktree/branch label).
  const parentLabel = (path: string) => (path === cwd ? name : basename(path));
  const headerRef = useRef<HTMLDivElement>(null);
  const [narrowHeader, setNarrowHeader] = useState(false);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setNarrowHeader(header.clientWidth > 0 && header.clientWidth < NARROW_HEADER_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const { onKeyDown } = useFileTreeKeyboard({
    cwd,
    rootRef,
    rootOpen,
    expanded,
    selectedPath,
    selectedPaths,
    selectionAnchorRef: selectionAnchor,
    operationRunning,
    toggle,
    onSelect,
    commitSelectedPath,
    actionPaths,
    visibleRows,
    openMenu,
    copyPathText,
    setClipboard,
    startRename,
    run,
    pasteAt,
    removeEntries,
    onOpenFile,
    setSelectedPath,
    setSelectedPaths,
    setClip,
  });

  useEffect(() => {
    if (!menu) return;
    const onScroll = () => setMenu(null);
    const scrollParent = rootRef.current?.closest(".overflow-y-auto") ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [menu]);

  useFileTreeExternalDrop({ cwd, rootRef, dropFilesRef, setDragOverPath, operationRunning });

  useFileTreePolling(cwd, visible);

  // A cached listing (first read or any later change to it) is adopted while rendering, so the
  // tree never paints a stale listing for a frame; only a cache miss needs the effect below.
  const [adoptedListing, setAdoptedListing] = useState(rootListing);
  if (rootListing !== adoptedListing) {
    setAdoptedListing(rootListing);
    if (rootListing) {
      setChildren(rootListing);
      setRootUpdatedAt(verifiedDirAt(cwd));
      setError(null);
    }
  }
  useEffect(() => {
    if (peekDir(cwd)) return;
    let cancelled = false;
    const request = rootRefreshRequest.current;
    void listCachedDir(cwd)
      .then((entries) => {
        if (!cancelled && request === rootRefreshRequest.current) {
          setChildren(entries);
          setRootUpdatedAt(Date.now());
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && request === rootRefreshRequest.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, rootListing]);

  const refreshRoot = () => {
    if (rootRefreshing) return;
    const request = ++rootRefreshRequest.current;
    const previous = children ?? peekDir(cwd);
    setRootRefreshing(true);
    setError(null);
    const root = refreshDir(cwd);
    // Expanded folders refresh with the root; their failures keep the last listing.
    const nested = refreshCachedDirs([cwd]).catch(() => []);
    void Promise.all([root, nested])
      .then(([entries]) => {
        if (request !== rootRefreshRequest.current) return;
        setChildren(entries);
        setError(null);
        setRootUpdatedAt(Date.now());
        announceDirListings();
      })
      .catch((err: unknown) => {
        if (request !== rootRefreshRequest.current) return;
        setChildren(previous);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (request === rootRefreshRequest.current) {
          setRootRefreshing(false);
        }
      });
  };

  const rootError = error ?? connectionFailure?.message;
  const rootDataState: RemoteDataState = {
    phase: rootRefreshing
      ? children === null
        ? "loading"
        : "refreshing"
      : rootError
        ? children === null
          ? "error"
          : "stale"
        : children === null
          ? "loading"
          : rootUpdatedAt === undefined
            ? "stale"
            : children.length
              ? "ready"
              : "empty",
    error: rootError,
    updatedAt: verifiedDirAt(cwd) ?? rootUpdatedAt,
  };

  const latestActions = useRef<TreeActions>(null as unknown as TreeActions);
  // Rebuilt every render, so the stable `actions` wrappers below always call the latest closures.
  useLayoutEffect(() => {
    latestActions.current = {
      onToggle: toggle,
      onSelect,
      onFilePointerDown,
      consumeFileClick,
      onOpenFile,
      onCreateCommit,
      onCreateCancel,
      onRenameCommit,
      onRenameCancel,
      onItemContextMenu,
    };
  });
  const actions = useMemo<TreeActions>(
    () => ({
      onToggle: (path) => latestActions.current.onToggle(path),
      onSelect: (path, modifiers) => latestActions.current.onSelect(path, modifiers),
      onFilePointerDown: (path, event) => latestActions.current.onFilePointerDown(path, event),
      consumeFileClick: () => latestActions.current.consumeFileClick(),
      onOpenFile: (...args) => latestActions.current.onOpenFile(...args),
      onCreateCommit: (id, raw) => latestActions.current.onCreateCommit(id, raw),
      onCreateCancel: (id) => latestActions.current.onCreateCancel(id),
      onRenameCommit: (path, raw) => latestActions.current.onRenameCommit(path, raw),
      onRenameCancel: () => latestActions.current.onRenameCancel(),
      onItemContextMenu: (entry, e) => latestActions.current.onItemContextMenu(entry, e),
    }),
    [],
  );
  const cutPaths = useMemo(
    () => new Set(clip?.mode === "cut" ? clip.entries.map((entry) => entry.path) : []),
    [clip],
  );
  const treeState = useMemo<TreeStateValue>(
    () => ({
      expanded,
      selectedPaths,
      creating,
      renaming,
      cutPaths,
      dragOverPath,
      showExcludedFiles,
      gitStatuses,
    }),
    [
      expanded,
      selectedPaths,
      creating,
      renaming,
      cutPaths,
      dragOverPath,
      showExcludedFiles,
      gitStatuses,
    ],
  );

  const [treeStore] = useState(() => createTreeStore(treeState));
  useLayoutEffect(() => treeStore.publish(treeState), [treeStore, treeState]);
  return (
    <TreeActionsCtx.Provider value={actions}>
      <TreeStateCtx.Provider value={treeStore}>
        <div
          ref={rootRef}
          data-external-drop-owner="file-tree"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onContextMenu={onBackgroundMenu}
          className="flex h-full min-h-0 flex-col outline-none"
        >
          <ActionHost
            ref={headerRef}
            selected={dragOverPath === cwd}
            className="@container/explorer-root min-h-[calc(var(--ui-control-height-compact)+0.5rem)] shrink-0 gap-0.5 rounded-none px-1"
          >
            <Button
              size="sm"
              variant="ghost"
              align="start"
              selected={dragOverPath === cwd}
              motion="none"
              type="button"
              data-explorer-root
              data-path={cwd}
              aria-expanded={rootOpen}
              tooltip={cwd}
              onClick={() => {
                onSelect(cwd);
                toggle(cwd);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu({ path: cwd, isDir: true, isRoot: true }, e.clientX, e.clientY);
              }}
              className="min-w-0 flex-1"
            >
              <span className="grid size-4 shrink-0 place-items-center text-[var(--ui-text-secondary)]">
                {rootOpen ? (
                  <ChevronDown className="icon-sm" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="icon-sm" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 truncate text-ui-caption font-medium text-[var(--ui-text-secondary)]">
                {name}
              </span>
            </Button>
            {/* Creation, then tree management, then view/search; narrow headers fold the last two into the menu. */}
            <InlineAction
              reveal="always"
              label={createLabel(t("New File"))}
              disabled={Boolean(createBlockedReason)}
              data-explorer-action="new-file"
              onClick={() => runHeaderAction("new-file")}
            >
              <FilePlus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
            <InlineAction
              reveal="always"
              label={createLabel(t("New Folder"))}
              disabled={Boolean(createBlockedReason)}
              data-explorer-action="new-folder"
              onClick={() => runHeaderAction("new-folder")}
            >
              <FolderPlus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
            {narrowHeader ? null : (
              <InlineAction
                reveal="always"
                label={t("Collapse All")}
                data-explorer-action="collapse"
                onClick={() => runHeaderAction("collapse")}
              >
                <FoldVertical className="icon-sm" strokeWidth={1.75} />
              </InlineAction>
            )}
            {onSearch && !narrowHeader ? (
              <InlineAction
                reveal="always"
                label={t("Search in files ({p0}Shift+F)", { p0: MOD })}
                aria-pressed={!!search}
                onClick={search ? onCloseSearch : onSearch}
              >
                <Search className="icon-sm" strokeWidth={1.75} />
              </InlineAction>
            ) : null}
            <InlineAction
              reveal="always"
              ref={headerMenuRef}
              label={t("Explorer actions")}
              aria-haspopup="menu"
              aria-expanded={headerMenu}
              selected={showExcludedFiles}
              onClick={() => setHeaderMenu((open) => !open)}
            >
              {showExcludedFiles ? (
                <ListFilter className="icon-sm" />
              ) : (
                <MoreHorizontal className="icon-sm" />
              )}
            </InlineAction>
            <ExplorerSyncStatus state={rootDataState} onRefresh={refreshRoot} />
          </ActionHost>
          {headerMenu ? (
            <DropdownMenu
              anchor={headerMenuRef}
              label={t("Explorer actions")}
              returnFocusRef={headerMenuRef}
              onClose={() => setHeaderMenu(false)}
              items={explorerHeaderItems(
                {
                  narrow: narrowHeader,
                  canSearch: !!onSearch,
                  busyReason: createBlockedReason,
                  showExcluded: showExcludedFiles,
                  excludedDefault: SHOW_EXCLUDED_FILES_DEFAULT,
                },
                (id) => {
                  const Icon = {
                    "new-file": FilePlus,
                    "new-folder": FolderPlus,
                    collapse: FoldVertical,
                    search: Search,
                    reveal: FolderOpen,
                  }[id];
                  return <Icon className="icon-sm" />;
                },
              )}
              onPick={(id) => {
                setHeaderMenu(false);
                if (id === "excluded" || id === "reset") {
                  saveShowExcludedFiles(
                    id === "reset" ? SHOW_EXCLUDED_FILES_DEFAULT : !showExcludedFiles,
                  );
                  return;
                }
                if (id === "search") {
                  onSearch?.();
                  return;
                }
                if (id === "reveal") void run(() => revealInFileManager(cwd));
                else runHeaderAction(id);
              }}
            />
          ) : null}
          {selectedPaths.size > 1 || hiddenSelectedPaths.length ? (
            <div
              role="status"
              data-explorer-selection-scope
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1 text-ui-caption text-(--ui-text-secondary)"
            >
              <span>
                {t("Selected")}: {selectedPaths.size}
              </span>
              {hiddenSelectedPaths.length ? (
                <span>
                  {t("Selection includes hidden items")}: {hiddenSelectedPaths.length}
                </span>
              ) : null}
            </div>
          ) : null}
          {copyNotice ? (
            <p role="status" className="px-2 py-1 text-ui-caption text-(--ui-text-secondary)">
              {copyNotice}
            </p>
          ) : null}
          {operationPending ? (
            <div
              role="status"
              className="flex items-center gap-2 px-3 py-1 text-ui-caption text-(--ui-text-secondary)"
            >
              <Spinner size="sm" />
              {t("Working…")}
            </div>
          ) : null}
          {opError ? (
            <Alert tone="danger" inline className="mx-2 my-1">
              {opError}
              {copyFailedText !== null ? (
                <Button variant="ghost" size="sm" onClick={() => void copyPathText(copyFailedText)}>
                  {t("Retry")}
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {refreshFailure?.cwd === cwd ? (
            <Alert tone="danger" inline className="mx-2 my-1">
              <span>
                {t("File change saved. Refresh failed.")} {refreshFailure.message}
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={operationPending}
                onClick={() => {
                  const failure = refreshFailure;
                  void run(() => refreshAfterMutation(failure.touched, failure.forget));
                }}
              >
                {t("Retry")}
              </Button>
            </Alert>
          ) : null}
          {search ?? (
            <div className="flex min-h-0 flex-1 flex-col outline-none">
              <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
                {connectionFailure ? (
                  <RemoteLoadError
                    cwd={cwd}
                    failure={connectionFailure}
                    stale={children !== null}
                    onRetry={refreshRoot}
                  />
                ) : null}
                {rootOpen ? (
                  <div
                    role="tree"
                    aria-multiselectable="true"
                    aria-label={t("{p0} files", { p0: name })}
                    className={connectionFailure ? "opacity-60" : undefined}
                  >
                    <TreeChildren
                      parent={cwd}
                      parentLabel={name}
                      depth={0}
                      entries={children}
                      loading={children === null && !rootError}
                      error={connectionFailure ? null : error}
                      onRetry={refreshRoot}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {menu ? (
          <ExplorerMenu
            x={menu.x}
            y={menu.y}
            items={gateBusyMenuItems(
              explorerItems(
                menu.target,
                clip,
                !!onOpenTerminal,
                canInspectGit,
                selectedPaths.size,
                actionPaths(menu.target.path).some((path) => !isDirAt(cwd, path)),
                parentLabel(menuCreateParent(menu.target)),
              ),
              operationPending || editPending,
              createBlockedReason,
            )}
            onPick={(id) => {
              const target = menu.target;
              setMenu(null);
              void runAction(id, target);
            }}
            onClose={() => setMenu(null)}
          />
        ) : null}
        {folderBrowser}
      </TreeStateCtx.Provider>
    </TreeActionsCtx.Provider>
  );
}

// Chat updates rerender the sidebar even when Files is hidden. Keep its tree
// intact unless file-tree props, local state, or subscriptions actually change.
// Keyed by root: switching folders remounts the inner tree, so every piece of
// per-root state (selection, expansion, menus, refs, timers) starts fresh.
export const FileTree = memo(function FileTree(props: Props) {
  return <FileTreeInner key={props.cwd} {...props} />;
});

/** Root freshness at the end of the project row: icon, time, refresh. */
function ExplorerSyncStatus({
  state,
  onRefresh,
}: {
  state: RemoteDataState;
  onRefresh: () => void;
}) {
  useLocale();
  const busy = state.phase === "loading" || state.phase === "refreshing";
  const warn = state.phase === "error" || state.phase === "stale";
  const time = state.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : undefined;
  const title = [
    state.updatedAt
      ? t("Last verified {p0}", {
          p0: new Date(state.updatedAt).toLocaleString(getLocale()),
        })
      : undefined,
    state.error,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      data-remote-data-state={state.phase}
      aria-live="polite"
      aria-busy={busy}
      role={state.phase === "error" ? "alert" : undefined}
      title={title || undefined}
      className="flex shrink-0 items-center gap-1 pr-1.5 text-ui-micro leading-none text-[var(--ui-text-muted)]"
    >
      {warn ? (
        <span className="inline-flex items-center gap-1">
          <CircleAlert aria-hidden className="icon-xs shrink-0 text-(--ui-tone-warning-fg)" />
          {time ? (
            <span className="hidden tabular-nums @min-[200px]/explorer-root:inline">{time}</span>
          ) : null}
        </span>
      ) : null}
      <InlineAction
        reveal="always"
        label={
          state.phase === "error"
            ? t("Retry loading {p0}", { p0: "files" })
            : t("Refresh {p0}", { p0: "files" })
        }
        motion="none"
        type="button"
        onClick={onRefresh}
        loading={busy}
      >
        {busy ? <Spinner size="sm" /> : <RefreshCw aria-hidden className="icon-sm" />}
      </InlineAction>
    </div>
  );
}

function TreeChildren({
  parent,
  parentLabel,
  depth,
  entries,
  loading,
  error,
  onRetry,
}: {
  parent: string;
  /** Visible name of `parent` (the root keeps its display identity), shown in the inline name field. */
  parentLabel: string;
  depth: number;
  entries: FsEntry[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  useLocale();
  const ctx = useTreeState(parent, entries);
  const actions = useTreeActions();
  const creating = ctx.creating;
  const show = creating?.parent === parent;
  const row =
    show && creating ? (
      <NameRow
        key={creating.id}
        depth={depth}
        isDir={creating.isDir}
        siblings={(entries ?? []).map((entry) => entry.name)}
        context={
          creating.isDir
            ? t("New folder in {p0}", { p0: parentLabel })
            : t("New file in {p0}", { p0: parentLabel })
        }
        onCommit={(raw) => actions.onCreateCommit(creating.id, raw)}
        onCancel={() => actions.onCreateCancel(creating.id)}
      />
    ) : null;
  const [limit, setLimit] = useState(TREE_WINDOW_CHUNK);
  const visible = useMemo(() => {
    return displayDirEntries(entries ?? null, ctx.showExcludedFiles);
  }, [entries, ctx.showExcludedFiles]);
  // Big folders render a first chunk (folders first, as below); selection,
  // rename and drag targets stay mounted even past the cut.
  const { shown, hidden } = windowEntries(visible, limit, [
    ...ctx.selectedPaths,
    ctx.renaming,
    ctx.dragOverPath,
  ]);
  const folders = shown.filter((e) => e.isDir);
  const files = shown.filter((e) => !e.isDir);
  const pad = { paddingLeft: 28 + depth * 12 };
  const renderNode = (child: FsEntry) => {
    const open = ctx.expanded.has(child.path);
    return (
      <TreeNode
        key={child.path}
        entry={child}
        depth={depth}
        open={open}
        selected={ctx.selectedPaths.has(child.path)}
        editing={ctx.renaming === child.path}
        cut={ctx.cutPaths.has(child.path)}
        dragOver={ctx.dragOverPath === child.path}
        gitStatus={gitStatusForPath(
          child.isDir ? ctx.gitStatuses?.dirs : ctx.gitStatuses?.files,
          child.path,
        )}
      />
    );
  };

  return (
    <>
      {error ? (
        <InlineError className="py-1 pr-2 break-words" style={pad} retry={{ onRetry }}>
          {error}
        </InlineError>
      ) : loading && entries === null ? (
        <LoadingText className="py-1 pr-2" style={pad}>
          {t("Loading…")}
        </LoadingText>
      ) : null}
      {!error && !loading && entries !== null && visible.length === 0 && !show ? (
        <p
          role="status"
          data-explorer-empty
          className="py-1 pr-2 text-ui-caption text-(--ui-text-muted)"
          style={pad}
        >
          {entries.length ? t("Only excluded files in this folder") : t("This folder is empty")}
          {entries.length ? (
            <Button variant="link" size="sm" onClick={() => saveShowExcludedFiles(true)}>
              {t("Show excluded files")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {show && ctx.creating?.isDir ? row : null}
      {folders.map(renderNode)}
      {show && ctx.creating && !ctx.creating.isDir ? row : null}
      {files.map(renderNode)}
      {hidden > 0 ? (
        <p className="flex gap-3 pr-2 text-ui-caption text-[var(--ui-text-secondary)]" style={pad}>
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            onClick={() => setLimit((n) => n + TREE_WINDOW_CHUNK)}
          >
            {t("Show {p0} more…", { p0: Math.min(TREE_WINDOW_CHUNK, hidden) })}
          </Button>
          {hidden > TREE_WINDOW_CHUNK ? (
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => setLimit(Number.POSITIVE_INFINITY)}
            >
              {t("Show all {p0}", { p0: hidden })}
            </Button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

const TreeNode = memo(function TreeNode({
  entry,
  depth,
  open,
  selected,
  editing,
  cut,
  dragOver,
  gitStatus,
}: {
  entry: FsEntry;
  depth: number;
  open: boolean;
  selected: boolean;
  editing: boolean;
  cut: boolean;
  dragOver: boolean;
  gitStatus: string | undefined;
}) {
  useLocale();
  const {
    onToggle,
    onSelect,
    onFilePointerDown,
    consumeFileClick,
    onOpenFile,
    onRenameCommit,
    onRenameCancel,
    onItemContextMenu,
  } = useTreeActions();
  const [loaded, setLoaded] = useState<FsEntry[] | null>(() =>
    entry.isDir ? peekDir(entry.path) : null,
  );
  // How the current read of this folder ended; null while it is still in flight (or not started).
  const [settled, setSettled] = useState<{ error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  // Only an open folder watches the cache, and only for its own listing: a
  // change elsewhere leaves this snapshot's identity (and this node) alone.
  const watching = entry.isDir && open;
  const cached = useSyncExternalStore(
    subscribeDirListings,
    () => (watching ? peekDir(entry.path) : null),
    () => (watching ? peekDir(entry.path) : null),
  );
  const children = cached ?? loaded;
  const loading = entry.isDir && open && !cached && settled === null;
  const loadError = settled?.error ?? null;
  const gitColor = gitStatus ? GIT_STATUS_COLOR[gitStatus] : undefined;
  const gitMark = gitStatus ? GIT_STATUS_MARK[gitStatus] : undefined;

  useEffect(() => {
    if (!entry.isDir || !open || cached) return;
    let cancelled = false;
    void listCachedDir(entry.path)
      .then((entries) => {
        if (!cancelled) {
          setLoaded(entries);
          setSettled({ error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSettled({ error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
      // The next read (reopen, retry, cache change) starts from "loading" with no old error.
      setSettled(null);
    };
  }, [entry.isDir, entry.path, open, cached, retry]);

  // A failed read leaves nothing cached for the refresh pass to revisit, so
  // the next tree refresh retries this folder.
  const failed = watching && loadError !== null;
  useEffect(() => {
    if (!failed) return;
    return subscribeDirListings(() => setRetry((n) => n + 1));
  }, [failed]);

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (consumeFileClick()) return;
    onSelect(entry.path, event);
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (entry.isDir) onToggle(entry.path);
    else onOpenFile(entry.path, undefined, { exact: true });
  };

  return (
    <div>
      {editing ? (
        <NameRow
          depth={depth}
          isDir={entry.isDir}
          initial={entry.name}
          selectStem={!entry.isDir}
          context={t("Rename {p0}", { p0: entry.name })}
          siblings={(peekDir(parentPath(entry.path)) ?? [])
            .map((child) => child.name)
            .filter((name) => name !== entry.name)}
          onCommit={(raw) => onRenameCommit(entry.path, raw)}
          onCancel={onRenameCancel}
        />
      ) : (
        <TreeRow
          depth={depth}
          cut={cut}
          dropTarget={dragOver}
          type="button"
          role="treeitem"
          title={entry.path}
          aria-selected={selected}
          aria-level={depth + 1}
          aria-expanded={entry.isDir ? open : undefined}
          onClick={onClick}
          onDoubleClick={(event) => {
            if (!entry.isDir && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              onOpenFile(entry.path, undefined, { exact: true, pin: true });
            }
          }}
          onPointerDown={(event) => {
            onFilePointerDown(entry.path, event);
          }}
          onContextMenu={(e) => onItemContextMenu(entry, e)}
        >
          <TreeRowToggle>
            {entry.isDir ? (
              open ? (
                <ChevronDown className="icon-sm" strokeWidth={1.75} />
              ) : (
                <ChevronRight className="icon-sm" strokeWidth={1.75} />
              )
            ) : null}
          </TreeRowToggle>
          <TreeRowIcon>
            <FileTypeIcon name={entry.name} isDir={entry.isDir} isOpen={open} />
          </TreeRowIcon>
          {/* Name stays at content weight; excluded entries recede, Git state lives in the end slot only. */}
          <TreeRowLabel
            className={entry.ignored ? "italic text-[var(--ui-text-secondary)]" : undefined}
          >
            {entry.name}
          </TreeRowLabel>
          {gitMark ? (
            <TreeRowTrailing>
              <span
                className={`font-medium ${gitColor ?? ""}`}
                title={entry.isDir ? t("Contains changes") : t(gitMark.label)}
              >
                {entry.isDir ? "•" : gitMark.mark}
              </span>
            </TreeRowTrailing>
          ) : null}
        </TreeRow>
      )}
      {entry.isDir && open ? (
        <TreeChildren
          parent={entry.path}
          parentLabel={entry.name}
          depth={depth + 1}
          entries={children}
          loading={loading}
          error={loadError}
          onRetry={() => setRetry((n) => n + 1)}
        />
      ) : null}
    </div>
  );
});

export function NameRow({
  depth,
  isDir,
  initial = "",
  selectStem = false,
  siblings,
  context,
  onCommit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initial?: string;
  selectStem?: boolean;
  siblings: string[];
  /** Short screen-reader description of what this field creates or renames, and where. */
  context?: string;
  onCommit: (raw: string) => Promise<void>;
  onCancel: () => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const contextId = useId();
  const issueId = useId();
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const issue = validateFileName(value, siblings);
  const leaf = leafName(value);
  const showIssue =
    submitError ||
    (issue &&
      (issue.severity === "warning" ||
        (issue.kind !== "empty" && value.length > 0) ||
        (issue.kind === "empty" && attempted)));
  const invalid = Boolean(submitError) || (Boolean(showIssue) && issue?.severity === "error");

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (!selectStem) return;
    const dot = initial.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initial, selectStem]);

  // The whole editor (field and its message) stays in view when it opens and when a message appears.
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [showIssue]);

  // A rejected commit returns to the same editable name with focus kept on it.
  useEffect(() => {
    if (submitError) inputRef.current?.focus({ preventScroll: true });
  }, [submitError]);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const current = validateFileName(value, siblings);
      if (current && current.severity === "error") {
        setAttempted(true);
        return;
      }
      finished.current = true;
      setBusy(true);
      setSubmitError(null);
      void onCommit(value).catch((err: unknown) => {
        finished.current = false;
        setBusy(false);
        setSubmitError(err instanceof Error ? err.message : String(err));
      });
      return;
    }
    finished.current = true;
    onCancel();
  };

  return (
    <div
      ref={rowRef}
      data-name-row={isDir ? "folder" : "file"}
      // No fill: a hover/selected tone would merge with a selected sibling; the field's own border marks the editor.
      className="scroll-my-1"
    >
      {/* Same grid as TreeRow: depth indent, toggle slot, icon slot, then the field. */}
      <div
        style={{ paddingInlineStart: `calc(8px + ${depth} * 12px)` }}
        className="flex h-[var(--ui-control-height-compact)] w-full min-w-0 items-center gap-2 pe-2"
      >
        <TreeRowToggle>
          {isDir ? <ChevronRight className="icon-sm" strokeWidth={1.75} /> : null}
        </TreeRowToggle>
        <TreeRowIcon>
          <FileTypeIcon name={leaf} isDir={isDir} />
        </TreeRowIcon>
        <TextField
          hideLabel
          label=""
          fieldVariant="compact"
          fieldClassName="min-w-0 flex-1"
          ref={inputRef}
          value={value}
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [context ? contextId : null, showIssue ? issueId : null].filter(Boolean).join(" ") ||
            undefined
          }
          placeholder={isDir ? t("Folder name") : t("File name")}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={t("Type file name. Press Enter to confirm or Escape to cancel.")}
          onChange={(e) => {
            setValue(e.target.value);
            setSubmitError(null);
          }}
          onKeyDown={(e) => {
            // Enter/Escape that drive an IME (candidate confirm/dismiss) belong to the IME. WebKit
            // reports the confirming keydown after compositionend, with keyCode 229 only. The
            // default action stays, and the key must not reach shortcuts or panes outside the field.
            if (isImeComposition(e.nativeEvent)) {
              e.stopPropagation();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(issue === null || issue.severity !== "error")}
          style={{ minHeight: "calc(var(--ui-control-height-compact) - 0.25rem)" }}
          className="min-w-0 flex-1 leading-none"
        />
        {busy ? <Spinner size="sm" className="shrink-0" /> : null}
        {context ? (
          <span id={contextId} className="sr-only">
            {context}
          </span>
        ) : null}
      </div>
      {showIssue ? (
        <NameIssueView id={issueId} depth={depth} issue={issue} fallback={submitError} />
      ) : context ? (
        <NameCaption depth={depth}>{context}</NameCaption>
      ) : null}
    </div>
  );
}

/** The message line starts under the field: depth indent + toggle slot + icon slot + their gaps. */
const nameFieldInset = (depth: number) =>
  `calc(8px + ${depth} * 12px + 2 * var(--ui-icon-md) + 1rem)`;

/** One quiet line saying what the field creates or renames and where (the screen-reader copy is separate). */
function NameCaption({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <p
      aria-hidden="true"
      data-name-caption
      className="min-w-0 truncate pe-2 pb-1 text-ui-caption leading-4 text-(--ui-text-muted)"
      style={{ paddingInlineStart: nameFieldInset(depth) }}
    >
      {children}
    </p>
  );
}

function NameIssueView({
  id,
  depth,
  issue,
  fallback,
}: {
  id: string;
  depth: number;
  issue: NameIssue | null;
  fallback: string | null;
}) {
  useLocale();
  let body: ReactNode = null;
  if (fallback) {
    body = fallback;
  } else if (issue) {
    switch (issue.kind) {
      case "empty":
        body = t("A file or folder name must be provided.");
        break;
      case "slash":
        body = t("A file or folder name cannot start with a slash.");
        break;
      case "exists":
        body = (
          <>
            {t("A file or folder ")}
            <span className="font-semibold">{issue.name}</span>{" "}
            {t("already exists at this location. Please choose a different name.")}
          </>
        );
        break;
      case "invalid":
        body = (
          <>
            {t("The name ")}
            <span className="font-semibold">{issue.name}</span>
            {t(" is not valid as a file or folder name. Please choose a different name.")}
          </>
        );
        break;
      case "whitespace":
        body = t("Leading or trailing whitespace detected in file or folder name.");
        break;
    }
  }
  if (!body) return null;
  const error = Boolean(fallback) || !issue || issue.severity === "error";
  return (
    <InlineMessage
      id={id}
      tone={error ? "danger" : "warning"}
      className="min-w-0 break-words pe-2 pb-1"
      style={{ paddingInlineStart: nameFieldInset(depth) }}
    >
      {body}
    </InlineMessage>
  );
}
