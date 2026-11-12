import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { ClampText } from "../../../../shared/ui/ClampText";
import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
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

/** Week or month grid of planned, sent and failed posts. A day opens the editor on that day. */
export function ContentCalendar({
  view,
  anchor,
  entries,
  onPickDay,
  onOpen,
}: ContentCalendarProps) {
  const days = view === "week" ? weekDays(anchor) : monthCells(anchor);
  const byDay = entriesByDay(entries);
  const now = wallClockNow();
  const month = new Date(anchor).getMonth();
  return (
    <div
      {...surfaceAttributes({ frame: "pane", edge: "all", radius: "card" }, "content-calendar")}
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
      <div className="content-calendar-grid">
        {days.map((day) => {
          const key = dayKey(day);
          const dayEntries = byDay.get(key) ?? [];
          const { shown, more } =
            view === "month"
              ? splitMonthEntries(dayEntries, MAX_MONTH_ENTRIES)
              : { shown: dayEntries, more: 0 };
          const outside = view === "month" && new Date(day).getMonth() !== month;
          const today = isToday(day, now);
          return (
            <section
              key={key}
              className="content-day"
              data-today={today || undefined}
              data-outside={outside || undefined}
              aria-label={formatDate(day, { weekday: "long", day: "numeric", month: "long" })}
            >
              <div className="content-day-head">
                <span className="content-day-title" aria-hidden="true">
                  {view === "week" ? (
                    <Text
                      size="caption"
                      tone="muted"
                      leading="inherit"
                      className="content-day-weekday"
                    >
                      {formatDate(day, { weekday: "short" })}
                    </Text>
                  ) : null}
                  <Text
                    as="span"
                    size={view === "month" ? "secondary" : "title"}
                    tone={today ? "accent-on-solid" : outside ? "muted" : "inherit"}
                    leading="none"
                    {...surfaceAttributes({ radius: "pill" }, "content-day-number")}
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
                <ActionHost key={entry.id} className="content-chip-host">
                  <Button
                    variant="item"
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
              {more ? (
                <Text size="caption" tone="muted" leading="inherit" className="content-entry-more">
                  {t("{p0} more", { p0: more })}
                </Text>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
