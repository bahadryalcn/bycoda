import {
  useRef,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { basename } from "../../../platform/tauri/fs";
import { parentPath } from "../../../shared/lib/paths";
import type { OpenFileFn } from "../../search/model/search";
import type { TreeSelectionModifiers } from "../model/treeSelection";
import { isDirAt, type Clip, type MenuTarget } from "./fileTreeSupport";

/** Non-Latin layouts put the local letter in `key`, so fall back to the physical key. */
function shortcutLetter(e: ReactKeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key;
}

type FileTreeKeyboardOptions = {
  cwd: string;
  rootRef: RefObject<HTMLDivElement | null>;
  rootOpen: boolean;
  expanded: Set<string>;
  selectedPath: string | null;
  selectedPaths: Set<string>;
  selectionAnchor: RefObject<string | null>;
  operationRunning: RefObject<boolean>;
  toggle: (path: string) => void;
  onSelect: (path: string, modifiers?: TreeSelectionModifiers) => void;
  commitSelectedPath: (next: string | null) => void;
  actionPaths: (path: string) => string[];
  visibleRows: () => HTMLElement[];
  openMenu: (target: MenuTarget, x: number, y: number) => void;
  copyPathText: (value: string) => Promise<void>;
  setClipboard: (mode: "copy" | "cut", path: string) => void;
  startRename: (path: string) => void;
  run: (work: () => Promise<void>) => Promise<void>;
  pasteAt: (targetPath: string) => Promise<void>;
  removeEntries: (paths: string[]) => Promise<void>;
  onOpenFile: OpenFileFn;
  setSelectedPath: Dispatch<SetStateAction<string | null>>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  setClip: Dispatch<SetStateAction<Clip | null>>;
};

/** Explorer keyboard navigation, type-ahead and shortcut handling. */
export function useFileTreeKeyboard({
  cwd,
  rootRef,
  rootOpen,
  expanded,
  selectedPath,
  selectedPaths,
  selectionAnchor,
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
}: FileTreeKeyboardOptions) {
  const focusRow = (
    row: HTMLElement | undefined,
    modifiers: TreeSelectionModifiers = {},
    focusOnly = false,
  ) => {
    if (!row) return;
    if (focusOnly) {
      commitSelectedPath(row.title);
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
      void copyPathText((actionPaths(path).length ? actionPaths(path) : [path]).join("\n"));
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
      if (operationRunning.current) return;
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

  return { onKeyDown };
}
