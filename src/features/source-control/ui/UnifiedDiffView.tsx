import "./UnifiedDiffView.css";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t, useLocale } from "../../../shared/i18n/git";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FoldVertical,
  MessageSquarePlus,
  Undo2,
  UnfoldVertical,
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
  type CSSProperties,
} from "react";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { formatInteger } from "../../../shared/lib/numbers";
import type { ColorScheme } from "../../settings/model/appearance";
import { basename } from "../../../platform/tauri/fs";
import { highlightDiffFile, type SyntaxToken } from "../../files/editor/syntaxTokens";
import {
  codeZoomOffset,
  codeZoomScale,
  subscribeCodeZoom,
  zoomCodeByWheel,
} from "../../files/editor/editorZoom";
import { anchoredScroll } from "../../files/ui/documentZoom";
import { DiffCommentComposer } from "./DiffCommentComposer";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import {
  DiffOverviewContext,
  DiffOverviewRegistry,
  DiffOverviewRuler,
  useDiffOverviewSource,
} from "./DiffOverviewRuler";
import { DiffLayoutToggle, useDiffLayout } from "./DiffLayoutToggle";
import type { DiffLayout } from "../../settings/model/settings";
import { splitRowMarks, unifiedRowMarks } from "../model/diffOverview";
import { buildSplitRows, type SplitRow } from "../model/splitRows";
import {
  expandFold,
  type FoldReveal,
  type UnifiedBlock,
  type UnifiedLine,
} from "../model/unifiedDiff";
import {
  diffRowMetrics,
  flattenVisibleRows,
  layoutRows,
  UNIFIED_OVERSCAN_PX,
  windowRows,
  type DiffRowMetrics,
  type DiffViewRow,
  type RowWindow,
  type SizedRow,
} from "../model/unifiedDiffWindow";

export type UnifiedDiffFileModel = {
  id: string;
  path: string;
  label: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyMessage?: string;
  additions: number;
  deletions: number;
  blocks: UnifiedBlock[];
  canStage?: boolean;
  canDiscard?: boolean;
  canStageHunk?: boolean;
};

type FileLayout = "stacked" | "cards";
type InitialExpansion = "all" | "first" | "none";

type Props = {
  files: UnifiedDiffFileModel[];
  truncated?: boolean;
  fileCount?: number;
  focusPath?: string;
  focusId?: string;
  /** Bumped each time the focused file is picked again, to scroll back to it. */
  focusRequest?: number;
  busyId?: string | null;
  totals?: { additions: number; deletions: number };
  /** Fill the parent pane and scroll inside. Off when the parent already scrolls. */
  fill?: boolean;
  /** Changes uses a continuous stack; embedded review surfaces can use cards. */
  fileLayout?: FileLayout;
  /** Applied when a new set of files is loaded. */
  initialExpansion?: InitialExpansion;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
  /**
   * A section is expanded and near the viewport (`needed`), or stopped being.
   * Lets a parent that loads bodies lazily fetch only what can be seen.
   */
  onSectionNeeded?: (id: string, needed: boolean) => void;
};

export function UnifiedDiffView({
  files,
  truncated,
  fileCount,
  focusPath,
  focusId,
  focusRequest,
  busyId,
  totals,
  fill = true,
  fileLayout = "stacked",
  initialExpansion = "all",
  onStageFile,
  onDiscardFile,
  onStageHunk,
  onSectionNeeded,
}: Props) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const diffLayout = useDiffLayout();
  const [open, setOpen] = useState<Set<string>>(() => initiallyOpenFiles(files, initialExpansion));
  const [reveals, setReveals] = useState<Record<string, Record<string, FoldReveal>>>({});
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const overview = useMemo(() => new DiffOverviewRegistry(), []);
  const fileKey = useMemo(() => files.map((file) => file.id).join("\n"), [files]);
  const resolvedFocusId = useMemo(
    () => focusId ?? files.find((file) => file.path === focusPath || file.id === focusPath)?.id,
    [fileKey, files, focusId, focusPath],
  );
  const previousFileSet = useRef({ ids: new Set(files.map((file) => file.id)), initialExpansion });

  // Ctrl+wheel shares the file editors' code size, so both zoom together.
  const zoom = codeZoomScale(useSyncExternalStore(subscribeCodeZoom, codeZoomOffset));
  const rowMetrics = useMemo(() => diffRowMetrics(zoom), [zoom]);
  const zoomStyle = useMemo(
    () =>
      ({
        "--diff-zoom": zoom,
        "--diff-line-h": `${rowMetrics.line}px`,
        "--diff-fold-h": `${rowMetrics.fold}px`,
        "--diff-hunk-h": `${rowMetrics.hunk}px`,
        "--diff-code-font": `${12 * zoom}px`,
        "--diff-meta-font": `${11 * zoom}px`,
        "--diff-gutter-w": `${Math.round(48 * zoom)}px`,
      }) as CSSProperties,
    [rowMetrics, zoom],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchor = useRef<{ y: number; zoom: number } | null>(null);
  const hasFiles = files.length > 0;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      const from = codeZoomScale();
      if (!zoomCodeByWheel(event)) return;
      event.preventDefault();
      const scroller = scrollerRef.current;
      if (scroller && !zoomAnchor.current) {
        zoomAnchor.current = {
          y: event.clientY - scroller.getBoundingClientRect().top,
          zoom: from,
        };
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [hasFiles]);
  // Keep the line under the pointer in place while the rows grow or shrink.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller || anchor.zoom === zoom) return;
    const top = anchoredScroll(scroller.scrollTop, anchor.y, zoom / anchor.zoom);
    if (Number.isFinite(top)) scroller.scrollTop = Math.max(0, top);
  }, [zoom]);

  useEffect(() => {
    const previous = previousFileSet.current;
    const ids = new Set(files.map((file) => file.id));
    const defaults = initiallyOpenFiles(files, initialExpansion);
    previousFileSet.current = { ids, initialExpansion };
    setOpen((current) => {
      if (previous.initialExpansion !== initialExpansion) return defaults;
      // Keep the reader's choices for surviving files; only new files use defaults.
      const next = new Set(
        [...ids].filter((id) => (previous.ids.has(id) ? current.has(id) : defaults.has(id))),
      );
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
    setReveals({});
  }, [fileKey, initialExpansion]);

  // The focused file stays pinned to the top while diffs above it load and
  // grow, until the reader scrolls or clicks in the view themselves.
  const followFocusRef = useRef<string | null>(null);
  const scrollToFocus = useCallback(() => {
    const id = followFocusRef.current;
    const node = id ? fileRefs.current.get(id) : undefined;
    const scroller = scrollerRef.current;
    if (!node) return;
    if (!scroller) {
      node.scrollIntoView({ block: "start" });
      return;
    }
    // Measure against the scroller itself: it isn't the section's offsetParent,
    // so offsetTop would also count the toolbar above it.
    const offset =
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = Math.max(0, offset - (fileLayout === "cards" ? 8 : 0));
    if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTo({ top });
  }, [fileLayout]);
  const releaseFocus = useCallback(() => {
    followFocusRef.current = null;
  }, []);
  const openFocusedFile = useCallback(() => {
    const id = followFocusRef.current;
    if (!id || !fileRefs.current.has(id)) return;
    setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
    scrollToFocus();
  }, [scrollToFocus]);

  // Only a new selection starts following.
  useEffect(() => {
    followFocusRef.current = resolvedFocusId ?? null;
    openFocusedFile();
  }, [resolvedFocusId, focusRequest, openFocusedFile]);

  // A refreshed file list re-anchors a file still being followed, but never
  // resumes one the reader already scrolled away from.
  useEffect(() => {
    openFocusedFile();
  }, [fileKey, initialExpansion, openFocusedFile]);

  // Expansion can change the scroll limit. Re-anchor after it reaches the DOM.
  useLayoutEffect(() => {
    scrollToFocus();
  }, [open, scrollToFocus]);

  const contentObserverRef = useRef<ResizeObserver | null>(null);
  const bindContent = useCallback(
    (el: HTMLDivElement | null) => {
      contentObserverRef.current?.disconnect();
      contentObserverRef.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(scrollToFocus);
      observer.observe(el);
      contentObserverRef.current = observer;
    },
    [scrollToFocus],
  );

  const bindScroller = useCallback(
    (el: HTMLDivElement | null) => {
      // In embedded mode an ancestor owns vertical scrolling. Leaving this
      // null makes each file discover that real scroll root.
      scrollerRef.current = fill ? el : null;
      lockOverscroll(fill ? el : null);
    },
    [fill, lockOverscroll],
  );

  const toggleFile = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealFold = useCallback(
    (fileId: string, foldId: string, total: number, direction: "up" | "down" | "all") => {
      setReveals((current) => ({
        ...current,
        [fileId]: {
          ...current[fileId],
          [foldId]: expandFold(current[fileId]?.[foldId], total, direction),
        },
      }));
    },
    [],
  );

  const bindFileRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) fileRefs.current.set(id, node);
    else fileRefs.current.delete(id);
  }, []);

  if (files.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-content/45">{t("No file changes")}</p>;
  }

  const count = fileCount ?? files.length;
  const fileLabel = count === 1 ? "1 file" : `${count} files`;
  const additions = totals?.additions ?? files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = totals?.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div
      ref={rootRef}
      className={
        fill ? "relative flex h-full min-h-0 flex-1 flex-col overflow-hidden" : "flex flex-col"
      }
    >
      <div
        className={`flex h-8 shrink-0 items-center gap-3 border-b border-stroke px-3 text-[12px]`}
      >
        <span className="text-content/70">{fileLabel}</span>
        <DiffCounts additions={additions} deletions={deletions} />
        <span className="ml-auto flex items-center gap-0.5">
          <DiffLayoutToggle className="mr-0.5" />
          <button
            type="button"
            title={t("Expand all files")}
            aria-label={t("Expand all files")}
            onClick={() => setOpen(new Set(files.map((file) => file.id)))}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t("Collapse all files")}
            aria-label={t("Collapse all files")}
            disabled={open.size === 0}
            onClick={() => setOpen(new Set())}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <FoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div
        ref={bindScroller}
        onWheel={releaseFocus}
        onTouchStart={releaseFocus}
        onPointerDown={releaseFocus}
        onKeyDown={releaseFocus}
        className={
          fill ? "unified-diff min-h-0 flex-1 overflow-y-auto overscroll-none" : "unified-diff"
        }
        style={zoomStyle}
      >
        {truncated ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            {t("Diff is too large to display in full. File list is shown without patches.")}
          </p>
        ) : null}
        <div
          ref={bindContent}
          className={fileLayout === "cards" ? "flex flex-col gap-2 pt-2" : "flex flex-col"}
        >
          <DiffOverviewContext.Provider value={fill ? overview : null}>
            {files.map((file) => (
              <FileSection
                key={file.id}
                file={file}
                expanded={open.has(file.id)}
                focused={resolvedFocusId === file.id}
                busy={busyId === file.id}
                reveals={reveals[file.id] ?? EMPTY_REVEALS}
                fileLayout={fileLayout}
                diffLayout={diffLayout}
                rowMetrics={rowMetrics}
                colorScheme={colorScheme}
                scrollerRef={scrollerRef}
                onToggle={toggleFile}
                onReveal={revealFold}
                onStageFile={onStageFile}
                onDiscardFile={onDiscardFile}
                onStageHunk={onStageHunk}
                bindRef={bindFileRef}
                onNeeded={onSectionNeeded}
              />
            ))}
          </DiffOverviewContext.Provider>
        </div>
      </div>
      {fill ? <DiffOverviewRuler scrollerRef={scrollerRef} registry={overview} /> : null}
    </div>
  );
}

type FileSectionProps = {
  file: UnifiedDiffFileModel;
  expanded: boolean;
  focused: boolean;
  busy: boolean;
  reveals: Record<string, FoldReveal>;
  fileLayout: FileLayout;
  diffLayout: DiffLayout;
  rowMetrics: DiffRowMetrics;
  colorScheme: ColorScheme;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onToggle: (id: string) => void;
  onReveal: (
    fileId: string,
    foldId: string,
    total: number,
    direction: "up" | "down" | "all",
  ) => void;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindRef: (path: string, node: HTMLElement | null) => void;
  onNeeded?: (id: string, needed: boolean) => void;
};

const FileSection = memo(function FileSection({
  file,
  expanded,
  focused,
  busy,
  reveals,
  fileLayout,
  diffLayout,
  rowMetrics,
  colorScheme,
  scrollerRef,
  onToggle,
  onReveal,
  onStageFile,
  onDiscardFile,
  onStageHunk,
  bindRef,
  onNeeded,
}: FileSectionProps) {
  useLocale();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const name = basename(file.path);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [highlightReady, setHighlightReady] = useState(false);
  useEffect(() => {
    if (expanded && near) setHighlightReady(true);
  }, [expanded, near]);
  const [tokens, setTokens] = useState<Map<UnifiedLine, SyntaxToken[]> | null>(null);

  useEffect(() => {
    if (!expanded || !highlightReady) return;
    let cancelled = false;
    void highlightDiffFile(file, colorScheme).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [colorScheme, expanded, file, highlightReady]);

  useEffect(() => {
    if (!onNeeded || !expanded || !near) return;
    onNeeded(file.id, true);
    return () => onNeeded(file.id, false);
  }, [expanded, file.id, near, onNeeded]);

  const setSection = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      bindRef(file.id, node);
    },
    [bindRef, file.id],
  );

  useLayoutEffect(() => {
    if (!expanded) return;
    const section = sectionRef.current;
    if (!section) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    setNear(isNearViewport(section, root, 800));
  }, [expanded, scrollerRef, file.id]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !expanded) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting;
        setNear((current) => (current === next ? current : next));
      },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [expanded, scrollerRef]);

  return (
    <section
      ref={setSection}
      data-diff-file={file.path}
      className={`${
        fileLayout === "cards" ? "overflow-hidden rounded-md border border-content/10" : ""
      } ${focused ? "bg-content/[0.03]" : ""}`}
    >
      <header
        className={`${
          fileLayout === "stacked" ? "sticky top-0 z-30 " : ""
        } flex items-center gap-2 bg-[var(--ui-surface)] px-3 py-1.5 ${
          fileLayout === "stacked" || expanded ? "border-b border-stroke" : ""
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggle(file.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/85"
            title={file.label}
          >
            {file.label}
          </span>
          <DiffCounts additions={file.additions} deletions={file.deletions} />
        </button>
        {file.canDiscard && onDiscardFile ? (
          <IconButton
            title={t("Discard file")}
            disabled={busy}
            onClick={() => onDiscardFile(file.id)}
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {file.canStage && onStageFile ? (
          <button
            type="button"
            title={t("Stage file")}
            aria-label={t("Stage file")}
            disabled={busy}
            onClick={() => onStageFile(file.id)}
            className="grid size-4 place-items-center rounded-[3px] bg-content text-background-base hover:opacity-80 disabled:opacity-40"
          >
            <Check className="size-2.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </header>
      {expanded ? (
        <SurfaceSelection context={`@${file.path}`} contentVersion={file.blocks}>
          <FileBody
            file={file}
            reveals={reveals}
            near={near}
            tokens={tokens}
            diffLayout={diffLayout}
            rowMetrics={rowMetrics}
            scrollerRef={scrollerRef}
            onReveal={(foldId, direction) => {
              const block = file.blocks.find(
                (entry) => entry.kind === "fold" && entry.id === foldId,
              );
              const total = block?.kind === "fold" ? block.lines.length : 0;
              onReveal(file.id, foldId, total, direction);
            }}
            onStageHunk={onStageHunk}
          />
        </SurfaceSelection>
      ) : null}
    </section>
  );
}, equalFileSectionProps);

const EMPTY_REVEALS: Record<string, FoldReveal> = {};

function equalFileSectionProps(previous: FileSectionProps, next: FileSectionProps): boolean {
  return (
    equalFileModel(previous.file, next.file) &&
    previous.expanded === next.expanded &&
    previous.focused === next.focused &&
    previous.busy === next.busy &&
    previous.reveals === next.reveals &&
    previous.fileLayout === next.fileLayout &&
    previous.diffLayout === next.diffLayout &&
    previous.rowMetrics === next.rowMetrics &&
    previous.colorScheme === next.colorScheme &&
    previous.scrollerRef === next.scrollerRef &&
    previous.onToggle === next.onToggle &&
    previous.onReveal === next.onReveal &&
    previous.onStageFile === next.onStageFile &&
    previous.onDiscardFile === next.onDiscardFile &&
    previous.onStageHunk === next.onStageHunk &&
    previous.bindRef === next.bindRef &&
    previous.onNeeded === next.onNeeded
  );
}

function equalFileModel(previous: UnifiedDiffFileModel, next: UnifiedDiffFileModel): boolean {
  return (
    previous.id === next.id &&
    previous.path === next.path &&
    previous.label === next.label &&
    previous.binary === next.binary &&
    previous.tooLarge === next.tooLarge &&
    previous.emptyMessage === next.emptyMessage &&
    previous.additions === next.additions &&
    previous.deletions === next.deletions &&
    (previous.blocks === next.blocks ||
      (previous.blocks.length === 0 && next.blocks.length === 0)) &&
    previous.canStage === next.canStage &&
    previous.canDiscard === next.canDiscard &&
    previous.canStageHunk === next.canStageHunk
  );
}

function FileBody({
  file,
  reveals,
  near,
  tokens,
  diffLayout,
  rowMetrics,
  scrollerRef,
  onReveal,
  onStageHunk,
}: {
  file: UnifiedDiffFileModel;
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  diffLayout: DiffLayout;
  rowMetrics: DiffRowMetrics;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
}) {
  useLocale();
  if (file.binary) return <EmptyBody>{t("Binary file changed")}</EmptyBody>;
  if (file.tooLarge) return <EmptyBody>{t("Diff is too large to display")}</EmptyBody>;
  if (file.emptyMessage) return <EmptyBody>{file.emptyMessage}</EmptyBody>;
  if (file.blocks.length === 0) return <EmptyBody>{t("No textual diff")}</EmptyBody>;

  return (
    <VirtualRows
      fileId={file.id}
      filePath={file.path}
      blocks={file.blocks}
      reveals={reveals}
      near={near}
      tokens={tokens}
      split={diffLayout === "split"}
      rowMetrics={rowMetrics}
      canStageHunk={file.canStageHunk}
      scrollerRef={scrollerRef}
      onReveal={onReveal}
      onStageHunk={onStageHunk}
    />
  );
}

function VirtualRows({
  fileId,
  filePath,
  blocks,
  reveals,
  near,
  tokens,
  split,
  rowMetrics,
  canStageHunk,
  scrollerRef,
  onReveal,
  onStageHunk,
}: {
  fileId: string;
  filePath: string;
  blocks: UnifiedBlock[];
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  /** Before | after columns instead of one. */
  split: boolean;
  rowMetrics: DiffRowMetrics;
  canStageHunk?: boolean;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
}) {
  useLocale();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLDivElement | null>(null);
  // The after column's own scroller, in split layout only.
  const codeRightRef = useRef<HTMLDivElement | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const hover = useRef<DiffHover | null>(null);
  const [commentTarget, setCommentTarget] = useState<DiffCommentDraft | null>(null);
  const rows = useMemo(
    () =>
      flattenVisibleRows(
        blocks,
        (foldId) => reveals[foldId],
        !!canStageHunk && !!onStageHunk,
        rowMetrics,
      ),
    [blocks, canStageHunk, fileId, onStageHunk, reveals, rowMetrics],
  );
  const splitRows = useMemo(
    () => (split ? buildSplitRows(rows, rowMetrics) : null),
    [rowMetrics, rows, split],
  );
  // Either way every row has a fixed height, so one window helper serves both.
  const sizedRows: readonly SizedRow[] = splitRows ?? rows;
  const rowLayout = useMemo(() => layoutRows(sizedRows), [sizedRows]);
  const totalHeight = rowLayout.totalHeight;
  const overviewMarks = useMemo(
    () => (splitRows ? splitRowMarks(splitRows, rowLayout) : unifiedRowMarks(rows, rowLayout)),
    [rows, rowLayout, splitRows],
  );
  useDiffOverviewSource(fileId, overviewMarks, bodyRef);
  const minWidthCh = useMemo(() => {
    let before = 40;
    let after = 40;
    if (splitRows) {
      for (const row of splitRows) {
        if (row.type === "hunk") {
          before = Math.max(before, row.line.text.length);
        } else if (row.type === "pair") {
          if (row.left) before = Math.max(before, row.left.text.length);
          if (row.right) after = Math.max(after, row.right.text.length);
        }
      }
    } else {
      for (const row of rows) {
        if (row.type === "line") {
          before = Math.max(before, row.line.text.length);
        }
      }
    }
    return { before: before + 10, after: after + 10 };
  }, [rows, splitRows]);
  const [range, setRange] = useState<RowWindow>(() => ({
    start: 0,
    end: 0,
    padTop: 0,
    padBottom: totalHeight,
  }));

  const updateWindow = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const root = scrollerRef.current ?? verticalScrollParent(body);
    const rootRect = root
      ? root.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const bodyRect = body.getBoundingClientRect();
    const next = windowRows(
      sizedRows,
      rootRect.top - bodyRect.top,
      rootRect.bottom - bodyRect.top,
      UNIFIED_OVERSCAN_PX,
      rowLayout,
    );
    setRange((current) =>
      current.start === next.start &&
      current.end === next.end &&
      current.padTop === next.padTop &&
      current.padBottom === next.padBottom
        ? current
        : next,
    );
  }, [rowLayout, scrollerRef, sizedRows]);

  const hoverAt = useCallback(
    (point: { x: number; y: number } | null) => {
      const body = bodyRef.current;
      const mark = (next: DiffHover | null) => {
        if (hover.current?.key === next?.key && hover.current?.side === next?.side) return;
        hover.current = next;
        for (const node of body?.querySelectorAll<HTMLElement>('[data-pointer-row="true"]') ?? []) {
          node.dataset.pointerRow = "false";
          node.dataset.pointerHover = "false";
        }
        if (!next || !body) return;
        for (const node of body.querySelectorAll<HTMLElement>(
          `[data-diff-hover-key="${CSS.escape(next.key)}"]`,
        )) {
          node.dataset.pointerRow = "true";
          node.dataset.pointerHover =
            !splitRows || node.dataset.diffSide === next.side ? "true" : "false";
        }
      };
      const clear = () => mark(null);
      if (point == null || !body) return clear();
      const bounds = body.getBoundingClientRect();
      let y = point.y - bounds.top - range.padTop;
      if (y < 0) return clear();
      // Only the split layout cares which column the pointer is over.
      const side: DiffSide =
        splitRows && point.x < bounds.left + bounds.width / 2 ? "before" : "after";
      for (let index = range.start; index < range.end; index += 1) {
        const row = sizedRows[index];
        if (!row) break;
        if (y < row.height) {
          const key = splitRows
            ? splitRowKey(splitRows[index], index)
            : diffRowKey(rows[index], index);
          mark({ key, side });
          return;
        }
        y -= row.height;
      }
      clear();
    },
    [range.end, range.padTop, range.start, rows, sizedRows, splitRows],
  );

  useLayoutEffect(() => {
    if (!near) return;
    updateWindow();
  }, [near, updateWindow, totalHeight]);

  useLayoutEffect(() => {
    if (!near) return;
    hoverAt(mouseRef.current);
  }, [hoverAt, near]);

  useLayoutEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;
    const apply = () => {
      body.style.setProperty("--unified-body-width", `${body.clientWidth}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(body);
    return () => observer.disconnect();
  }, [near, totalHeight]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    const root = scrollerRef.current ?? (body ? verticalScrollParent(body) : null);
    const target: HTMLElement | Window = root ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateWindow();
        hoverAt(mouseRef.current);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverAt, near, scrollerRef, updateWindow]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;

    // WebKit can latch a wheel gesture to a horizontal scroller instead of
    // chaining its vertical delta to the surrounding unified diff.
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
      const target = event.target instanceof Node ? event.target : null;
      const code = [codeRef.current, codeRightRef.current].find(
        (node) => node && target && node.contains(target),
      );
      const ownScroller = scrollerRef.current;
      const verticalScroller =
        ownScroller && ownScroller.scrollHeight > ownScroller.clientHeight + 1
          ? ownScroller
          : verticalScrollParent(body, true);
      if (!verticalScroller) return;

      const scale =
        event.deltaMode === 1
          ? rowMetrics.line
          : event.deltaMode === 2
            ? verticalScroller.clientHeight
            : 1;
      const before = verticalScroller.scrollTop;
      const max = verticalScroller.scrollHeight - verticalScroller.clientHeight;
      const next = Math.min(max, Math.max(0, before + event.deltaY * scale));
      if (next === before) return;

      event.preventDefault();
      verticalScroller.scrollTop = next;
      // Cancelling the native gesture also cancels its horizontal component.
      // Preserve diagonal touchpad scrolling in the column under the pointer.
      if (code && event.deltaX !== 0) {
        const horizontalScale = event.deltaMode === 2 ? code.clientWidth : scale;
        code.scrollLeft += event.deltaX * horizontalScale;
      }
    };

    body.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      body.removeEventListener("wheel", onWheel);
    };
  }, [near, rowMetrics, scrollerRef, split]);

  const stageHunk = useStableCallback(onStageHunk);
  const revealFold = useStableCallback(onReveal);
  const commentOnLine = useCallback(
    (key: string, line: UnifiedLine, anchor: DOMRect) => setCommentTarget({ key, line, anchor }),
    [],
  );

  if (!near) {
    return <div ref={bodyRef} style={{ height: totalHeight }} />;
  }

  const lanePad = {
    paddingTop: range.padTop,
    paddingBottom: range.padBottom,
  };

  const visible = rows.slice(range.start, range.end);
  const renderLane = (lane: Lane) =>
    visible.map((row, index) => {
      const key = diffRowKey(row, range.start + index);
      return (
        <DiffLane
          hoverKey={key}
          fileId={fileId}
          key={`${lane}-${key}`}
          row={row}
          lane={lane}
          hovered={false}
          commenting={commentTarget?.key === key}
          tokens={row.type === "line" ? tokens?.get(row.line) : undefined}
          onReveal={revealFold}
          onStage={row.type === "line" && row.stage && row.line.pos != null ? stageHunk : undefined}
          onComment={
            lane === "gutter" && row.type === "line" && row.line.kind !== "hunk"
              ? commentOnLine
              : undefined
          }
        />
      );
    });

  const visibleSplit = splitRows ? splitRows.slice(range.start, range.end) : [];
  const renderSplitLane = (side: DiffSide, lane: Lane) =>
    visibleSplit.map((row, index) => {
      const key = splitRowKey(row, range.start + index);
      const sideKey = `${key}:${side}`;
      const line = row.type === "pair" ? (side === "before" ? row.left : row.right) : null;
      // One stage button per row, on the after side unless that side is empty.
      const stageHere =
        row.type === "pair" &&
        row.stagePos !== undefined &&
        (side === "after" || row.right === null);
      return (
        <SplitLane
          hoverKey={key}
          fileId={fileId}
          key={`${side}-${lane}-${key}`}
          row={row}
          side={side}
          lane={lane}
          hovered={false}
          rowHovered={false}
          commenting={commentTarget?.key === sideKey}
          tokens={line ? tokens?.get(line) : undefined}
          onReveal={revealFold}
          stagePos={row.type === "pair" ? row.stagePos : undefined}
          onStage={
            stageHere && row.type === "pair" && row.stagePos !== undefined ? stageHunk : undefined
          }
          onComment={lane === "gutter" && line && line.kind !== "hunk" ? commentOnLine : undefined}
        />
      );
    });

  return (
    <>
      <div
        ref={bodyRef}
        className="flex"
        onMouseMove={(event) => {
          mouseRef.current = { x: event.clientX, y: event.clientY };
          hoverAt(mouseRef.current);
        }}
        onMouseLeave={() => {
          mouseRef.current = null;
          hoverAt(null);
        }}
      >
        {splitRows ? (
          <>
            {/* Each column scrolls sideways on its own, as the inline view
                does; the before gutter sits above the after one so a fold
                bar spanning both stays clickable. */}
            <div className="flex min-w-0 flex-1">
              <div className="relative z-20 w-[var(--diff-gutter-w,3rem)] shrink-0" style={lanePad}>
                {renderSplitLane("before", "gutter")}
              </div>
              <div ref={codeRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-none">
                <div
                  style={{
                    ...lanePad,
                    minWidth: `max(100%, calc(${minWidthCh.before}ch * var(--diff-zoom, 1)))`,
                  }}
                >
                  {renderSplitLane("before", "code")}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 border-l border-stroke">
              <div className="relative z-10 w-[var(--diff-gutter-w,3rem)] shrink-0" style={lanePad}>
                {renderSplitLane("after", "gutter")}
              </div>
              <div ref={codeRightRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-none">
                <div
                  style={{
                    ...lanePad,
                    minWidth: `max(100%, calc(${minWidthCh.after}ch * var(--diff-zoom, 1)))`,
                  }}
                >
                  {renderSplitLane("after", "code")}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="relative z-10 w-[var(--diff-gutter-w,3rem)] shrink-0" style={lanePad}>
              {renderLane("gutter")}
            </div>
            <div ref={codeRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-none">
              <div
                style={{
                  ...lanePad,
                  minWidth: `max(100%, calc(${minWidthCh.before}ch * var(--diff-zoom, 1)))`,
                }}
              >
                {renderLane("code")}
              </div>
            </div>
          </>
        )}
      </div>
      {commentTarget ? (
        <DiffCommentComposer
          path={filePath}
          target={commentTarget}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
    </>
  );
}

type Lane = "gutter" | "code";
type DiffSide = "before" | "after";

type DiffHover = { key: string; side: DiffSide };

type DiffCommentDraft = {
  key: string;
  line: UnifiedLine;
  anchor: DOMRect;
};

function diffRowKey(row: DiffViewRow, index: number) {
  if (row.type === "fold") return `fold-${row.id}`;
  return `${index}-${row.line.kind}-${row.line.oldNumber ?? "x"}-${row.line.newNumber ?? "x"}`;
}

function splitRowKey(row: SplitRow, index: number) {
  if (row.type === "fold") return `fold-${row.id}`;
  if (row.type === "hunk") return `${index}-hunk`;
  return `${index}-${row.left?.oldNumber ?? "x"}-${row.right?.newNumber ?? "x"}`;
}

// Row heights follow the zoom variables set on the diff scroller.
const LINE_HEIGHT: CSSProperties = { height: "var(--diff-line-h, 20px)" };
const FOLD_HEIGHT: CSSProperties = { height: "var(--diff-fold-h, 32px)" };
const HUNK_HEIGHT: CSSProperties = { height: "var(--diff-hunk-h, 22px)" };

/** One cell of a split row: a lane of one column. */
const SplitLane = memo(function SplitLane({
  hoverKey,
  fileId,
  stagePos,
  row,
  side,
  lane,
  hovered,
  rowHovered,
  commenting,
  tokens,
  onReveal,
  onStage,
  onComment,
}: {
  hoverKey: string;
  fileId: string;
  stagePos?: number;
  row: SplitRow;
  side: DiffSide;
  lane: Lane;
  /** The pointer is over this column of the row. */
  hovered: boolean;
  /** The pointer is over the row, in either column. */
  rowHovered: boolean;
  commenting: boolean;
  tokens?: SyntaxToken[];
  onReveal?: (foldId: string, direction: "up" | "down" | "all") => void;
  onStage?: (fileId: string, pos: number) => void;
  onComment?: (key: string, line: UnifiedLine, anchor: DOMRect) => void;
}) {
  useLocale();
  if (row.type === "fold") {
    // The bar is drawn once, from the before gutter, across both columns.
    if (side === "before" && lane === "gutter") {
      return (
        <div className="relative z-20" style={FOLD_HEIGHT}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: "var(--unified-body-width, 100%)" }}
          >
            <FoldBar foldId={row.id} hidden={row.hidden} onReveal={onReveal!} />
          </div>
        </div>
      );
    }
    return <div style={FOLD_HEIGHT} />;
  }
  if (row.type === "hunk") {
    return side === "before" ? (
      <DiffLineRow line={row.line} lane={lane} hovered={false} commenting={false} />
    ) : (
      <div className="bg-content/5" style={HUNK_HEIGHT} />
    );
  }
  const line = side === "before" ? row.left : row.right;
  if (!line) {
    return <div className="bg-content/[0.04]" style={LINE_HEIGHT} />;
  }
  return (
    <DiffLineRow
      line={line}
      hoverKey={hoverKey}
      fileId={fileId}
      stagePos={stagePos}
      side={side}
      lane={lane}
      numberFrom={side === "before" ? "old" : "new"}
      hovered={hovered}
      stageVisible={rowHovered}
      commenting={commenting}
      tokens={tokens}
      onStage={onStage}
      onComment={onComment}
    />
  );
});

const DiffLane = memo(function DiffLane({
  hoverKey,
  fileId,
  row,
  lane,
  hovered,
  commenting,
  tokens,
  onReveal,
  onStage,
  onComment,
}: {
  hoverKey: string;
  fileId: string;
  stagePos?: number;
  row: DiffViewRow;
  lane: Lane;
  hovered: boolean;
  commenting: boolean;
  tokens?: SyntaxToken[];
  onReveal?: (foldId: string, direction: "up" | "down" | "all") => void;
  onStage?: (fileId: string, pos: number) => void;
  onComment?: (key: string, line: UnifiedLine, anchor: DOMRect) => void;
}) {
  useLocale();
  if (row.type === "fold") {
    if (lane === "gutter") {
      return (
        <div className="relative z-20" style={FOLD_HEIGHT}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: "var(--unified-body-width, 100%)" }}
          >
            <FoldBar foldId={row.id} hidden={row.hidden} onReveal={onReveal!} />
          </div>
        </div>
      );
    }
    return <div style={FOLD_HEIGHT} />;
  }
  return (
    <DiffLineRow
      line={row.line}
      hoverKey={hoverKey}
      fileId={fileId}
      stagePos={row.line.pos}
      lane={lane}
      hovered={hovered}
      commenting={commenting}
      tokens={tokens}
      onStage={onStage}
      onComment={onComment}
    />
  );
});

function FoldBar({
  foldId,
  hidden,
  onReveal,
}: {
  hidden: number;
  foldId: string;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
}) {
  useLocale();
  return (
    <div className="flex items-center gap-1 bg-content/8 px-2" style={FOLD_HEIGHT}>
      <button
        type="button"
        title={t("Expand upward")}
        aria-label={t("Expand unmodified lines upward")}
        onClick={() => onReveal(foldId, "up")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronUp className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        title={t("Expand downward")}
        aria-label={t("Expand unmodified lines downward")}
        onClick={() => onReveal(foldId, "down")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onReveal(foldId, "all")}
        className="min-w-0 flex-1 py-1 text-left font-mono text-[length:var(--diff-meta-font,11px)] text-content/45 hover:text-content/70"
      >
        {hidden}
        {t(" unmodified ")}
        {hidden === 1 ? t("line") : t("lines")}
      </button>
    </div>
  );
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  hoverKey,
  fileId,
  stagePos,
  side,
  lane,
  numberFrom,
  hovered,
  stageVisible = hovered,
  commenting,
  tokens,
  onStage,
  onComment,
}: {
  line: UnifiedLine;
  hoverKey?: string;
  fileId?: string;
  stagePos?: number;
  side?: DiffSide;
  lane: Lane;
  /** Which of the line's numbers to show. Default: the one its kind implies. */
  numberFrom?: "old" | "new";
  hovered: boolean;
  /** Show the stage button. Default: whenever `hovered`. */
  stageVisible?: boolean;
  commenting: boolean;
  tokens?: SyntaxToken[];
  onStage?: (fileId: string, pos: number) => void;
  onComment?: (key: string, line: UnifiedLine, anchor: DOMRect) => void;
}) {
  useLocale();
  if (line.kind === "hunk") {
    return (
      <div className="flex items-center bg-content/5" style={HUNK_HEIGHT}>
        {lane === "code" ? (
          <span className="px-3 font-mono text-[length:var(--diff-meta-font,11px)] leading-none text-content/40">
            {line.text}
          </span>
        ) : null}
      </div>
    );
  }
  const added = line.kind === "add";
  const deleted = line.kind === "del";
  const number =
    numberFrom === "old" || (numberFrom === undefined && deleted) ? line.oldNumber : line.newNumber;
  const row = added ? "bg-diff-add-bg" : deleted ? "bg-diff-del-bg" : "";
  const gutterTint = added ? "bg-diff-add-gutter" : deleted ? "bg-diff-del-gutter" : "";
  const gutterText = added ? "text-diff-add-fg" : deleted ? "text-diff-del-fg" : "text-content/35";

  if (lane === "gutter") {
    return (
      <div
        data-diff-hover-key={hoverKey}
        data-diff-side={side}
        data-pointer-row="false"
        data-pointer-hover="false"
        className={`relative flex items-center ${row}`}
        style={LINE_HEIGHT}
      >
        {gutterTint ? (
          <span className={`pointer-events-none absolute inset-0 ${gutterTint}`} />
        ) : null}
        <span
          className={`relative block w-full pr-2 text-right font-mono text-[length:var(--diff-meta-font,11px)] leading-none tabular-nums ${gutterText}`}
        >
          {number ?? ""}
        </span>
        {onComment ? (
          <button
            type="button"
            title={`Comment on line ${number ?? ""}`.trim()}
            aria-label={`Comment on line ${number ?? ""}`.trim()}
            onClick={(event) =>
              onComment(
                side ? `${hoverKey}:${side}` : (hoverKey ?? ""),
                line,
                event.currentTarget.getBoundingClientRect(),
              )
            }
            className={`diff-hover-comment absolute top-0.5 left-0.5 z-10 grid size-4 place-items-center rounded-[3px] bg-content text-background-base outline-none transition-opacity hover:opacity-80 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/50 ${
              hovered || commenting ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <MessageSquarePlus className="size-2.5" strokeWidth={2} />
          </button>
        ) : null}
        {onStage ? (
          <button
            type="button"
            title={t("Stage hunk")}
            aria-label={t("Stage hunk")}
            onClick={() => {
              if (fileId !== undefined && stagePos !== undefined) onStage(fileId, stagePos);
            }}
            className={`diff-hover-stage absolute top-0.5 left-full z-10 ml-0.5 grid size-4 place-items-center rounded-[3px] bg-on-solid text-[11px] font-bold text-scrim ${
              stageVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            +
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center ${row}`} style={LINE_HEIGHT}>
      {/* Width is counted in minWidthCh. select-none keeps the glyph and the
          screen-reader cue out of copied code. */}
      <span
        className={`w-7 shrink-0 select-none pl-3 font-mono text-[length:var(--diff-code-font,12px)] leading-none font-semibold ${gutterText}`}
      >
        <span aria-hidden="true">{added ? "+" : deleted ? "−" : ""}</span>
        {added || deleted ? (
          <span className="sr-only">{added ? t("Added: ") : t("Removed: ")}</span>
        ) : null}
      </span>
      <span
        className={`whitespace-pre pr-3 font-mono text-[length:var(--diff-code-font,12px)] leading-none text-content/80 ${
          line.kind === "context" ? "opacity-70" : ""
        }`}
      >
        {renderLineText(line, tokens)}
      </span>
    </div>
  );
});

function renderLineText(line: UnifiedLine, tokens?: SyntaxToken[]) {
  const pieces = tokens && tokens.length > 0 ? tokens : [{ text: line.text }];
  if (pieces.length === 1 && !pieces[0]?.color) {
    return line.text;
  }
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={index} style={piece.color ? { color: piece.color } : undefined}>
          {piece.text}
        </span>
      ))}
    </>
  );
}

function EmptyBody({ children }: { children: string }) {
  useLocale();
  return <p className="px-3 py-3 text-[12px] text-content/45">{children}</p>;
}

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  useLocale();
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-sans text-[11px] font-semibold tabular-nums">
      {additions > 0 ? <span className="text-diff-add-fg">+{formatInteger(additions)}</span> : null}
      {deletions > 0 ? <span className="text-diff-del-fg">-{formatInteger(deletions)}</span> : null}
    </span>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function verticalScrollParent(el: HTMLElement, requireScrollable = false): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      (!requireScrollable || current.scrollHeight > current.clientHeight + 1)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isNearViewport(section: HTMLElement, root: HTMLElement | null, margin: number) {
  const bounds = section.getBoundingClientRect();
  const view = root
    ? root.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return bounds.bottom + margin > view.top && bounds.top - margin < view.bottom;
}

function initiallyOpenFiles(
  files: readonly UnifiedDiffFileModel[],
  mode: InitialExpansion,
): Set<string> {
  if (mode === "none" || files.length === 0) return new Set();
  if (mode === "first") return new Set([files[0].id]);
  return new Set(files.map((file) => file.id));
}
