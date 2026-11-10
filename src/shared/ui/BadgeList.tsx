import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useT } from "../i18n";
import { Badge, type BadgeAppearance, type BadgeTone } from "./Badge";
import styles from "./BadgeList.module.css";
import { Button } from "./Button";
import { useHoverCard } from "./HoverCard";
import { Popover } from "./Popover";
import { OverflowTooltip } from "./Tooltip";

export type BadgeListItem = {
  id: string;
  /** Visible text. A long label truncates in place; the full text stays in the overflow hint. */
  label: string;
  icon?: ReactNode;
  /** Full text for the overflow hint when it differs from `label` (for example a role behind a name). */
  title?: string;
  /** Overrides the list `tone` for this item. */
  tone?: BadgeTone;
};

export type BadgeListProps = {
  items: readonly BadgeListItem[];
  /** Accessible name of the list and heading of the overflow card, for example "Specialists". */
  label: string;
  /**
   * `fit` (default) shows as many whole badges as fit on `rows` lines and keeps room for the
   * "+N" trigger. A number shows at most that many. Without layout (tests, server) `fit` shows all.
   */
  max?: number | "fit";
  /** Lines `fit` may use. Default 1. */
  rows?: number;
  size?: "xs" | "sm";
  /** Default `subtle`: member and tag lists read as quiet metadata, not as status. */
  appearance?: BadgeAppearance;
  tone?: BadgeTone;
  className?: string;
};

const GAP_FALLBACK = 4;

/**
 * How many leading items fit on `rows` lines when the rest collapses into a "+N" trigger of
 * `moreWidth`. Returns `widths.length` when everything fits without a trigger. Pure, so the
 * packing can be tested without layout. An item wider than its line is truncated, so it is
 * measured as at most the line (less the trigger while the trigger is shown).
 */
export function fitBadgeCount(
  widths: readonly number[],
  moreWidth: number,
  available: number,
  gap: number,
  rows: number,
): number {
  const lines = (count: number, withMore: boolean) => {
    const cap = withMore ? Math.max(available - gap - moreWidth, 0) : available;
    let line = 1;
    let used = 0;
    const place = (width: number) => {
      const needed = used > 0 ? gap + width : width;
      if (used > 0 && used + needed > available) {
        line += 1;
        used = width;
      } else {
        used += needed;
      }
    };
    for (let index = 0; index < count; index += 1) place(Math.min(widths[index] ?? 0, cap));
    if (withMore) place(moreWidth);
    return line;
  };
  const total = widths.length;
  if (lines(total, false) <= rows) return total;
  for (let count = total - 1; count > 0; count -= 1) {
    if (lines(count, true) <= rows) return count;
  }
  return 0;
}

type Fit = { count: number; reserve: number };

/**
 * Names, tags and other short metadata as a row of Badges. What does not fit collapses into a "+N" button: hover or focus previews the hidden items in a card, click pins it until Escape or outside press. Long labels truncate and recover full text via the overflow hint.
 * `max` is `fit` (default, whole badges that fit `rows` lines) or a number. Renders nothing without items; the caller decides the empty text.
 * Set `--badge-list-item-max` through `className` (e.g. `[--badge-list-item-max:16rem]`) so one long label cannot fill a row.
 * @group data
 * @use Several names, groups or tags in a bounded space instead of comma-joined text or a hand-written "+N".
 * @avoid One badge: Badge. Editable tags: TagInput. Status of a run: StatusBadge.
 */
export function BadgeList({
  items,
  label,
  max = "fit",
  rows = 1,
  size = "sm",
  appearance = "subtle",
  tone = "neutral",
  className,
}: BadgeListProps) {
  const t = useT();
  const listId = useId();
  const moreId = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [pinned, setPinned] = useState(false);
  const hover = useHoverCard({
    side: "bottom",
    align: "start",
    disabled: pinned,
    className: "max-w-80 p-0",
    "aria-label": label,
  });

  const auto = max === "fit";
  const signature = items.map((item) => `${item.id}\u0000${item.label}`).join("\u0001");

  useLayoutEffect(() => {
    if (!auto) return;
    const host = root.current;
    const measured = probe.current;
    const flow = list.current;
    if (!host || !measured || !flow) return;
    const measure = () => {
      // Layout width, not the transformed box: a dialog that scales in must not skew the packing.
      const available = host.offsetWidth - 1;
      const scale =
        host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth : 1;
      const read = (node: Element) => node.getBoundingClientRect().width / (scale || 1);
      const widths = Array.from(measured.querySelectorAll("[data-probe-item]"), read);
      const more = measured.querySelector("[data-probe-more]");
      const moreWidth = more ? read(more) : 0;
      if (available <= 0 || !widths.length || widths.some((width) => !(width > 0))) {
        setFit((previous) => (previous === null ? previous : null));
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(flow).columnGap) || GAP_FALLBACK;
      const count = fitBadgeCount(widths, moreWidth, available, gap, Math.max(1, rows));
      const reserve = count < widths.length ? moreWidth + gap : 0;
      setFit((previous) =>
        previous && previous.count === count && previous.reserve === reserve
          ? previous
          : { count, reserve },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(measured.firstElementChild ?? measured);
    return () => observer.disconnect();
  }, [auto, rows, signature, size, appearance]);

  if (!items.length) return null;

  const limit =
    max === "fit" ? (fit ? Math.min(fit.count, items.length) : items.length) : Math.max(0, max);
  const shown = items.slice(0, limit);
  const hidden = items.slice(shown.length);
  const reserve = auto && hidden.length > 0 ? (fit?.reserve ?? 0) : 0;

  const badge = (item: BadgeListItem) => (
    <Badge
      size={size}
      appearance={appearance}
      tone={item.tone ?? tone}
      icon={item.icon}
      className={styles.badge}
    >
      {/* A label clipped by the row or `--badge-list-item-max` shows in full on hover/focus. */}
      <OverflowTooltip label={item.title ?? item.label} side="top">
        <span className={styles.text}>{item.label}</span>
      </OverflowTooltip>
    </Badge>
  );

  const moreLabel = (count: number) => t("{p0} more", { p0: count });
  const moreClass = [styles.more, size === "xs" ? styles.moreXs : ""].filter(Boolean).join(" ");

  const card = (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{label}</div>
      <ul role="list" className={styles.cardList}>
        {hidden.map((item) => (
          <li key={item.id} className={styles.cardItem}>
            {item.icon ? (
              <span className={styles.cardIcon} aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className={styles.cardText}>{item.title ?? item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      ref={root}
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={reserve ? ({ "--badge-list-reserve": `${reserve}px` } as CSSProperties) : undefined}
    >
      <ul ref={list} role="list" id={listId} aria-label={label} className={styles.list}>
        {shown.map((item) => (
          <li key={item.id} className={styles.item}>
            {badge(item)}
          </li>
        ))}
        {hidden.length > 0 ? (
          <li className={styles.moreItem}>
            <Button
              ref={moreButton}
              id={moreId}
              variant="ghost"
              size="sm"
              inset="text"
              className={moreClass}
              aria-label={moreLabel(hidden.length)}
              aria-labelledby={`${listId} ${moreId}`}
              aria-haspopup="dialog"
              aria-expanded={pinned || hover.open}
              title=""
              {...hover.trigger}
              onClick={() => {
                hover.close();
                setPinned((current) => !current);
              }}
            >
              {`+${hidden.length}`}
            </Button>
            {hover.card(card)}
            {pinned ? (
              <Popover
                anchor={moreButton}
                side="bottom"
                align="start"
                kind="dialog"
                aria-label={label}
                tabIndex={-1}
                autoFocus
                onDismiss={(reason) => {
                  setPinned(false);
                  if (reason === "escape") moreButton.current?.focus({ preventScroll: true });
                }}
                className="max-w-80"
              >
                {card}
              </Popover>
            ) : null}
          </li>
        ) : null}
      </ul>
      {auto ? (
        <div ref={probe} className={styles.probe} aria-hidden="true" inert>
          <div className={styles.probeRow}>
            {items.map((item) => (
              <div key={item.id} data-probe-item="" className={styles.item}>
                {badge(item)}
              </div>
            ))}
            <div data-probe-more="" className={styles.moreItem}>
              <Button
                variant="ghost"
                size="sm"
                inset="text"
                className={moreClass}
                tabIndex={-1}
                title=""
                aria-label={moreLabel(items.length)}
              >
                {`+${items.length}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
