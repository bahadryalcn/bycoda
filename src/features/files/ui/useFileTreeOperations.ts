import type { CopyNotice } from "./MoveRecoveryNotice";
import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { wellFormedFileName } from "../model/fileName";
import {
  createParentOf,
  dirsTouchedByCreate,
  dirsTouchedByMove,
  forgetDir,
  refreshDir,
  announceDirListings,
} from "../model/fileTree";
import {
  basename,
  clipboardFilePaths,
  copyPath,
  createPath,
  deletePath,
  movePath,
  renamePath,
} from "../../../platform/tauri/fs";
import { displayPath, parentPath, rebasePath } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n/technical";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { requestGitFileInspect } from "../../source-control/public/GitFileInspector";
import type { OpenFileFn } from "../../search/model/search";
import { topLevelTreePaths, type TreeSelectionModifiers } from "../model/treeSelection";
import {
  isDirAt,
  type Clip,
  type Creating,
  type MenuState,
  type MenuTarget,
  type RefreshFailure,
} from "./fileTreeSupport";

type FileTreeOperationsOptions = {
  cwd: string;
  /** Creating is refused (no usable root or machine); the toolbar and menus already say why. */
  createUnavailable?: boolean;
  activeRoot: RefObject<string>;
  expandedRef: RefObject<Set<string>>;
  selectedPath: string | null;
  selectedPathRef: RefObject<string | null>;
  selectionAnchor: RefObject<string | null>;
  creatingRef: RefObject<Creating | null>;
  clip: Clip | null;
  selectedPaths: Set<string>;
  hiddenSelectedPaths: string[];
  commitExpanded: (next: Set<string>) => void;
  commitSelectedPath: (next: string | null) => void;
  onSelect: (path: string, modifiers?: TreeSelectionModifiers) => void;
  actionPaths: (path: string) => string[];
  setClipboard: (mode: "copy" | "cut", path: string) => void;
  copyPathText: (value: string) => Promise<void>;
  revealInFileManager: (path: string) => Promise<void>;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  setRefreshFailure: Dispatch<SetStateAction<RefreshFailure | null>>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  setClip: Dispatch<SetStateAction<Clip | null>>;
  setCreating: Dispatch<SetStateAction<Creating | null>>;
  setRenaming: Dispatch<SetStateAction<string | null>>;
  setMenu: Dispatch<SetStateAction<MenuState | null>>;
  setOperationPending: Dispatch<SetStateAction<boolean>>;
  setEditPending: Dispatch<SetStateAction<boolean>>;
  setOpError: Dispatch<SetStateAction<string | null>>;
  setCopyNotice: Dispatch<SetStateAction<CopyNotice | null>>;
  setCopyFailedText: Dispatch<SetStateAction<string | null>>;
};

/**
 * What a drop of `paths` onto the folder `destParent` would do: `into-itself` is refused (a folder
 * cannot land inside its own subtree), `same-folder` is a move that changes nothing, and `ok` runs.
 * `transferPaths` enforces the first rule; the drag indicator reads the same answer before release.
 */
export type TransferVerdict = "ok" | "into-itself" | "same-folder";

export function transferVerdict(
  cwd: string,
  paths: string[],
  destParent: string,
  copy: boolean,
): TransferVerdict {
  const targets = topLevelTreePaths(paths);
  if (
    targets.some(
      (path) => isDirAt(cwd, path) && (destParent === path || destParent.startsWith(`${path}/`)),
    )
  )
    return "into-itself";
  if (!copy && targets.length > 0 && targets.every((path) => parentPath(path) === destParent))
    return "same-folder";
  return "ok";
}

/** Explorer file mutations: create, rename, delete, copy/move/paste and menu actions. */
export function useFileTreeOperations({
  cwd,
  createUnavailable = false,
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
}: FileTreeOperationsOptions) {
  const expandDirs = (dirs: string[]) => {
    const next = new Set(expandedRef.current);
    for (const dir of dirs) next.add(dir);
    commitExpanded(next);
  };

  const refreshTouched = async (touched: string[], forget: string[] = []) => {
    for (const path of forget) forgetDir(path);
    await Promise.all([...new Set(touched)].map((path) => refreshDir(path)));
    announceDirListings();
  };

  const refreshAfterMutation = async (touched: string[], forget: string[] = []) => {
    try {
      await refreshTouched(touched, forget);
      if (activeRoot.current !== cwd) return;
      setRefreshFailure((current) => {
        if (!current || current.cwd !== cwd) return current;
        const remaining = current.touched.filter((path) => !touched.includes(path));
        return remaining.length ? { ...current, touched: remaining } : null;
      });
    } catch (error) {
      if (activeRoot.current !== cwd) return;
      setRefreshFailure((current) => ({
        cwd,
        touched: [...new Set([...(current?.cwd === cwd ? current.touched : []), ...touched])],
        forget: [...new Set([...(current?.cwd === cwd ? current.forget : []), ...forget])],
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const remapTreePaths = (from: string, to: string) => {
    const nextExpanded = new Set<string>();
    for (const path of expandedRef.current) nextExpanded.add(rebasePath(path, from, to));
    commitExpanded(nextExpanded);
    const prevSelected = selectedPathRef.current;
    commitSelectedPath(prevSelected ? rebasePath(prevSelected, from, to) : prevSelected);
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
    if (operationRunning.current || createUnavailable) return;
    const parent = createParentOf(cwd, atPath);
    // The same create is already open: keep its field (and typed name) instead of restarting it.
    const open = creatingRef.current;
    if (open && open.parent === parent && open.isDir === isDir) return;
    setRenaming(null);
    expandDirs([cwd, parent]);
    setCreating({ id: Date.now(), parent, isDir });
  };

  const startRename = (path: string) => {
    if (operationRunning.current) return;
    if (path === cwd) return;
    setCreating(null);
    setMenu(null);
    onSelect(path);
    setRenaming(path);
  };

  /**
   * Serializes an inline name commit with every other file operation. Failures reach the
   * caller (the name field stays editable); a second submit cannot start while one is running.
   */
  const commitInline = async (work: () => Promise<void>) => {
    if (operationRunning.current) {
      throw new Error(t("Wait for the current file operation to finish"));
    }
    operationRunning.current = true;
    setEditPending(true);
    setOpError(null);
    try {
      await work();
    } finally {
      operationRunning.current = false;
      setEditPending(false);
    }
  };

  const onCreateCancel = (id: number) => {
    setCreating((cur) => (cur?.id === id ? null : cur));
  };

  const onCreateCommit = (id: number, raw: string) =>
    commitInline(async () => {
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
    });

  const onRenameCancel = () => setRenaming(null);

  const onRenameCommit = (path: string, raw: string) =>
    commitInline(async () => {
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
    });

  const removeEntries = async (paths: string[]) => {
    const targets = topLevelTreePaths(paths.filter((path) => path !== cwd));
    if (!targets.length) return;
    const label = basename(targets[0]);
    const warning = hiddenSelectedPaths.length
      ? `${t("Selection includes hidden items")}:\n${targets.join("\n")}\n\n`
      : "";
    const multiple = targets.length > 1;
    const folder = !multiple && isDirAt(cwd, targets[0]);
    const effect = multiple
      ? t(
          "The selected files and folders are permanently deleted, including everything inside the folders. This can’t be undone.",
        )
      : folder
        ? t("“{p0}” and everything inside it are permanently deleted. This can’t be undone.", {
            p0: label,
          })
        : t("“{p0}” is permanently deleted. This can’t be undone.", { p0: label });
    const ok = await confirmInApp({
      title: multiple
        ? t("Delete {p0} items?", { p0: targets.length })
        : folder
          ? t("Delete folder?")
          : t("Delete file?"),
      message: warning + effect,
      confirmLabel: multiple ? t("Delete {p0} items", { p0: targets.length }) : t("Delete"),
      tone: "danger",
    });
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
      const currentSelected = selectedPathRef.current;
      if (!currentSelected || currentSelected === path || currentSelected.startsWith(`${path}/`)) {
        const parent = parentPath(path);
        selectionAnchor.current = parent;
        commitSelectedPath(parent);
      }
      onFileDeleted?.(path);
      await refreshAfterMutation([parentPath(path)], isDir ? [path] : []);
    }
  };

  const copyExternalFiles = async (paths: string[], destParent: string) => {
    let created: string | null = null;
    try {
      for (const from of paths) created = await copyPath(from, destParent);
    } finally {
      if (created) {
        await refreshAfterMutation([destParent]);
        expandDirs([destParent]);
        onSelect(created);
      }
    }
  };

  const transferPaths = async (paths: string[], destParent: string, copy: boolean) => {
    const targets = topLevelTreePaths(paths);
    if (transferVerdict(cwd, targets, destParent, copy) === "into-itself") {
      throw new Error("Cannot move or copy a folder into itself.");
    }
    const createdPaths: string[] = [];
    for (const from of targets) {
      if (!copy && parentPath(from) === destParent) continue;
      const isDir = isDirAt(cwd, from);
      const result = copy ? await copyPath(from, destParent) : await movePath(from, destParent);
      const created = typeof result === "string" ? result : result.path;
      if (typeof result !== "string")
        setCopyNotice({
          recoveryPath: result.recoveryPath,
          receiptPath: result.receiptPath,
          warning: result.warning,
        });
      createdPaths.push(created);
      if (!copy) {
        remapTreePaths(from, created);
        onFileMoved?.(from, created);
      }
      await refreshAfterMutation(
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
      const result =
        clip.mode === "cut"
          ? await movePath(entry.path, destParent)
          : await copyPath(entry.path, destParent);
      const created = typeof result === "string" ? result : result.path;
      if (typeof result !== "string")
        setCopyNotice({
          recoveryPath: result.recoveryPath,
          receiptPath: result.receiptPath,
          warning: result.warning,
        });
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
        await refreshAfterMutation(
          dirsTouchedByMove(entry.path, created),
          entry.isDir ? [entry.path] : [],
        );
      } else {
        await refreshAfterMutation([destParent]);
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
    await refreshAfterMutation([destParent]);
    onSelect(created);
    return created;
  };

  const operationRunning = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setOperationPending(true);
    setOpError(null);
    setCopyNotice(null);
    setCopyFailedText(null);
    try {
      await work();
    } catch (err: unknown) {
      if (activeRoot.current === cwd) setOpError(err instanceof Error ? err.message : String(err));
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
      commitSelectedPath(target.path);
    }
    setMenu({ x, y, target });
  };

  const runAction = async (id: string, target: MenuTarget) => {
    if (
      operationRunning.current &&
      [
        "new-file",
        "new-folder",
        "cut",
        "paste",
        "duplicate",
        "rename",
        "delete",
        "reveal",
      ].includes(id)
    )
      return;
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
        await copyPathText(
          (actionPaths(target.path).length ? actionPaths(target.path) : [target.path]).join("\n"),
        );
        return;
      case "copy-relative-path":
        await copyPathText(
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

  return {
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
  };
}
