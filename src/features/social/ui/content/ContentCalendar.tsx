import { formatDate, t } from "../../../../shared/i18n";
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
  const now = Date.now();
  const month = new Date(anchor).getMonth();
  return (
    <div className="content-calendar" data-view={view}>
      {view === "month" ? (
        <div className="content-calendar-weekdays" aria-hidden="true">
          {days.slice(0, 7).map((day) => (
            <span key={day}>{formatDate(day, { weekday: "short" })}</span>
          ))}
        </div>
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
                    <span className="content-day-weekday">
                      {formatDate(day, { weekday: "short" })}
                    </span>
                  ) : null}
                  <span className="content-day-number">{formatDate(day, { day: "numeric" })}</span>
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
                      <span className="content-chip-head">
                        {entry.platform ? (
                          <PlatformIcon platform={entry.platform} className="icon-xs" />
                        ) : null}
                        <span className="content-entry-time">
                          {formatDate(entry.at, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </span>
                      <span className="content-entry-text">
                        {entry.text.trim() || t("Media post")}
                      </span>
                      <ContentStateDot state={entry.status} />
                    </span>
                  </Button>
                </ActionHost>
              ))}
              {more ? (
                <span className="content-entry-more">{t("{p0} more", { p0: more })}</span>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
