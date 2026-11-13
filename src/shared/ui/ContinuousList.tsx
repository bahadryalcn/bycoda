import { useCallback, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  COLLECTION_WINDOW_THRESHOLD,
  useCollectionVirtualizer,
} from "../hooks/useCollectionVirtualizer";
import { useRetainedScroll } from "../hooks/useRetainedScroll";
import { useRetainedState } from "../hooks/useRetainedState";
import { useT } from "../i18n";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import styles from "./ContinuousList.module.css";
import { scrollAreaAttributes, type ScrollAreaProps } from "./ScrollArea";

export type CollectionFooterProps = {
  loading?: boolean;
  error?: string | null;
  partial?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
  /** Render only the continuation button where the surrounding list owns layout. */
  standalone?: boolean;
  loadMoreLabel?: ReactNode;
  loadMoreButtonProps?: Omit<ComponentProps<typeof Button>, "children" | "onClick" | "iconOnly">;
};

/**
 * Footer for a loaded collection: spinner, error and partial-result Alerts, Retry, empty text and an explicit "Load more". A failed continuation never hides loaded rows; `standalone` renders only the Load more button.
 * @group data
 * @use Explicit remote continuation state under any list or table.
 * @avoid Page-level load failure: FailureState. Virtualized rows plus continuation: ContinuousList.
 */
export function CollectionFooter({
  loading,
  error,
  partial,
  empty,
  emptyMessage,
  hasMore,
  onLoadMore,
  onRetry,
  standalone = false,
  loadMoreLabel,
  loadMoreButtonProps,
}: CollectionFooterProps) {
  const t = useT();
  if (standalone) {
    return hasMore ? (
      <Button variant="ghost" size="sm" {...loadMoreButtonProps} onClick={onLoadMore}>
        {loadMoreLabel ?? t("Load more")}
      </Button>
    ) : null;
  }
  return (
    <div className={styles.footer} data-collection-footer>
      {loading && !(hasMore && onLoadMore) && !(error && onRetry) ? (
        <Spinner label={t("Loading…")} />
      ) : null}
      {error ? <Alert inline tone="danger" title={error} /> : null}
      {partial ? <Alert inline tone="warning" title={partial} /> : null}
      {error && onRetry ? (
        <Button variant="ghost" size="sm" loading={loading} onClick={onRetry}>
          {t("Retry")}
        </Button>
      ) : null}
      {empty && !loading && !error ? <span>{emptyMessage ?? t("No records")}</span> : null}
      {hasMore && onLoadMore ? (
        <Button variant="ghost" size="sm" loading={loading} disabled={loading} onClick={onLoadMore}>
          {t("Load more")}
        </Button>
      ) : null}
    </div>
  );
}

export type ContinuousListProps<T> = CollectionFooterProps & {
  /** Request one remote page near the scroll end. Errors pause automatic retries. */
  loadOnScroll?: boolean;
  items: readonly T[];
  itemKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /**
   * Scopes remount and retained scroll: include machine/account/project and structural filters.
   * Free-text search should filter `items` in place rather than change this key, because each
   * key change remounts the list and mints a retained scroll entry; never use fetched result identity.
   */
  stateKey: string;
  estimateSize?: number;
  /** Reserve scrollbar space without changing the virtualizer's scroll owner. Unset keeps its gutter. */
  gutter?: ScrollAreaProps["gutter"];
  className?: string;
  /** Compound settings rows: shared hover/focus fill and hairlines between logical items.
   * The collection wrapper owns these states so virtualized rows keep the same presentation. */
  rowAppearance?: "settings";
  /** Fill an already bounded flex pane instead of imposing a settings-list height. */
  fill?: boolean;
  label?: string;
  requiredKey?: string | null;
};

/**
 * A finite DOM window over the full loaded collection, with variable-height rows, retained scroll per `stateKey` and a built-in CollectionFooter. Pass a stable `itemKey`; free-text search filters `items` rather than changing `stateKey`.
 * `fill` fills an already bounded flex pane.
 * @group data
 * @use Long or growing record lists (inbox, threads, boards) that load more on demand.
 * @avoid Short fixed lists: map them in a plain list. Tree data: TreeView. Tabular records with columns: DataTable.
 */
export function ContinuousList<T>(props: ContinuousListProps<T>) {
  return <ContinuousListWindow key={props.stateKey} {...props} />;
}

function ContinuousListWindow<T>({
  items,
  itemKey,
  renderItem,
  stateKey,
  estimateSize = 64,
  gutter,
  className,
  rowAppearance,
  requiredKey,
  fill,
  label,
  loadOnScroll,
  ...footer
}: ContinuousListProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const retainedRef = useRetainedScroll<HTMLDivElement>(stateKey, { ready: items.length > 0 });
  const [position] = useRetainedState(`${stateKey}:scroll`, () => ({ top: 0, left: 0 }), "view");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const requiredIndex = items.findIndex((item) => itemKey(item) === requiredKey);
  const focusedIndex = items.findIndex((item) => itemKey(item) === focusedKey);
  const virtual = items.length > COLLECTION_WINDOW_THRESHOLD;
  const virtualizer = useCollectionVirtualizer({
    count: items.length,
    enabled: virtual,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => itemKey(items[index]),
    initialRect: { width: 640, height: 480 },
    initialOffset: () => position.top,
    overscan: 6,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(requiredIndex >= 0 ? [requiredIndex] : []),
          ...(focusedIndex >= 0 ? [focusedIndex] : []),
        ]),
      ].sort((a, b) => a - b),
  });
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      retainedRef(node);
    },
    [retainedRef],
  );
  const windows = virtualizer.getVirtualItems();
  const requestAtEnd = (event: { currentTarget: HTMLDivElement }) => {
    const node = event.currentTarget;
    if (
      footer.hasMore &&
      !footer.loading &&
      !footer.error &&
      node.scrollHeight - node.scrollTop - node.clientHeight < 160
    )
      footer.onLoadMore?.();
  };
  return (
    <div
      ref={ref}
      {...(gutter
        ? scrollAreaAttributes({ gutter }, [styles.scroller, className].filter(Boolean).join(" "))
        : { className: [styles.scroller, className].filter(Boolean).join(" ") })}
      data-continuous-list={stateKey}
      data-fill={fill || undefined}
      onScroll={loadOnScroll ? requestAtEnd : undefined}
      onWheel={loadOnScroll ? requestAtEnd : undefined}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Native scroll viewport must remain keyboard-focusable.
      tabIndex={0}
    >
      <div
        className={styles.items}
        role={label ? "list" : undefined}
        aria-label={label}
        style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
      >
        {(virtual ? windows : items.map((_, index) => ({ index, start: 0 }))).map((row) => {
          const item = items[row.index];
          const key = itemKey(item);
          return (
            <div
              key={key}
              data-index={row.index}
              data-collection-key={key}
              data-row-appearance={rowAppearance}
              data-row-divider={
                rowAppearance === "settings" ? (row.index > 0 ? "" : undefined) : undefined
              }
              role={label ? "listitem" : undefined}
              aria-posinset={label ? row.index + 1 : undefined}
              aria-setsize={label ? items.length : undefined}
              ref={virtual ? virtualizer.measureElement : undefined}
              className={[virtual && styles.virtualRow, rowAppearance && styles.settingsRow]
                .filter(Boolean)
                .join(" ")}
              style={virtual ? { transform: `translateY(${row.start}px)` } : undefined}
              onFocusCapture={() => setFocusedKey(key)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setFocusedKey(null);
              }}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
      <CollectionFooter
        {...footer}
        hasMore={loadOnScroll ? false : footer.hasMore}
        empty={items.length === 0}
      />
    </div>
  );
}
