import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { ChevronDown, ChevronRight, Minus, Plus } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n/git";
import { collator } from "../../../shared/lib/intl";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { selectTreePaths, type TreeSelectionModifiers } from "../../files/public/treeSelection";

import type { ChangesView } from "../../settings";
import { basename, type GitChangedFile, type GitFileDiffKind } from "../../../platform/tauri/fs";
import { ChangeRow, ChangeSelectionCtx, statusColor } from "./ChangeRow";

const ROW_HEIGHT_FALLBACK = 28;

/** The compact control height in px for the current density (a probe resolves rem and zoom). */
function readRowHeight(list: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;block-size:var(--ui-control-height-compact)";
  list.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height > 0 ? height : ROW_HEIGHT_FALLBACK;
}

/** Folders the user collapsed in tree view, keyed `<kind>:<dir>`. */
const collapsedDirs = new Set<string>();

type ChangeDir = {
  name: string;
  /** Path relative to the repo root; "" for the implicit root. */
  path: string;
  dirs: ChangeDir[];
  files: GitChangedFile[];
  /** Status shared by every descendant, or null when they differ. */
  status: string | null;
};

type ChangeRowProps = {
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  files: GitChangedFile[];
  collisionNames?: ReadonlySet<string>;
  view: ChangesView;
  kind: GitFileDiffKind;
  selected?: string;
  selectedKind?: GitFileDiffKind;
  busy: string | null;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
  onSelectionAction?: (
    files: GitChangedFile[],
    action: "stage" | "unstage" | "discard",
  ) => void | Promise<void>;
  onFolderAction: (relative: string, action: "stage" | "unstage") => void;
};

export function ChangeList({ files, view, ...rest }: ChangeRowProps) {
  useLocale();
  const [collapsedVersion, setCollapsedVersion] = useState(0);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const tree = useMemo(() => buildChangeTree(files), [files]);
  const listRef = useRef<HTMLUListElement>(null);
  const openFile = useStableCallback(rest.onOpenFile);
  const openEditor = useStableCallback(rest.onOpenInEditor);
  const fileAction = useStableCallback(rest.onAction);

  // Raw selection as the user left it; paths of files that left the list are
  // dropped when read (`paths`) and from the stored set on the next change.
  const [rawPaths, setRawPaths] = useState(() => new Set<string>());
  const anchor = useRef<string | null>(null);
  const visibleRows = useMemo(() => {
    const result: Array<{ file?: GitChangedFile; dir?: ChangeDir; depth?: number }> = [];
    const visit = (dir: ChangeDir, depth: number) => {
      for (const child of dir.dirs) {
        result.push({ dir: child, depth });
        if (!collapsedDirs.has(`${rest.kind}:${child.path}`)) visit(child, depth + 1);
      }
      for (const file of dir.files) result.push({ file, depth });
    };
    if (view === "tree") visit(tree, 0);
    else for (const file of files) result.push({ file });
    return result;
  }, [files, tree, view, rest.kind, collapsedVersion]);
  const visiblePaths = useMemo(
    () => visibleRows.flatMap((row) => (row.file ? [row.file.path] : [])),
    [visibleRows],
  );
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const prunePaths = (current: Set<string>) =>
    [...current].every((path) => filesByPath.has(path))
      ? current
      : new Set([...current].filter((path) => filesByPath.has(path)));
  const paths = useMemo(() => prunePaths(rawPaths), [rawPaths, filesByPath]);
  const positions = useMemo(
    () => new Map(visiblePaths.map((path, index) => [path, index + 1])),
    [visiblePaths],
  );
  const focusedIndex = visibleRows.findIndex((row) => row.file?.path === focusedPath);
  // Rows are one compact control tall: follow the density token instead of a fixed 28px.
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_FALLBACK);
  const virtual = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    getItemKey: (index) => visibleRows[index].file?.path ?? `dir:${visibleRows[index].dir!.path}`,
    enabled: visibleRows.length > 80 && !!scrollElement,
    overscan: 8,
    scrollMargin,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
      return indexes.sort((a, b) => a - b);
    },
  });
  const virtualized = visibleRows.length > 80;
  useLayoutEffect(() => {
    virtual.measure();
  }, [rowHeight]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let parent = list.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    setScrollElement(parent);
    const measure = () => {
      setRowHeight((previous) => {
        const next = readRowHeight(list);
        return Math.abs(previous - next) < 0.5 ? previous : next;
      });
      if (!parent) return;
      const margin =
        list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
      setScrollMargin((previous) => (Math.abs(previous - margin) < 0.5 ? previous : margin));
    };
    measure();
    // Preceding sections and container resizes can move the list without a
    // React render. Observe their sizes instead of forcing layout every render.
    const observer = new ResizeObserver(measure);
    for (let element: HTMLElement | null = list; element; element = element.parentElement) {
      observer.observe(element);
      const owner: HTMLElement | null = element.parentElement;
      if (owner)
        for (const sibling of owner.children)
          if (sibling instanceof HTMLElement && sibling !== element) observer.observe(sibling);
      if (element === parent) break;
    }
    return () => observer.disconnect();
  }, [view, rest.kind, virtualized]);
  const toggleDir = useStableCallback((path: string) => {
    const key = `${rest.kind}:${path}`;
    if (collapsedDirs.has(key)) collapsedDirs.delete(key);
    else collapsedDirs.add(key);
    setCollapsedVersion((value) => value + 1);
  });
  const focusPath = (path: string) => {
    setFocusedPath(path);
    const index = visibleRows.findIndex((row) => row.file?.path === path);
    if (virtualized) virtual.scrollToIndex(index, { align: "auto" });
    const focus = () =>
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-git-file="${CSS.escape(path)}"]`)
        ?.focus({ preventScroll: true });
    const mounted = listRef.current?.querySelector(`[data-git-file="${CSS.escape(path)}"]`);
    if (mounted) focus();
    else requestAnimationFrame(focus);
  };

  // An anchor whose file left the list no longer anchors a range.
  const liveAnchor = () =>
    anchor.current && filesByPath.has(anchor.current) ? anchor.current : null;
  const select = useStableCallback(
    (path: string, modifiers: TreeSelectionModifiers = {}, preserve = false) => {
      setFocusedPath(path);
      if (preserve && paths.has(path)) return;
      const previousAnchor = liveAnchor();
      anchor.current = previousAnchor;
      const visible = modifiers.shiftKey ? visiblePaths : [];
      setRawPaths((current) =>
        selectTreePaths(prunePaths(current), path, previousAnchor, visible, modifiers),
      );
      if (!modifiers.shiftKey) anchor.current = path;
    },
  );
  const selectedFiles = useMemo(() => files.filter((file) => paths.has(file.path)), [files, paths]);
  const targets = useStableCallback((file: GitChangedFile) =>
    paths.has(file.path) ? selectedFiles : [file],
  );
  const action = useStableCallback(
    (file: GitChangedFile, kind: "stage" | "unstage" | "discard") => {
      const chosen = targets(file);
      if (rest.onSelectionAction) void rest.onSelectionAction(chosen, kind);
      else for (const target of chosen) rest.onAction(target, kind);
    },
  );
  const renderRow = (index: number, style?: CSSProperties) => {
    const row = visibleRows[index];
    return row.file ? (
      <ChangeRow
        key={`${rest.kind}:${row.file.path}`}
        file={row.file}
        collision={rest.collisionNames?.has(basename(row.file.relative))}
        active={isActive(row.file, rest.selected, rest.selectedKind, rest.kind)}
        busy={rest.busy === row.file.relative || !!rest.busy?.startsWith("folder:")}
        kind={rest.kind}
        depth={row.depth}
        style={style}
        position={positions.get(row.file.path)}
        total={visiblePaths.length}
        onOpenFile={openFile}
        onOpenInEditor={rest.onOpenInEditor ? openEditor : undefined}
        onAction={fileAction}
      />
    ) : (
      <ChangeDirRow
        key={`dir:${row.dir!.path}`}
        dir={row.dir!}
        depth={row.depth!}
        {...rest}
        style={style}
        open={!collapsedDirs.has(`${rest.kind}:${row.dir!.path}`)}
        onToggle={toggleDir}
      />
    );
  };
  const content = virtualized
    ? virtual.getVirtualItems().map((item) =>
        renderRow(item.index, {
          position: "absolute",
          insetBlockStart: 0,
          insetInlineStart: 0,
          width: "100%",
          height: rowHeight,
          transform: `translateY(${item.start - scrollMargin}px)`,
        }),
      )
    : visibleRows.map((_, index) => renderRow(index));
  const context = useMemo(
    () => ({ paths, select, targets, action }),
    [paths, select, targets, action],
  );
  return (
    <ChangeSelectionCtx.Provider value={context}>
      <li className="list-none">
        {selectedFiles.length > 1 ? (
          <p role="status" className="px-3 py-1 text-ui-caption text-(--ui-text-secondary)">
            {t("{p0} selected entries", { p0: selectedFiles.length })}
          </p>
        ) : null}
        <ul
          ref={listRef}
          style={virtualized ? { position: "relative", height: virtual.getTotalSize() } : undefined}
          onFocusCapture={(event) => {
            const path = (event.target as HTMLElement).closest<HTMLElement>("[data-git-file]")
              ?.dataset.gitFile;
            if (path) setFocusedPath(path);
          }}
          role="listbox"
          aria-label={rest.kind === "staged" ? t("Staged Changes") : t("Changes")}
          aria-multiselectable="true"
          onKeyDown={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-git-file]");
            if (!row) return;
            const visible = visiblePaths;
            const mod = event.ctrlKey || event.metaKey;
            if (mod && !event.altKey && event.key.toLowerCase() === "a") {
              event.preventDefault();
              event.stopPropagation();
              setRawPaths(new Set(visible));
              anchor.current = liveAnchor() ?? row.dataset.gitFile!;
            } else if (mod && event.key === " ") {
              event.preventDefault();
              select(row.dataset.gitFile!, { ctrlKey: true });
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              const index = visible.indexOf(focusedPath ?? row.dataset.gitFile!);
              const next =
                event.key === "Home"
                  ? visible[0]
                  : event.key === "End"
                    ? visible[visible.length - 1]
                    : visible[
                        Math.min(
                          visible.length - 1,
                          Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
                        )
                      ];
              if (next) {
                if (!mod || event.shiftKey) select(next, event);
                focusPath(next);
                if (!mod && !event.shiftKey) {
                  const file = filesByPath.get(next);
                  if (file && file.status !== "deleted") rest.onOpenFile(file.path, rest.kind);
                }
              }
            } else if (event.key === "Escape") {
              setRawPaths(new Set([row.dataset.gitFile!]));
              anchor.current = row.dataset.gitFile!;
            } else if (event.key === "Enter") {
              event.preventDefault();
              const file = filesByPath.get(row.dataset.gitFile!);
              if (file)
                for (const value of targets(file)) rest.onOpenFile(value.path, rest.kind, true);
            }
          }}
        >
          {content}
        </ul>
      </li>
    </ChangeSelectionCtx.Provider>
  );
}

function ChangeDirRow({
  dir,
  depth,
  kind,
  open,
  onToggle,
  style,
  ...rest
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
  open: boolean;
  onToggle: (path: string) => void;
  style?: CSSProperties;
}) {
  useLocale();
  return (
    <li style={style}>
      <ActionHost
        style={{ "--git-row-depth": depth } as CSSProperties}
        className="flex h-(--ui-control-height-compact) w-full items-center gap-1 pr-2 pl-[calc(0.5rem+var(--git-row-depth)*0.75rem)] leading-none text-content"
      >
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          tooltip={dir.path}
          aria-expanded={open}
          onClick={() => onToggle(dir.path)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="grid size-4 shrink-0 place-items-center text-[var(--ui-text-secondary)]">
            {open ? (
              <ChevronDown className="icon-sm" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="icon-sm" strokeWidth={1.75} />
            )}
          </span>
          <FileTypeIcon name={dir.name} isDir isOpen={open} />
          <MiddleTruncate mode="path" className="min-w-0 flex-1 text-ui-body font-medium">
            {dir.name}
          </MiddleTruncate>
        </Button>
        <div className="flex shrink-0 items-center">
          <InlineAction
            label={t(kind === "staged" ? "Unstage Changes in {p1}" : "Stage Changes in {p1}", {
              p1: dir.path,
            })}
            disabled={rest.busy !== null}
            onClick={() => rest.onFolderAction(dir.path, kind === "staged" ? "unstage" : "stage")}
          >
            {kind === "staged" ? (
              <Minus className="icon-sm" strokeWidth={1.75} />
            ) : (
              <Plus className="icon-sm" strokeWidth={1.75} />
            )}
          </InlineAction>
        </div>
        <span
          className={`grid w-3.5 shrink-0 place-items-center ${
            dir.status ? statusColor(dir.status) : "text-[var(--ui-text-muted)]"
          }`}
          aria-hidden
        >
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      </ActionHost>
    </li>
  );
}

function isActive(
  file: GitChangedFile,
  selected: string | undefined,
  selectedKind: GitFileDiffKind | undefined,
  kind: GitFileDiffKind,
): boolean {
  return selected === file.relative && (!selectedKind || selectedKind === kind);
}

/** Nests changed files under their directories, VS Code's tree view. */
const changeCollator = collator();

function buildChangeTree(files: GitChangedFile[]): ChangeDir {
  const root: ChangeDir = {
    name: "",
    path: "",
    dirs: [],
    files: [],
    status: null,
  };
  const directories = new Map<string, ChangeDir>();
  for (const file of files) {
    const segments = file.relative.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let next = directories.get(path);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [], status: null };
        node.dirs.push(next);
        directories.set(path, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  sortChangeDir(root);
  return root;
}

/** Sorts each level (folders first) and rolls descendant status upward. */
function sortChangeDir(dir: ChangeDir): string | null {
  dir.dirs.sort((a, b) => changeCollator.compare(a.name, b.name));
  dir.files.sort((a, b) => changeCollator.compare(basename(a.relative), basename(b.relative)));
  let status: string | null = null;
  let mixed = false;
  const merge = (next: string | null) => {
    if (next === null) mixed = true;
    else if (status === null) status = next;
    else if (status !== next) mixed = true;
  };
  for (const child of dir.dirs) merge(sortChangeDir(child));
  for (const file of dir.files) merge(file.status);
  dir.status = mixed ? null : status;
  return dir.status;
}
