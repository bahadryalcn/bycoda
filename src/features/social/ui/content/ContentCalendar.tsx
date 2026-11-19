import { useState } from "react";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { ClampText } from "../../../../shared/ui/ClampText";
import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { useMinuteNow } from "../../../../shared/hooks/useMinuteNow";
import { ActionHost } from "../../../../shared/ui/ActionHost";
import { Button } from "../../../../shared/ui/Button";
import { Plus } from "../../../../shared/ui/icons";
import { PlatformIcon } from "../common/PlatformIcon";
import {
  dayKey,
  entriesByDay,
  isToday,
  monthCells,
  splitMonthEntries,
  startOfDay,
  weekDays,
  type CalendarEntry,
} from "./calendarModel";
import { ContentStateDot } from "./ContentStatus";

export type ContentCalendarProps = {
  view: "week" | "month";
  anchor: number;
  entries: CalendarEntry[];
  onPickDay: (day: number) => void;
  onOpen: (campaignId: string) => void;
};

const MAX_MONTH_ENTRIES = 3;

function toggleDay(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Week or month grid of planned, sent and failed posts. A day opens the editor on that day. */
export function ContentCalendar({
  view,
  anchor,
  entries,
  onPickDay,
  onOpen,
}: ContentCalendarProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const days = view === "week" ? weekDays(anchor) : monthCells(anchor);
  const byDay = entriesByDay(entries);
  // Minute-floored clock: "today" moves to the new day at local midnight while the calendar stays open.
  const now = useMinuteNow();
  const month = new Date(anchor).getMonth();
  return (
    <div
      {...surfaceAttributes(
        { variant: "card", frame: "pane", edge: "all", radius: "card" },
        "content-calendar",
      )}
      data-view={view}
    >
      {view === "month" ? (
        <Text
          as="div"
          size="caption"
          tone="muted"
          leading="inherit"
          weight="medium"
          {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "content-calendar-weekdays")}
          aria-hidden="true"
        >
          {days.slice(0, 7).map((day) => (
            <span key={day}>{formatDate(day, { weekday: "short" })}</span>
          ))}
        </Text>
      ) : null}
      <div className="content-calendar-grid" role="list">
        {days.map((day, index) => {
          const key = dayKey(day);
          const dayEntries = byDay.get(key) ?? [];
          const expanded = expandedDays.has(key);
          const overflow = view === "month" && dayEntries.length > MAX_MONTH_ENTRIES;
          const { shown, more } =
            view === "month" && !expanded
              ? splitMonthEntries(dayEntries, MAX_MONTH_ENTRIES)
              : { shown: dayEntries, more: 0 };
          const outside = view === "month" && new Date(day).getMonth() !== month;
          const today = isToday(day, now);
          return (
            <div
              key={key}
              role="listitem"
              {...surfaceAttributes(
                {
                  frame: index ? "pane" : undefined,
                  edge: index >= 7 ? (index % 7 ? "start" : "block-start") : "responsive-start",
                  variant: today ? "inset" : undefined,
                },
                "content-day",
              )}
              data-today={today || undefined}
              data-outside={outside || undefined}
              aria-current={today ? "date" : undefined}
            >
              <div className="content-day-head">
                {/* The full date is the day's accessible name; the visible number and weekday are decoration. */}
                <span className="sr-only">
                  {formatDate(day, { weekday: "long", day: "numeric", month: "long" })}
                </span>
                <span className="content-day-title" aria-hidden="true">
                  <Text
                    size="caption"
                    tone={view === "month" && today ? "accent-on-solid" : "muted"}
                    leading="inherit"
                    {...surfaceAttributes(
                      view === "month" && today
                        ? { radius: "pill", tone: "accent", toneFill: "solid" }
                        : {},
                      "content-day-weekday",
                    )}
                  >
                    {formatDate(
                      day,
                      view === "month"
                        ? { weekday: "short", day: "numeric", month: "short" }
                        : { weekday: "short" },
                    )}
                  </Text>
                  <Text
                    as="span"
                    size={view === "month" ? "secondary" : "title"}
                    tone={today ? "accent-on-solid" : outside ? "muted" : "inherit"}
                    leading="none"
                    {...surfaceAttributes(
                      {
                        radius: "pill",
                        tone: today ? "accent" : undefined,
                        toneFill: today ? "solid" : undefined,
                      },
                      "content-day-number",
                    )}
                  >
                    {formatDate(day, { day: "numeric" })}
                  </Text>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="content-day-add"
                  label={t("New post on {p0}", {
                    p0: formatDate(day, { day: "numeric", month: "short" }),
                  })}
                  onClick={() => onPickDay(startOfDay(day))}
                >
                  <Plus className="icon-xs" aria-hidden />
                </Button>
              </div>
              {shown.map((entry) => (
                <ActionHost
                  key={entry.id}
                  ground="var(--ui-fill-subtle)"
                  {...surfaceAttributes({ radius: "control" }, "content-chip-host")}
                >
                  <Button
                    variant="item"
                    layout="stacked"
                    fullWidth
                    align="start"
                    size="sm"
                    className="content-entry"
                    onClick={() => onOpen(entry.campaignId)}
                  >
                    <span className="content-chip">
                      <Text size="inherit" tone="secondary" className="content-chip-head">
                        {entry.platform ? (
                          <PlatformIcon platform={entry.platform} className="icon-xs" />
                        ) : null}
                        <Text
                          size="caption"
                          tone="secondary"
                          leading="inherit"
                          className="content-entry-time"
                        >
                          {formatDate(entry.at, { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      </Text>
                      <ClampText
                        as="span"
                        lines={view === "month" ? 1 : 2}
                        expandable={false}
                        size="caption"
                        tone="primary"
                        leading="inherit"
                        className="content-entry-text"
                      >
                        {entry.text.trim() || t("Media post")}
                      </ClampText>
                      <ContentStateDot state={entry.status} />
                    </span>
                  </Button>
                </ActionHost>
              ))}
              {overflow ? (
                <Button
                  variant="link"
                  layout="text"
                  aria-expanded={expanded}
                  label={
                    expanded
                      ? t("Show fewer posts on {p0}", {
                          p0: formatDate(day, { day: "numeric", month: "long" }),
                        })
                      : t("Show all posts on {p0}", {
                          p0: formatDate(day, { day: "numeric", month: "long" }),
                        })
                  }
                  onClick={() => setExpandedDays((current) => toggleDay(current, key))}
                >
                  {expanded ? t("Show less") : t("{p0} more", { p0: more })}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
