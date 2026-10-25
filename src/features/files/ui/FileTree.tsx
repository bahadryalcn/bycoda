import { TextField } from "../../../shared/ui/TextField";
import { TreeRow } from "../../../shared/ui/TreeRow";
import { Button } from "../../../shared/ui/Button";
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
  Loader,
  RefreshCw,
  Search,
} from "../../../shared/ui/icons";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { leafName, validateFileName, wellFormedFileName, type NameIssue } from "../model/fileName";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { loadShowExcludedFiles, subscribeShowExcludedFiles } from "../../settings/model/appearance";
import {
  createParentOf,
  dirsTouchedByCreate,
  dirsTouchedByMove,
  forgetDir,
  listCachedDir,
  loadExpanded,
  loadSelected,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  verifiedDirAt,
  saveExpanded,
  saveSelected,
  announceDirListings,
  subscribeDirListings,
  subscribeDirsChanged,
  TREE_WINDOW_CHUNK,
  windowEntries,
  displayDirEntries,
} from "../model/fileTree";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { GIT_ACTIONS, useRemoteSupports } from "../../connections/model/remoteCapabilities";
import { remotePollDue, useRemoteLoadFailure } from "../../connections/model/remoteHealth";
import { RemoteLoadError } from "../../connections/ui/RemoteLoadError";
import type { RemoteDataState } from "../../connections/model/remoteDataState";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import {
  basename,
  clipboardFilePaths,
  copyPath,
  createPath,
  deletePath,
  movePath,
  renamePath,
  type FsEntry,
} from "../../../platform/tauri/fs";
import { displayPath, parentPath, rebasePath } from "../../../shared/lib/paths";
import { requestGitFileInspect } from "../../source-control/ui/GitFileInspector";
import { IS_MAC, IS_WIN, MOD, SHIFT } from "../../../platform/tauri/platform";
import type { OpenFileFn } from "../../search/model/search";
import type { GitStatusMap } from "../../source-control/hooks/useGitFileStatuses";
import {
  emitExplorerFilePointerDrag,
  setGrabbing,
  suppressTextSelection,
} from "../../../shared/lib/drag";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { useRemoteFolderBrowser } from "./useRemoteFolderBrowser";

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
  modified: "text-warning",
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

type Creating = { id: number; parent: string; isDir: boolean };
type Clip = {
  mode: "copy" | "cut";
  entries: { path: string; isDir: boolean }[];
  systemFiles: Promise<string[] | null>;
};
type MenuTarget = { path: string; isDir: boolean; isRoot: boolean };
type MenuState = { x: number; y: number; target: MenuTarget };

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

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

/** A directory observes only the state read by its immediate rows. */
function useTreeState(parent: string, entries: FsEntry[] | null): TreeStateValue {
  const store = useContext(TreeStateCtx);
  if (!store) throw new Error("TreeStateCtx missing");
  const snapshot = useMemo(() => {
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
            (isDir ? next.gitStatuses?.dirs.get(path) : next.gitStatuses?.files.get(path)) !==
              (isDir
                ? previous.gitStatuses?.dirs.get(path)
                : previous.gitStatuses?.files.get(path)),
        );
      if (changed) previous = next;
      return previous;
    };
  }, [store, parent, entries]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

function useTreeActions(): TreeActions {
  const ctx = useContext(TreeActionsCtx);
  if (!ctx) throw new Error("TreeActionsCtx missing");
  return ctx;
}

function isDirAt(cwd: string, path: string): boolean {
  if (path === cwd) return true;
  return (
    peekDir(parentPath(path))?.find((entry) => entry.path === path)?.isDir ?? peekDir(path) != null
  );
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
    el.select();
    document.execCommand("copy");
    el.remove();
  }
}

/** Non-Latin layouts put the local letter in `key`, so fall back to the physical key. */
function shortcutLetter(e: ReactKeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key;
}

function explorerItems(
  target: MenuTarget,
  clip: Clip | null,
  canOpenTerminal: boolean,
  canInspectGit: boolean,
  selectionCount: number,
  canOpenSelection: boolean,
): ExplorerMenuItem[] {
  const pasteParent = target.isDir ? target.path : parentPath(target.path);
  const pasteBlocked = clip?.entries.some(
    (entry) =>
      entry.isDir && (pasteParent === entry.path || pasteParent.startsWith(`${entry.path}/`)),
  );
  return [
    ...(selectionCount > 1 && canOpenSelection
      ? [{ kind: "item" as const, id: "open", label: t("Open"), shortcut: "Enter" }]
      : []),
    {
      kind: "item",
      id: "new-file",
      get label() {
        return t("New File");
      },
    },
    {
      kind: "item",
      id: "new-folder",
      get label() {
        return t("New Folder");
      },
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "cut",
      get label() {
        return t("Cut");
      },
      shortcut: `${MOD}X`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "copy",
      get label() {
        return t("Copy");
      },
      shortcut: `${MOD}C`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "paste",
      get label() {
        return t("Paste");
      },
      shortcut: `${MOD}V`,
      disabled: pasteBlocked,
    },
    {
      kind: "item",
      id: "duplicate",
      get label() {
        return t("Duplicate");
      },
      disabled: target.isRoot,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "copy-path",
      get label() {
        return t("Copy Path");
      },
      shortcut: `${MOD}${SHIFT}C`,
    },
    {
      kind: "item",
      id: "copy-relative-path",
      get label() {
        return t("Copy Relative Path");
      },
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "rename",
      get label() {
        return t("Rename");
      },
      shortcut: "F2",
      disabled: target.isRoot || selectionCount > 1,
    },
    {
      kind: "item",
      id: "delete",
      get label() {
        return t("Delete");
      },
      shortcut: "⌫",
      disabled: target.isRoot,
      danger: true,
    },
    { kind: "sep" },
    ...(canInspectGit && !target.isDir && selectionCount <= 1
      ? [
          {
            kind: "item" as const,
            id: "git-history",
            get label() {
              return t("File History");
            },
          },
          {
            kind: "item" as const,
            id: "git-blame",
            get label() {
              return t("Blame");
            },
          },
          { kind: "sep" as const },
        ]
      : []),
    ...(canOpenTerminal
      ? [
          {
            kind: "item" as const,
            id: "open-terminal",
            get label() {
              return t("Open in Terminal");
            },
          },
        ]
      : []),
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
  ];
}

// Chat updates rerender the sidebar even when Files is hidden. Keep its tree
// intact unless file-tree props, local state, or subscriptions actually change.
export const FileTree = memo(function FileTree({
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
  const [selectedPaths, setSelectedPaths] = useState(
    () => new Set(selectedPath ? [selectedPath] : []),
  );
  const selectionAnchor = useRef(selectedPath);
  const [children, setChildren] = useState<FsEntry[] | null>(() => peekDir(cwd));
  const [error, setError] = useState<string | null>(null);
  const [rootRefreshing, setRootRefreshing] = useState(false);
  const [rootUpdatedAt, setRootUpdatedAt] = useState<number>();
  const rootStatePath = useRef(cwd);
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
  const [refreshFailure, setRefreshFailure] = useState<{
    cwd: string;
    touched: string[];
    forget: string[];
    message: string;
  } | null>(null);
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
  creatingRef.current = creating;
  const fileDragCleanup = useRef<(() => void) | null>(null);
  const suppressFileClickUntil = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const name = rootLabel?.trim() || basename(cwd);
  const rootOpen = expanded.has(cwd);
  // File History and Blame need this computer or a host with `git.actions`.
  const canInspectGit = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const connectionFailure = useRemoteLoadFailure(cwd, "files");

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(cwd, next);
      return next;
    });
  };

  const onSelect = (path: string, modifiers: TreeSelectionModifiers = {}) => {
    const visible = modifiers.shiftKey
      ? visibleRows()
          .map((row) => row.title)
          .filter((value) => value !== cwd)
      : [];
    const anchor = selectionAnchor.current;
    setSelectedPaths((current) =>
      path === cwd ? new Set() : selectTreePaths(current, path, anchor, visible, modifiers),
    );
    if (!modifiers.shiftKey) selectionAnchor.current = path;
    setSelectedPath(path);
    saveSelected(cwd, path);
  };

  const actionPaths = (path: string) =>
    path === cwd
      ? []
      : selectedPaths.size
        ? [...selectedPaths].filter((value) => value !== cwd)
        : [path];

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
    return row ? createParentOf(cwd, row.title) : null;
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
      const target = internalDropTarget(lastX, lastY);
      setDragOverPath(target);
      if (!target && attachmentPaths.length)
        emitExplorerFilePointerDrag({
          type: "move",
          path: attachmentPaths[0],
          ...dragDetail,
          x: lastX,
          y: lastY,
        });
    }

    function finish(commit: boolean, upEvent?: PointerEvent) {
      if (commit && upEvent) onMove(upEvent);
      if (active) {
        suppressFileClickUntil.current = performance.now() + 400;
        if (commit) {
          const target = internalDropTarget(lastX, lastY);
          if (target)
            void run(() =>
              transferPaths(
                dragPaths,
                target,
                !!(upEvent?.ctrlKey || upEvent?.metaKey || upEvent?.altKey),
              ),
            );
          else if (attachmentPaths.length)
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
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finish(false);
    }

    fileDragCleanup.current = onCancel;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  };

  const consumeFileClick = () => performance.now() < suppressFileClickUntil.current;

  useEffect(() => () => fileDragCleanup.current?.(), []);

  const expandDirs = (dirs: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      saveExpanded(cwd, next);
      return next;
    });
  };

  const refreshTouched = async (touched: string[], forget: string[] = []) => {
    for (const path of forget) forgetDir(path);
    await Promise.all([...new Set(touched)].map((path) => refreshDir(path)));
    announceDirListings();
  };

  const refreshAfterMutation = async (touched: string[], forget: string[] = []) => {
    setRefreshFailure(null);
    try {
      await refreshTouched(touched, forget);
    } catch (error) {
      setRefreshFailure({
        cwd,
        touched,
        forget,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const remapTreePaths = (from: string, to: string) => {
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const path of prev) next.add(rebasePath(path, from, to));
      saveExpanded(cwd, next);
      return next;
    });
    setSelectedPath((prev) => {
      const next = prev ? rebasePath(prev, from, to) : prev;
      saveSelected(cwd, next);
      return next;
    });
    setSelectedPaths((current) => new Set([...current].map((path) => rebasePath(path, from, to))));
    if (selectionAnchor.current)
      selectionAnchor.current = rebasePath(selectionAnchor.current, from, to);
    setClip((cur) =>
      cur
        ? {
            ...cur,
            entries: cur.entries.map((entry) => ({
              ...entry,
              path: rebasePath(entry.path, from, to),
            })),
          }
        : cur,
    );
  };

  const startCreate = (isDir: boolean, atPath: string | null = selectedPath) => {
    const parent = createParentOf(cwd, atPath);
    setRenaming(null);
    expandDirs([cwd, parent]);
    setCreating({ id: Date.now(), parent, isDir });
  };

  const startRename = (path: string) => {
    if (path === cwd) return;
    setCreating(null);
    setMenu(null);
    onSelect(path);
    setRenaming(path);
  };

  const onCreateCancel = (id: number) => {
    setCreating((cur) => (cur?.id === id ? null : cur));
  };

  const onCreateCommit = async (id: number, raw: string) => {
    const session = creatingRef.current;
    if (!session || session.id !== id) return;
    const asFolder = session.isDir || /[/\\]$/.test(raw);
    const fileName = wellFormedFileName(raw);
    const created = await createPath(session.parent, fileName, asFolder);
    const touched = dirsTouchedByCreate(session.parent, fileName);
    setCreating((cur) => (cur?.id === id ? null : cur));
    expandDirs(touched);
    onSelect(created);
    if (!asFolder) onOpenFile(created, undefined, { exact: true });
    await refreshAfterMutation(touched);
  };

  const onRenameCancel = () => setRenaming(null);

  const onRenameCommit = async (path: string, raw: string) => {
    const fileName = wellFormedFileName(raw);
    if (!fileName || (fileName === basename(path) && !/[/\\]/.test(raw))) {
      setRenaming(null);
      return;
    }
    const next = await renamePath(path, fileName);
    const wasDir = isDirAt(cwd, path);
    const parent = parentPath(path);
    setRenaming(null);
    expandDirs(dirsTouchedByCreate(parent, fileName));
    remapTreePaths(path, next);
    onFileMoved?.(path, next);
    await refreshAfterMutation(
      [...dirsTouchedByCreate(parent, fileName), parent],
      wasDir ? [path] : [],
    );
  };

  const removeEntries = async (paths: string[]) => {
    const targets = topLevelTreePaths(paths.filter((path) => path !== cwd));
    if (!targets.length) return;
    const label = basename(targets[0]);
    const ok = window.confirm(
      targets.length > 1
        ? `Delete ${targets.length} selected files/folders? Selected folders and everything inside them will be deleted.`
        : isDirAt(cwd, targets[0])
          ? `Delete folder “${label}” and everything inside it?`
          : `Delete “${label}”?`,
    );
    if (!ok) return;
    for (const path of targets) {
      const isDir = isDirAt(cwd, path);
      await deletePath(path);
      setSelectedPaths(
        (current) =>
          new Set([...current].filter((value) => value !== path && !value.startsWith(`${path}/`))),
      );
      setClip((cur) => {
        if (!cur) return cur;
        const entries = cur.entries.filter(
          (entry) => entry.path !== path && !entry.path.startsWith(`${path}/`),
        );
        return entries.length ? { ...cur, entries } : null;
      });
      setSelectedPath((current) => {
        if (!current || current === path || current.startsWith(`${path}/`)) {
          const parent = parentPath(path);
          saveSelected(cwd, parent);
          selectionAnchor.current = parent;
          return parent;
        }
        return current;
      });
      onFileDeleted?.(path);
      await refreshTouched([parentPath(path)], isDir ? [path] : []);
    }
  };

  const copyExternalFiles = async (paths: string[], destParent: string) => {
    let created: string | null = null;
    try {
      for (const from of paths) created = await copyPath(from, destParent);
    } finally {
      if (created) {
        await refreshTouched([destParent]);
        expandDirs([destParent]);
        onSelect(created);
      }
    }
  };

  const transferPaths = async (paths: string[], destParent: string, copy: boolean) => {
    const targets = topLevelTreePaths(paths);
    if (
      targets.some(
        (path) => isDirAt(cwd, path) && (destParent === path || destParent.startsWith(`${path}/`)),
      )
    ) {
      throw new Error("Cannot move or copy a folder into itself.");
    }
    const createdPaths: string[] = [];
    for (const from of targets) {
      if (!copy && parentPath(from) === destParent) continue;
      const isDir = isDirAt(cwd, from);
      const created = copy ? await copyPath(from, destParent) : await movePath(from, destParent);
      createdPaths.push(created);
      if (!copy) {
        remapTreePaths(from, created);
        onFileMoved?.(from, created);
      }
      await refreshTouched(
        copy ? [destParent] : dirsTouchedByMove(from, created),
        !copy && isDir ? [from] : [],
      );
    }
    expandDirs([destParent]);
    if (createdPaths.length) {
      onSelect(createdPaths[createdPaths.length - 1]);
      setSelectedPaths(new Set(createdPaths));
    }
  };

  const pasteAt = async (targetPath: string) => {
    const destParent = createParentOf(cwd, targetPath);
    const baseline = clip ? await clip.systemFiles : null;
    const systemFiles = await clipboardFilePaths();
    if (!clip || baseline === null || JSON.stringify(baseline) !== JSON.stringify(systemFiles)) {
      setClip(null);
      await copyExternalFiles(systemFiles, destParent);
      return;
    }
    if (
      clip.entries.some(
        (entry) =>
          entry.isDir && (destParent === entry.path || destParent.startsWith(`${entry.path}/`)),
      )
    ) {
      throw new Error("Cannot paste a folder into itself.");
    }
    const createdPaths: string[] = [];
    for (const entry of clip.entries) {
      const created =
        clip.mode === "cut"
          ? await movePath(entry.path, destParent)
          : await copyPath(entry.path, destParent);
      createdPaths.push(created);
      if (clip.mode === "cut") {
        // Consume successful moves immediately so a retry cannot repeat them.
        setClip((current) => {
          if (!current) return current;
          const entries = current.entries.filter((value) => value.path !== entry.path);
          return entries.length ? { ...current, entries } : null;
        });
        remapTreePaths(entry.path, created);
        onFileMoved?.(entry.path, created);
        await refreshTouched(
          dirsTouchedByMove(entry.path, created),
          entry.isDir ? [entry.path] : [],
        );
      } else {
        await refreshTouched([destParent]);
      }
    }
    expandDirs([destParent]);
    if (createdPaths.length) {
      onSelect(createdPaths[createdPaths.length - 1]);
      setSelectedPaths(new Set(createdPaths));
    }
  };

  const duplicateAt = async (path: string) => {
    if (path === cwd) return;
    const destParent = parentPath(path);
    const created = await copyPath(path, destParent);
    await refreshTouched([destParent]);
    onSelect(created);
    return created;
  };

  const operationRunning = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setOperationPending(true);
    setOpError(null);
    try {
      await work();
    } catch (err: unknown) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      operationRunning.current = false;
      setOperationPending(false);
    }
  };

  const dropFiles = (paths: string[], targetPath: string) =>
    run(() => copyExternalFiles(paths, createParentOf(cwd, targetPath)));
  const dropFilesRef = useRef(dropFiles);
  dropFilesRef.current = dropFiles;

  const openMenu = (target: MenuTarget, x: number, y: number) => {
    setCreating(null);
    setRenaming(null);
    if (!selectedPaths.has(target.path)) onSelect(target.path);
    else {
      setSelectedPath(target.path);
      saveSelected(cwd, target.path);
    }
    setMenu({ x, y, target });
  };

  const runAction = async (id: string, target: MenuTarget) => {
    switch (id) {
      case "open":
        for (const path of actionPaths(target.path)) {
          if (!isDirAt(cwd, path)) onOpenFile(path, undefined, { exact: true, pin: true });
        }
        return;
      case "new-file":
        startCreate(false, target.path);
        return;
      case "new-folder":
        startCreate(true, target.path);
        return;
      case "cut":
        if (target.isRoot) return;
        setClipboard("cut", target.path);
        return;
      case "copy":
        if (target.isRoot) return;
        setClipboard("copy", target.path);
        return;
      case "paste":
        await run(() => pasteAt(target.path));
        return;
      case "duplicate":
        await run(async () => {
          const createdPaths: string[] = [];
          for (const path of topLevelTreePaths(actionPaths(target.path))) {
            const created = await duplicateAt(path);
            if (created) createdPaths.push(created);
          }
          if (createdPaths.length) setSelectedPaths(new Set(createdPaths));
        });
        return;
      case "copy-path":
        await copyText(
          (actionPaths(target.path).length ? actionPaths(target.path) : [target.path]).join("\n"),
        );
        return;
      case "copy-relative-path":
        await copyText(
          (actionPaths(target.path).length ? actionPaths(target.path) : [target.path])
            .map((path) => displayPath(path, cwd))
            .join("\n"),
        );
        return;
      case "rename":
        startRename(target.path);
        return;
      case "delete":
        await run(() => removeEntries(actionPaths(target.path)));
        return;
      case "reveal":
        await run(() => revealInFileManager(target.path));
        return;
      case "git-history":
      case "git-blame":
        requestGitFileInspect({
          kind: id === "git-history" ? "history" : "blame",
          cwd,
          relative: displayPath(target.path, cwd),
        });
        return;
      case "open-terminal":
        onOpenTerminal?.(target.isDir ? target.path : parentPath(target.path));
        return;
    }
  };

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

  const focusRow = (
    row: HTMLElement | undefined,
    modifiers: TreeSelectionModifiers = {},
    focusOnly = false,
  ) => {
    if (!row) return;
    if (focusOnly) {
      setSelectedPath(row.title);
      saveSelected(cwd, row.title);
    } else onSelect(row.title, modifiers);
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "nearest" });
  };

  const typeahead = useRef({ text: "", at: 0 });

  // VS Code-style list navigation. Rows are read from the DOM so the order
  // always matches what's rendered (folders first, excluded files hidden).
  const onNavigationKey = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    path: string,
    isDir: boolean,
  ): boolean => {
    if (
      e.altKey ||
      ((e.ctrlKey || e.metaKey) &&
        !["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key))
    ) {
      return false;
    }
    const rows = visibleRows();
    const index = rows.findIndex((row) => row.title === path);
    const open = path === cwd ? rootOpen : expanded.has(path);
    const pageSize = () => {
      const scroller = rootRef.current?.querySelector(".overflow-y-auto");
      const rowHeight = rows[rows.length - 1]?.offsetHeight || 30;
      return Math.max(1, Math.floor((scroller?.clientHeight ?? 0) / rowHeight) - 1);
    };
    const navigate = (row: HTMLElement | undefined) =>
      focusRow(
        e.shiftKey && row?.title === cwd ? rows.find((value) => value.title !== cwd) : row,
        e,
        (e.ctrlKey || e.metaKey) && !e.shiftKey,
      );
    const step = (delta: number) =>
      navigate(
        rows[
          index < 0
            ? delta > 0
              ? 0
              : rows.length - 1
            : Math.min(rows.length - 1, Math.max(0, index + delta))
        ],
      );
    const activate = (keepFocus: boolean) => {
      if (isDir && selectedPaths.size <= 1) {
        toggle(path);
        return;
      }
      const paths = actionPaths(path);
      for (const value of paths.length ? paths : [path]) {
        if (!isDirAt(cwd, value))
          onOpenFile(value, undefined, { exact: true, ...(paths.length > 1 ? { pin: true } : {}) });
      }
      if (keepFocus) {
        const row = rows[index];
        requestAnimationFrame(() => row?.focus({ preventScroll: true }));
      }
    };

    switch (e.key) {
      case "ArrowDown":
        // Cmd+Down opens, as in VS Code on macOS.
        if (e.metaKey && !e.shiftKey) activate(false);
        else step(1);
        return true;
      case "ArrowUp":
        step(-1);
        return true;
      case "PageDown":
        step(pageSize());
        return true;
      case "PageUp":
        step(-pageSize());
        return true;
      case "Home":
        navigate(rows[0]);
        return true;
      case "End":
        navigate(rows[rows.length - 1]);
        return true;
      case "ArrowRight":
        if (!isDir) return true;
        if (!open) toggle(path);
        else if (rows[index + 1] && parentPath(rows[index + 1].title) === path)
          focusRow(rows[index + 1]);
        return true;
      case "ArrowLeft":
        if (isDir && open) toggle(path);
        else if (path !== cwd) focusRow(rows.find((row) => row.title === parentPath(path)));
        return true;
      case "Enter":
        activate(false);
        return true;
      case " ":
        activate(true);
        return true;
    }

    // Type a name prefix to jump to the next matching row.
    if (e.metaKey || e.key.length !== 1 || e.key === " ") return false;
    const now = performance.now();
    const buffer = typeahead.current;
    buffer.text = now - buffer.at > 700 ? e.key : buffer.text + e.key;
    buffer.at = now;
    // Repeating one letter cycles through its matches instead of narrowing.
    const lower = buffer.text.toLowerCase();
    const cycling = [...lower].every((ch) => ch === lower[0]);
    const needle = cycling ? lower[0] : lower;
    const start = cycling ? index + 1 : Math.max(index, 0);
    const ordered = [...rows.slice(start), ...rows.slice(0, start)];
    const match = ordered.find(
      (row) => row.title !== cwd && basename(row.title).toLowerCase().startsWith(needle),
    );
    if (match) focusRow(match);
    return true;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input")) return;
    if (
      (e.target as HTMLElement).closest("button") &&
      !(e.target as HTMLElement).closest("[role='treeitem'], [data-explorer-root]")
    ) {
      return;
    }
    const path = selectedPath ?? cwd;
    const isRoot = path === cwd;
    const isDir = isDirAt(cwd, path);
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const row = visibleRows().find((value) => value.title === path);
      const bounds = row?.getBoundingClientRect();
      openMenu({ path, isDir, isRoot }, bounds?.left ?? 0, bounds?.bottom ?? 0);
      return;
    }
    if (onNavigationKey(e, path, isDir)) {
      e.preventDefault();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const key = shortcutLetter(e);
    if (mod && !e.altKey && !e.shiftKey && key === "a") {
      e.preventDefault();
      const paths = visibleRows()
        .map((row) => row.title)
        .filter((value) => value !== cwd);
      setSelectedPaths(new Set(paths));
      if (!selectedPath || selectedPath === cwd) {
        setSelectedPath(paths[0] ?? cwd);
        selectionAnchor.current = paths[0] ?? null;
      }
      return;
    }
    if (mod && !e.altKey && key === " ") {
      e.preventDefault();
      onSelect(path, { ctrlKey: true });
      return;
    }
    if (mod && !e.altKey && e.shiftKey && key === "c") {
      e.preventDefault();
      void copyText((actionPaths(path).length ? actionPaths(path) : [path]).join("\n"));
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "c") {
      if (isRoot) return;
      e.preventDefault();
      setClipboard("copy", path);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "x") {
      if (isRoot) return;
      e.preventDefault();
      setClipboard("cut", path);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "v") {
      e.preventDefault();
      void run(() => pasteAt(path));
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      if (selectedPaths.size <= 1) startRename(path);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void run(() => removeEntries(actionPaths(path)));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setClip(null);
      onSelect(path);
    }
  };

  useEffect(() => {
    if (!menu) return;
    const onScroll = () => setMenu(null);
    const scrollParent = rootRef.current?.closest(".overflow-y-auto") ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [menu]);

  useEffect(() => {
    const treePathAt = (x: number, y: number): string | null => {
      const root = rootRef.current;
      if (!root) return null;
      const point = dragPointToClient(x, y);
      const el = document.elementFromPoint(point.x, point.y);
      if (!el || !root.contains(el)) return null;
      return el.closest<HTMLElement>("[role='treeitem']")?.title ?? cwd;
    };

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragOverPath(null);
          return;
        }
        const { x, y } = event.payload.position;
        const target = treePathAt(x, y);
        if (event.payload.type !== "drop") {
          setDragOverPath(target ? createParentOf(cwd, target) : null);
          return;
        }
        setDragOverPath(null);
        if (target) void dropFilesRef.current(event.payload.paths, target);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [cwd]);

  useEffect(() => {
    const unsub = subscribeDirsChanged(() => undefined, cwd);
    const onResume = () => {
      if (!document.hidden) notifyDirsChanged(cwd, true, true);
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      unsub();
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [cwd]);

  const pollPaused = useRef(false);
  useEffect(() => {
    if (!visible) {
      pollPaused.current = true;
      return;
    }
    const remote = cwd.startsWith(REMOTE_PATH_PREFIX);
    // Local folders re-list only expanded directories, and only while the
    // window has focus and the tree is shown; returning to either refreshes.
    if (pollPaused.current && !remote) notifyDirsChanged(cwd, true);
    pollPaused.current = false;
    const timer = window.setInterval(
      () => {
        if (document.hidden) return;
        if (remote ? remotePollDue(cwd) : document.hasFocus()) notifyDirsChanged(cwd, true);
      },
      remote ? 5000 : 3000,
    );
    return () => window.clearInterval(timer);
  }, [cwd, visible]);

  useEffect(() => {
    const sameRoot = rootStatePath.current === cwd;
    rootStatePath.current = cwd;
    if (!sameRoot) {
      rootRefreshRequest.current++;
      const restored = loadSelected(cwd);
      setExpanded(loadExpanded(cwd));
      setSelectedPath(restored);
      setSelectedPaths(new Set(restored ? [restored] : []));
      selectionAnchor.current = restored;
      setClip(null);
      setMenu(null);
      setCreating(null);
      setRenaming(null);
      setRootRefreshing(false);
      setRootUpdatedAt(undefined);
      setError(null);
    }
    const hit = peekDir(cwd);
    if (hit) {
      setChildren(hit);
      setRootUpdatedAt(verifiedDirAt(cwd));
      setError(null);
      return;
    }
    let cancelled = false;
    const owner = cwd;
    const request = rootRefreshRequest.current;
    if (!sameRoot) {
      setChildren(null);
    }
    void listCachedDir(cwd)
      .then((entries) => {
        if (
          !cancelled &&
          request === rootRefreshRequest.current &&
          owner === rootStatePath.current
        ) {
          setChildren(entries);
          setRootUpdatedAt(Date.now());
        }
      })
      .catch((err: unknown) => {
        if (
          !cancelled &&
          request === rootRefreshRequest.current &&
          owner === rootStatePath.current
        ) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, rootListing]);

  const refreshRoot = () => {
    if (rootRefreshing) return;
    const owner = cwd;
    const request = ++rootRefreshRequest.current;
    const previous = children ?? peekDir(cwd);
    setRootRefreshing(true);
    setError(null);
    const root = refreshDir(cwd);
    // Expanded folders refresh with the root; their failures keep the last listing.
    const nested = refreshCachedDirs([cwd]).catch(() => []);
    void Promise.all([root, nested])
      .then(([entries]) => {
        if (request !== rootRefreshRequest.current || owner !== rootStatePath.current) return;
        setChildren(entries);
        setError(null);
        setRootUpdatedAt(Date.now());
        announceDirListings();
      })
      .catch((err: unknown) => {
        if (request !== rootRefreshRequest.current || owner !== rootStatePath.current) return;
        setChildren(previous);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (request === rootRefreshRequest.current && owner === rootStatePath.current) {
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
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex min-h-[calc(var(--ui-control-height-compact)+0.5rem)] shrink-0 items-center gap-0.5 overflow-visible border-b border-stroke px-2"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <HeaderIcon
              label={t("New File")}
              onClick={() => {
                if (search) onCloseSearch?.();
                startCreate(false);
              }}
            >
              <FilePlus className="size-3.5" strokeWidth={1.75} />
            </HeaderIcon>
            <HeaderIcon
              label={t("New Folder")}
              onClick={() => {
                if (search) onCloseSearch?.();
                startCreate(true);
              }}
            >
              <FolderPlus className="size-3.5" strokeWidth={1.75} />
            </HeaderIcon>
            <HeaderIcon
              label={REVEAL_LABEL}
              onClick={() => void run(() => revealInFileManager(cwd))}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.75} />
            </HeaderIcon>
            <HeaderIcon
              label={t("Collapse All")}
              onClick={() => {
                if (search) onCloseSearch?.();
                setCreating(null);
                setRenaming(null);
                const next = new Set([cwd]);
                saveExpanded(cwd, next);
                setExpanded(next);
              }}
            >
              <FoldVertical className="size-3.5" strokeWidth={1.75} />
            </HeaderIcon>
            {onSearch ? (
              <HeaderIcon
                className="ms-auto"
                label={t("Search in files ({p0}Shift+F)", { p0: MOD })}
                active={!!search}
                onClick={search ? onCloseSearch : onSearch}
              >
                <Search className="size-3.5" strokeWidth={1.75} />
              </HeaderIcon>
            ) : null}
          </div>
          {operationPending ? (
            <div
              role="status"
              className="flex items-center gap-2 px-3 py-1 text-ui-caption text-(--ui-text-secondary)"
            >
              <Loader className="size-3.5 animate-spin" aria-hidden />
              {t("Working…")}
            </div>
          ) : null}
          {search ?? (
            <div
              ref={rootRef}
              data-external-drop-owner="file-tree"
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col outline-none"
              onKeyDown={onKeyDown}
              onContextMenu={onBackgroundMenu}
            >
              <div className="@container/explorer-root flex min-h-[var(--ui-control-height-compact)] shrink-0 items-center">
                <Button
                  size="sm"
                  variant="tab"
                  selected={dragOverPath === cwd}
                  motion="none"
                  type="button"
                  data-explorer-root
                  aria-expanded={rootOpen}
                  title={cwd}
                  onClick={() => {
                    onSelect(cwd);
                    toggle(cwd);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMenu({ path: cwd, isDir: true, isRoot: true }, e.clientX, e.clientY);
                  }}
                  className={`  flex min-w-0 flex-1 items-center gap-1 h-full text-left focus-visible:-outline-offset-1  ${
                    dragOverPath === cwd ? "" : ""
                  }   `}
                >
                  <span className="grid size-4 shrink-0 place-items-center text-[var(--ui-text-secondary)]">
                    {rootOpen ? (
                      <ChevronDown className="size-3.5" strokeWidth={1.75} />
                    ) : (
                      <ChevronRight className="size-3.5" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="min-w-0 truncate text-ui-caption font-medium text-[var(--ui-text-secondary)]">
                    {name}
                  </span>
                </Button>
                <ExplorerSyncStatus state={rootDataState} onRefresh={refreshRoot} />
              </div>
              <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
                {opError ? (
                  <Alert tone="danger" inline className="mx-2 my-1">
                    {opError}
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
                      onClick={() =>
                        void refreshAfterMutation(refreshFailure.touched, refreshFailure.forget)
                      }
                    >
                      {t("Retry")}
                    </Button>
                  </Alert>
                ) : null}
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
            items={explorerItems(
              menu.target,
              clip,
              !!onOpenTerminal,
              canInspectGit,
              selectedPaths.size,
              actionPaths(menu.target.path).some((path) => !isDirAt(cwd, path)),
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
});

function HeaderIcon({
  label,
  onClick,
  active = false,
  className,
  children,
}: {
  className?: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      selected={active}
      variant="ghost"
      motion="none"
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid shrink-0 place-items-center self-center ${className ?? ""}`}
    >
      {children}
    </Button>
  );
}

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
        <span className="hidden items-center gap-1 @min-[140px]/explorer-root:inline-flex">
          <CircleAlert aria-hidden className="icon-xs shrink-0 text-warning" />
          {time ? (
            <span className="hidden tabular-nums @min-[200px]/explorer-root:inline">{time}</span>
          ) : null}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        motion="none"
        type="button"
        onClick={onRefresh}
        disabled={busy}
        aria-label={
          state.phase === "error"
            ? t("Retry loading {p0}", { p0: "files" })
            : t("Refresh {p0}", { p0: "files" })
        }
        title={t("Refresh")}
        className="grid size-6 shrink-0 place-items-center"
      >
        {busy ? (
          <Loader aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

function TreeChildren({
  parent,
  depth,
  entries,
  loading,
  error,
  onRetry,
}: {
  parent: string;
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
        gitStatus={
          child.isDir
            ? ctx.gitStatuses?.dirs.get(child.path)
            : ctx.gitStatuses?.files.get(child.path)
        }
      />
    );
  };

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 py-1 pr-2 text-[12px] leading-4 text-danger"
          style={pad}
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            className="shrink-0"
            onClick={onRetry}
          >
            {t("Retry")}
          </Button>
        </p>
      ) : loading && entries === null ? (
        <p className="py-1 pr-2 text-[12px] text-[var(--ui-text-muted)]" style={pad}>
          {t("Loading…")}
        </p>
      ) : null}
      {show && ctx.creating?.isDir ? row : null}
      {folders.map(renderNode)}
      {show && ctx.creating && !ctx.creating.isDir ? row : null}
      {files.map(renderNode)}
      {hidden > 0 ? (
        <p className="flex gap-3 pr-2 text-[12px] text-[var(--ui-text-secondary)]" style={pad}>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const gitColor = gitStatus ? GIT_STATUS_COLOR[gitStatus] : undefined;
  const gitMark = gitStatus ? GIT_STATUS_MARK[gitStatus] : undefined;

  useEffect(() => {
    if (!entry.isDir || !open || cached) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listCachedDir(entry.path)
      .then((entries) => {
        if (!cancelled) {
          setLoaded(entries);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
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
          <span className="grid size-4 shrink-0 place-items-center text-[var(--ui-text-secondary)]">
            {entry.isDir ? (
              open ? (
                <ChevronDown className="size-3.5" strokeWidth={1.75} />
              ) : (
                <ChevronRight className="size-3.5" strokeWidth={1.75} />
              )
            ) : null}
          </span>
          <span className="shrink-0">
            <FileTypeIcon name={entry.name} isDir={entry.isDir} isOpen={open} />
          </span>
          <span
            className={`min-w-0 truncate leading-label ${
              entry.ignored ? "italic text-[var(--ui-text-secondary)]" : (gitColor ?? "")
            }`}
          >
            {entry.name}
          </span>
          {gitMark ? (
            <span
              className={`ms-auto shrink-0 pe-1 text-ui-micro font-medium ${gitColor ?? ""}`}
              title={entry.isDir ? t("Contains changes") : t(gitMark.label)}
            >
              {entry.isDir ? "•" : gitMark.mark}
            </span>
          ) : null}
        </TreeRow>
      )}
      {entry.isDir && open ? (
        <TreeChildren
          parent={entry.path}
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
  onCommit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initial?: string;
  selectStem?: boolean;
  siblings: string[];
  onCommit: (raw: string) => Promise<void>;
  onCancel: () => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const issue = validateFileName(value, siblings);
  const leaf = leafName(value);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: "nearest" });
    if (!selectStem) return;
    const dot = initial.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initial, selectStem]);

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

  const showIssue =
    submitError ||
    (issue &&
      (issue.severity === "warning" ||
        (issue.kind !== "empty" && value.length > 0) ||
        (issue.kind === "empty" && attempted)));

  return (
    <div>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="flex h-[var(--ui-control-height-compact)] w-full items-center gap-1 bg-[var(--ui-surface-muted)] pr-2"
      >
        <span className="grid size-4 shrink-0 place-items-center text-[var(--ui-text-secondary)]">
          {isDir ? <ChevronRight className="size-3.5" strokeWidth={1.75} /> : null}
        </span>
        <span className="shrink-0">
          <FileTypeIcon name={leaf} isDir={isDir} />
        </span>
        <TextField
          hideLabel
          label=""
          fieldClassName="min-w-0 flex-1"
          ref={inputRef}
          value={value}
          disabled={busy}
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
            if (e.nativeEvent.isComposing) return;
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
          className="h-5 min-w-0 flex-1 leading-none"
        />
      </div>
      {showIssue ? <NameIssueView depth={depth} issue={issue} fallback={submitError} /> : null}
    </div>
  );
}

function NameIssueView({
  depth,
  issue,
  fallback,
}: {
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
        body = "A file or folder name must be provided.";
        break;
      case "slash":
        body = "A file or folder name cannot start with a slash.";
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
        body = "Leading or trailing whitespace detected in file or folder name.";
        break;
    }
  }
  if (!body) return null;
  const error = Boolean(fallback) || !issue || issue.severity === "error";
  return (
    <p
      className={`pr-2 pb-1 text-[12px] leading-4 ${error ? "text-danger" : "text-warning"}`}
      style={{ paddingLeft: 28 + depth * 12 }}
    >
      {body}
    </p>
  );
}
