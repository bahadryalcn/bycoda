import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Button } from "../../../shared/ui/Button";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { t, useLocale } from "../../../shared/i18n/git";
import {
  useCallback,
  memo,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { GRAPH_ROW_PX, SWIMLANE_WIDTH, type HistoryItemViewModel } from "../model/gitGraph";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  isMergeCommit,
  orderGraphRefs,
} from "../model/gitGraphDisplay";
import { visibleRange } from "../model/gitGraphWindow";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { GitGraphHoverCard } from "./GitGraphHoverCard";
import { GraphAvatar, GraphLane, RefPills } from "./GitGraphParts";
import styles from "./GitGraphList.module.css";

import { GitGraphColumnFilter } from "./GitGraphColumnFilter";
import type { GitHistoryFilters } from "../model/gitHistoryFilters";

export type GraphListItem = {
  commit: GitHistoryCommit;
  row: HistoryItemViewModel;
};

export type GraphVariant = "compact" | "wide" | "workspace";

type Props = {
  variant: GraphVariant;
  filters?: GitHistoryFilters;
  onFilters?: (filters: GitHistoryFilters) => void;
  items: GraphListItem[];
  /** Lanes only connect when every commit is shown, so a filtered list drops them. */
  plain: boolean;
  selectedSha?: string;
  hasMore: boolean;
  /** Shown instead of the rows (no project, no commits, no matches). */
  empty?: ReactNode;
  /** A context menu is open: no hover card while it is. */
  suspendHover: boolean;
  onLoadMore: () => void;
  onOpen: (commit: GitHistoryCommit, pin?: boolean) => void;
  onMenu?: (x: number, y: number, commit: GitHistoryCommit) => void;
};

/** Rows mounted beyond the viewport on each side. */
const OVERSCAN = 10;
/** Used until the scroller has been measured (and where nothing measures). */
const FALLBACK_VIEWPORT_PX = 600;
const NOW_REFRESH_MS = 60_000;

const WIDE_HEADER_PX = 32;
const WIDE_REFS_PX = 190;
const WIDE_AUTHOR_PX = 150;
const WIDE_DATE_PX = 64;
const WIDE_SHA_PX = 72;
const WIDE_GRAPH_MAX_PX = 260;

const LOAD_MORE_CLASS = "w-full text-left";

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Widest lane drawing among the rows, so the wide view's Graph column fits all. */
function graphColumnWidth(items: readonly GraphListItem[]): number {
  let lanes = 1;
  for (const { row } of items) {
    lanes = Math.max(lanes, row.inputSwimlanes.length, row.outputSwimlanes.length);
  }
  return Math.min(WIDE_GRAPH_MAX_PX, SWIMLANE_WIDTH * (lanes + 1));
}

function wideColumns(graphWidth: number): string {
  return `${WIDE_REFS_PX}px ${graphWidth}px minmax(0,1fr) ${WIDE_AUTHOR_PX}px ${WIDE_DATE_PX}px ${WIDE_SHA_PX}px`;
}

/**
 * The windowed commit list shared by the sidebar and the full-graph dialog:
 * only the rows near the viewport are mounted, between two spacers.
 */
export function GitGraphList({
  variant,
  filters,
  onFilters,
  items,
  plain,
  selectedSha,
  hasMore,
  empty,
  suspendHover,
  onLoadMore,
  onOpen,
  onMenu,
}: Props) {
  useLocale();
  const wide = variant !== "compact";
  const workspace = variant === "workspace";
  const topOffset = wide ? WIDE_HEADER_PX : 0;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [firstRow, setFirstRow] = useState(0);
  const [viewport, setViewport] = useState(0);
  const now = useNow();
  const openRow = useStableCallback((sha: string, pin?: boolean) => {
    const commit = items.find((item) => item.commit.sha === sha)?.commit;
    if (commit) onOpen(commit, pin);
  });
  const menuRow = useStableCallback(
    onMenu
      ? (sha: string, x: number, y: number) => {
          const commit = items.find((item) => item.commit.sha === sha)?.commit;
          if (commit) onMenu(x, y, commit);
        }
      : undefined,
  );

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      lockOverscroll(el);
      setScroller(el);
    },
    [lockOverscroll],
  );

  useEffect(() => {
    if (!scroller) return;
    // Round up to whole rows so a resize re-renders on row boundaries, not on
    // every pixel; the mounted range only changes per row anyway.
    const measure = () =>
      setViewport(Math.ceil(scroller.clientHeight / GRAPH_ROW_PX) * GRAPH_ROW_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    scroller?.scrollTo({ top: 0 });
  }, [filters, plain, scroller]);

  const onScroll = () => {
    if (!scroller) return;
    // Re-render when a row boundary is crossed, not on every pixel.
    const row = Math.floor(Math.max(0, scroller.scrollTop - topOffset) / GRAPH_ROW_PX);
    setFirstRow((current) => (current === row ? current : row));
  };

  const range = visibleRange(
    firstRow * GRAPH_ROW_PX,
    viewport || FALLBACK_VIEWPORT_PX,
    items.length,
    GRAPH_ROW_PX,
    OVERSCAN,
  );
  const graphWidth = useMemo(
    () => (wide && !plain ? graphColumnWidth(items) : 0),
    [wide, plain, items],
  );
  const columns = workspace
    ? `minmax(80px,120px) ${graphWidth}px minmax(100px,1fr) 64px`
    : wideColumns(graphWidth);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const li = (event.target as Element).closest("li");
    const sibling = event.key === "ArrowDown" ? li?.nextElementSibling : li?.previousElementSibling;
    const next = sibling?.querySelector("button");
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div
      ref={attach}
      onScroll={onScroll}
      className={`min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none ${workspace ? `overflow-x-auto ${styles.workspace}` : "overflow-x-hidden"}`}
      style={
        {
          "--git-graph-row": `${GRAPH_ROW_PX}px`,
          ...(workspace ? { "--git-graph-width": `${graphWidth}px` } : null),
        } as CSSProperties
      }
    >
      {empty && !wide ? (
        empty
      ) : (
        <>
          {wide ? (
            <Text
              as="div"
              weight={workspace ? "regular" : "medium"}
              className={`sticky top-0 z-1 grid items-center border-b border-(--ui-pane-border) bg-(--ui-surface-panel) ${workspace ? styles.workspaceHeader : ""}`}
              style={{
                height: WIDE_HEADER_PX,
                gridTemplateColumns: workspace ? undefined : columns,
                minWidth: workspace ? 360 + graphWidth : undefined,
              }}
            >
              {!workspace ? (
                <Text size="inherit" tone="inherit" truncate className="pl-3">
                  {t("Branch / Tag")}
                </Text>
              ) : null}
              <Text size="inherit" tone="inherit" truncate>
                <span className={workspace && graphWidth < 44 ? "sr-only" : undefined}>
                  {plain ? "" : t("Graph")}
                </span>
              </Text>
              <span className="min-w-0 ps-1">
                {filters && onFilters ? (
                  <GitGraphColumnFilter
                    label={t("Commit Message")}
                    field="subject"
                    filters={filters}
                    onChange={onFilters}
                  />
                ) : (
                  t("Commit Message")
                )}
              </span>
              <Text
                size="inherit"
                tone={workspace ? "secondary" : "inherit"}
                truncate
                className={workspace ? styles.author : undefined}
              >
                {filters && onFilters ? (
                  <GitGraphColumnFilter
                    label={t("Author")}
                    field="author"
                    filters={filters}
                    onChange={onFilters}
                  />
                ) : (
                  t("Author")
                )}
              </Text>
              <span className="min-w-0">
                {filters && onFilters ? (
                  <GitGraphColumnFilter
                    label={t("Date")}
                    field="date"
                    filters={filters}
                    onChange={onFilters}
                  />
                ) : (
                  t("Date")
                )}
              </span>
              <span className="min-w-0">
                {filters && onFilters ? (
                  <GitGraphColumnFilter
                    label="SHA"
                    field="sha"
                    filters={filters}
                    onChange={onFilters}
                  />
                ) : (
                  "SHA"
                )}
              </span>
            </Text>
          ) : null}
          {empty}
          <ul
            hidden={!!empty}
            className="min-w-0 max-w-full"
            style={{ minWidth: workspace ? 360 + graphWidth : undefined }}
            onKeyDown={onKeyDown}
          >
            {range.padTop > 0 ? <li aria-hidden style={{ height: range.padTop }} /> : null}
            {items.slice(range.start, range.end).map((item) => {
              const { commit } = item;
              const rowProps = {
                item,
                plain,
                now,
                active: selectedSha === commit.sha,
                suspendHover,
                side: wide ? ("bottom" as const) : ("right" as const),
                onOpen: openRow,
                onMenu: menuRow,
              };
              return wide ? (
                <WideRow key={commit.sha} {...rowProps} columns={columns} workspace={workspace} />
              ) : (
                <CompactRow key={commit.sha} {...rowProps} />
              );
            })}
            {range.padBottom > 0 ? <li aria-hidden style={{ height: range.padBottom }} /> : null}
          </ul>
          <CollectionFooter
            standalone
            hasMore={hasMore}
            onLoadMore={onLoadMore}
            loadMoreLabel={t("Load more commits")}
            loadMoreButtonProps={{
              variant: "item",
              motion: "none",
              type: "button",
              className: LOAD_MORE_CLASS,
            }}
          />
        </>
      )}
    </div>
  );
}

type RowProps = {
  item: GraphListItem;
  plain: boolean;
  now: number;
  active: boolean;
  /** A context menu is open: no hover card while it is. */
  suspendHover: boolean;
  side: "right" | "bottom";
  onOpen: (sha: string, pin?: boolean) => void;
  onMenu?: (sha: string, x: number, y: number) => void;
};

/**
 * One hover card per row (shared hover intent, 300 ms rest, the pointer may cross onto the card);
 * only the hovered row ever mounts the card content. No `title` on the row: the card carries
 * the details, and a tooltip would open on top of it.
 */
function useRowHoverCard({ side, suspendHover }: RowProps) {
  return useHoverCard({
    side,
    align: "start",
    width: 320,
    disabled: suspendHover,
    "aria-label": t("Commit details"),
    className: "space-y-2 p-3",
  });
}

function rowButtonProps(
  { item, active, onOpen, onMenu }: RowProps,
  hover: ReturnType<typeof useRowHoverCard>,
) {
  const { row } = item;
  return {
    type: "button" as const,
    ...hover.trigger,
    onClick: () => {
      hover.close();
      onOpen(item.commit.sha);
    },
    onDoubleClick: () => {
      hover.close();
      onOpen(item.commit.sha, true);
    },
    onContextMenu: onMenu
      ? (event: ReactMouseEvent) => {
          event.preventDefault();
          hover.close();
          onMenu(item.commit.sha, event.clientX, event.clientY);
        }
      : undefined,
    "aria-pressed": active,
    className: `git-history-item min-w-0 w-full overflow-visible text-left ${
      row.kind === "HEAD" ? "is-head" : ""
    } ${active ? "is-selected" : ""}`,
  };
}

/** The commit subject on one line: HEAD in medium weight, merges dimmed, the row's own height. */
function Subject({ item, className }: { item: GraphListItem; className?: string }) {
  const { commit, row } = item;
  return (
    <Text
      as="span"
      size="caption"
      leading="relaxed"
      weight={row.kind === "HEAD" ? "medium" : undefined}
      tone={row.kind !== "HEAD" && isMergeCommit(commit) ? "secondary" : "inherit"}
      truncate
      className={className}
    >
      {commit.subject || commit.shortSha}
    </Text>
  );
}

const CompactRow = memo(function CompactRow(props: RowProps) {
  useLocale();
  const { item, plain, now } = props;
  const { commit, row } = item;
  const refs = useMemo(() => orderGraphRefs(row.refs, commit.head), [row.refs, commit.head]);
  const hover = useRowHoverCard(props);
  const button = rowButtonProps(props, hover);
  return (
    // The row is the container the author and date hide against.
    <li className="git-graph-row min-w-0 overflow-visible" style={{ height: GRAPH_ROW_PX }}>
      <Button
        variant="item"
        motion="none"
        {...button}
        className={`${button.className} flex h-full items-stretch`}
      >
        {plain ? null : <GraphLane row={row} />}
        <span className="ml-1 flex min-w-0 flex-1 items-center">
          <Subject item={item} />
        </span>
        <RefPills
          refs={refs}
          budgetPx={110}
          maxWidth="40cqw"
          className="ml-1 shrink-0 self-center"
        />
        <GraphAvatar name={commit.author} className="git-graph-author ml-1.5 self-center" />
        <Text
          as="span"
          size="caption"
          tone="secondary"
          leading="relaxed"
          title={formatAbsoluteTime(commit.timestamp)}
          className="git-graph-date ml-1.5 w-7 shrink-0 text-right"
        >
          {formatRelativeTime(commit.timestamp, now)}
        </Text>
      </Button>
      {hover.card(<GitGraphHoverCard commit={commit} row={row} />)}
    </li>
  );
});

const WideRow = memo(function WideRow(props: RowProps & { columns: string; workspace?: boolean }) {
  useLocale();
  const { item, plain, now, columns, workspace } = props;
  const { commit, row } = item;
  const refs = useMemo(() => orderGraphRefs(row.refs, commit.head), [row.refs, commit.head]);
  const hover = useRowHoverCard(props);
  const button = rowButtonProps(props, hover);
  const dim = isMergeCommit(commit) && row.kind !== "HEAD" ? "text-[var(--ui-text-secondary)]" : "";
  return (
    <li className="min-w-0 overflow-visible" style={{ height: GRAPH_ROW_PX }}>
      <Button
        variant="item"
        motion="none"
        {...button}
        className={`${button.className} grid h-full items-center ${workspace ? styles.workspaceRow : ""}`}
        style={workspace ? undefined : { gridTemplateColumns: columns }}
      >
        {!workspace ? (
          <span className="flex min-w-0 items-center pr-1 pl-3">
            <RefPills refs={refs} budgetPx={workspace ? 104 : WIDE_REFS_PX - 16} maxWidth="100%" />
          </span>
        ) : null}
        <span className="flex h-full min-w-0 items-stretch overflow-x-clip">
          {plain ? null : <GraphLane row={row} />}
        </span>
        {workspace ? (
          <span className={styles.subject}>
            <RefPills refs={refs} budgetPx={200} maxWidth="40%" className="shrink-0" />
            <Subject item={item} />
          </span>
        ) : (
          <Subject item={item} className="pl-1" />
        )}
        {workspace ? (
          <OverflowTooltip label={commit.author}>
            <Text size="inherit" tone="secondary" truncate className={styles.author}>
              {commit.author}
            </Text>
          </OverflowTooltip>
        ) : null}
        {!workspace ? (
          <span className={`flex min-w-0 items-center gap-1.5 pr-2 ${dim}`}>
            <GraphAvatar name={commit.author} />
            <Text size="caption" tone="secondary" truncate className="min-w-0">
              {commit.author}
            </Text>
          </span>
        ) : null}
        {
          <Text
            title={formatAbsoluteTime(commit.timestamp)}
            size="caption"
            tone="secondary"
            truncate
            className={`${workspace ? styles.date : ""}`}
          >
            {formatRelativeTime(commit.timestamp, now)}
          </Text>
        }
        <Text as="span" size="micro" tone="secondary" truncate>
          <Code size="inherit">{commit.shortSha}</Code>
        </Text>
      </Button>
      {hover.card(<GitGraphHoverCard commit={commit} row={row} />)}
    </li>
  );
});
