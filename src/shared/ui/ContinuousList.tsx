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

/** Remote continuation stays explicit; a failed continuation never hides loaded rows. */
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
  items: readonly T[];
  itemKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Include machine/account/project, query and filters; never use fetched result identity. */
  stateKey: string;
  estimateSize?: number;
  className?: string;
  /** Fill an already bounded flex pane instead of imposing a settings-list height. */
  fill?: boolean;
  label?: string;
  requiredKey?: string | null;
};

/** A finite DOM window over the full loaded collection, with variable-height rows. */
export function ContinuousList<T>(props: ContinuousListProps<T>) {
  return <ContinuousListWindow key={props.stateKey} {...props} />;
}

function ContinuousListWindow<T>({
  items,
  itemKey,
  renderItem,
  stateKey,
  estimateSize = 64,
  className,
  requiredKey,
  fill,
  label,
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
  return (
    <div
      ref={ref}
      className={[styles.scroller, className].filter(Boolean).join(" ")}
      data-continuous-list={stateKey}
      data-fill={fill || undefined}
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
              role={label ? "listitem" : undefined}
              aria-posinset={label ? row.index + 1 : undefined}
              aria-setsize={label ? items.length : undefined}
              ref={virtual ? virtualizer.measureElement : undefined}
              className={virtual ? styles.virtualRow : undefined}
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
      <CollectionFooter {...footer} empty={items.length === 0} />
    </div>
  );
}
