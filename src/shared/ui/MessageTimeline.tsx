import type { FocusEvent, ReactNode } from "react";
import { useTimelineWindow } from "../hooks/useTimelineWindow";
import { useLocale, useT } from "../i18n";
import { dateTimeFormat } from "../lib/intl";
import { useToday } from "./arc/lib/use-today";
import { Divider } from "./Divider";
import { Text } from "./Text";
import { Timestamp } from "./Timestamp";
import styles from "./MessageTimeline.module.css";

export type MessageTimelineItem = {
  id: string;
  /** Shown under the bubble for other people's messages; the owner's never show a name. */
  author?: string;
  /** The owner's own message: end-aligned in the prompt-bubble skin. */
  own?: boolean;
  /** Reply that reads as page text (the assistant's answers): no bubble fill, full width. */
  plain?: boolean;
  /** Epoch milliseconds; drives the day separators and the time under the bubble. */
  time: number;
  body: ReactNode;
  /** Chips or files under the bubble. */
  attachments?: ReactNode;
  /** Extra meta after the time ("Voice"). */
  meta?: ReactNode;
  /** Hover actions on the meta line. */
  actions?: ReactNode;
};

const noKeys: readonly string[] = [];

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** "Today", "Yesterday" or a short date for the separator above a day of messages. */
export function messageDayLabel(
  at: number,
  now: number,
  translate: (key: "Today" | "Yesterday") => string,
  locale: string,
): string {
  if (dayKey(at) === dayKey(now)) return translate("Today");
  const today = new Date(now);
  if (
    dayKey(at) ===
    dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime())
  )
    return translate("Yesterday");
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return dateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

/**
 * The one message thread: oldest first, a centered day separator between days, the owner's
 * messages end-aligned and others start-aligned in the same quiet bubble the transcript uses
 * for the user's prompt, and author (others only), time and optional actions under the bubble.
 * The caller owns data, scrolling and the composer. With `windowed`, a long list (past the shared
 * collection threshold) mounts only the rows near the nearest scrolling ancestor, plus the focused
 * row; rows keep a stable `item` identity so unchanged messages skip rendering.
 * @group data
 * @use Any message conversation: email or chat threads, the social inbox, the assistant room.
 * @avoid Agent session transcript: AgentTranscript. Event history that is not a conversation: Timeline.
 */
export function MessageTimeline({
  items,
  label,
  className,
  windowed = false,
  onSizeChange,
}: {
  items: readonly MessageTimelineItem[];
  /** Accessible name of the list. */
  label: string;
  className?: string;
  /** Mount only the rows near the viewport of a long list. The scroller must be an ancestor. */
  windowed?: boolean;
  /** Windowed only: called after measured rows change the content height. */
  onSizeChange?: () => void;
}) {
  const locale = useLocale();
  const translate = useT();
  // Today turns over at local midnight, so the separators follow it.
  const now = useToday()?.getTime() ?? 0;
  const {
    windowed: hasWindow,
    indexes,
    padStart,
    padEnd,
    attachList,
    measureRow,
    focus,
  } = useTimelineWindow({
    keys: windowed ? items.map((item) => item.id) : noKeys,
    onSizeChange,
  });
  return (
    <ol
      ref={attachList}
      className={[styles.timeline, className].filter(Boolean).join(" ")}
      aria-label={label}
      style={
        hasWindow
          ? {
              paddingBlockStart: padStart,
              paddingBlockEnd: padEnd,
              // The window owns scroll corrections for rows that appear above the reader.
              overflowAnchor: "none",
            }
          : undefined
      }
    >
      {(hasWindow ? indexes : items.map((_, index) => index)).flatMap((index) => {
        const item = items[index];
        const separator = index === 0 || dayKey(items[index - 1].time) !== dayKey(item.time);
        return [
          separator ? (
            <Text
              as="li"
              size="caption"
              tone="muted"
              leading="inherit"
              key={`day-${item.id}`}
              data-timeline-day=""
            >
              <Divider
                label={messageDayLabel(item.time, now, translate, locale)}
                className={styles.day}
              />
            </Text>
          ) : null,
          <li
            key={item.id}
            className={`${styles.message}${item.actions ? " message-hover-zone" : ""}`}
            data-message-id={item.id}
            data-own={item.own ? "true" : undefined}
            data-plain={item.plain ? "true" : undefined}
            {...(hasWindow
              ? {
                  ref: measureRow,
                  "data-index": index,
                  "aria-posinset": index + 1,
                  "aria-setsize": items.length,
                  onFocusCapture: () => focus(item.id),
                  onBlurCapture: (event: FocusEvent<HTMLLIElement>) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      focus(null);
                  },
                }
              : {})}
          >
            <Text as="div" size="body" tone="secondary" className={styles.bubble} dir="auto">
              {item.body}
            </Text>
            {item.attachments ? <div className={styles.attachments}>{item.attachments}</div> : null}
            <Text as="div" size="caption" tone="muted" leading="inherit" className={styles.meta}>
              {item.own || !item.author ? null : (
                <Text as="span" size="inherit" tone="secondary" weight="medium">
                  {item.author}
                </Text>
              )}
              <Timestamp value={item.time} format="time" tooltip={false} className={styles.time} />
              {item.meta}
              {item.actions ? (
                <div className={`${styles.actions} message-hover-actions`}>{item.actions}</div>
              ) : null}
            </Text>
          </li>,
        ];
      })}
    </ol>
  );
}
