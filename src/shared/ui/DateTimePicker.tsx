import { useLocale, useT } from "../i18n";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Clock } from "./icons";
import { Button } from "./Button";
import { TextField } from "./TextField";
import "./DateTimePicker.css";

export function toLocalDateTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && toLocalDateTime(date) === value ? date : null;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  autoFocus?: boolean;
};

function dateKey(date: Date): string {
  return toLocalDateTime(date).slice(0, 10);
}

function shiftMonth(date: Date, amount: number): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + amount + 1, 0).getDate();
  return new Date(
    date.getFullYear(),
    date.getMonth() + amount,
    Math.min(date.getDate(), lastDay),
    12,
  );
}

export function DateTimePicker({ value, onChange, minDate, autoFocus = false }: Props) {
  const t = useT();
  const locale = useLocale();
  const today = new Date(Date.now());
  const selected = parseLocalDateTime(`${value.slice(0, 10)}T12:00`) ?? today;
  const minimum = minDate ? parseLocalDateTime(`${minDate}T12:00`) : null;
  const initial = minimum && selected < minimum ? minimum : selected;
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1, 12),
  );
  const [focusedDate, setFocusedDate] = useState(initial);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus);
  const minimumTime = minimum?.getTime();
  const selectedKey = value.slice(0, 10);
  const previousSelectedKey = useRef(selectedKey);
  useLayoutEffect(() => {
    const changed = previousSelectedKey.current !== selectedKey;
    previousSelectedKey.current = selectedKey;
    const date = changed
      ? (parseLocalDateTime(`${selectedKey}T12:00`) ?? focusedDate)
      : focusedDate;
    const next =
      minimumTime !== undefined && date.getTime() < minimumTime ? new Date(minimumTime) : date;
    if (next.getTime() === focusedDate.getTime()) return;
    shouldFocus.current = !!gridRef.current?.contains(document.activeElement);
    setFocusedDate(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
  }, [selectedKey, minimumTime, focusedDate]);
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { weekday: "short" });
    const long = new Intl.DateTimeFormat(locale, { weekday: "long" });
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(2024, 0, 1 + index, 12);
      return { short: short.format(date), long: long.format(date) };
    });
  }, [locale]);
  useLayoutEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [focusedDate, month]);
  const previousDisabled =
    !!minimum &&
    month.getFullYear() * 12 + month.getMonth() <= minimum.getFullYear() * 12 + minimum.getMonth();
  const monthLabel = month.toLocaleDateString(locale, { month: "long" });
  const headingId = useId();
  const timeId = useId();
  const timeHintId = useId();
  const time = value.includes("T") ? value.slice(value.indexOf("T") + 1) : "";
  const navigate = (date: Date, focus: boolean) => {
    const next = minimum && date < minimum ? minimum : date;
    shouldFocus.current = focus;
    setFocusedDate(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
  };
  const pick = (date: Date) => {
    setFocusedDate(date);
    onChange(`${dateKey(date)}T${time}`);
  };
  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const dayOffset = (date.getDay() + 6) % 7;
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -dayOffset,
      End: 6 - dayOffset,
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      pick(date);
      return;
    }
    let next: Date;
    if (event.key === "PageUp" || event.key === "PageDown") {
      next = shiftMonth(date, event.key === "PageUp" ? -1 : 1);
    } else if (event.key in offsets) {
      next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsets[event.key], 12);
    } else return;
    event.preventDefault();
    event.stopPropagation();
    navigate(next, true);
  };
  const offset = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) => {
    const number = i - offset + 1;
    return number > 0 && number <= count
      ? new Date(month.getFullYear(), month.getMonth(), number, 12)
      : null;
  });
  return (
    <div className="bycoda-date-time-picker">
      <div className="mb-2 flex min-h-8 items-center justify-between px-1">
        <span
          id={headingId}
          aria-live="polite"
          className="flex items-baseline gap-1.5 text-xs font-medium text-content"
        >
          {monthLabel}{" "}
          <span className="font-normal tabular-nums text-(--ui-text-secondary)">
            {month.getFullYear()}
          </span>
        </span>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            iconOnly
            label={t("Previous month")}
            disabled={previousDisabled}
            onClick={() => navigate(shiftMonth(focusedDate, -1), false)}
            className="date-time-month-action"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Next month")}
            onClick={() => navigate(shiftMonth(focusedDate, 1), false)}
            className="date-time-month-action"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="date-time-calendar">
        <div ref={gridRef} role="grid" aria-labelledby={headingId}>
          <div role="row" className="grid grid-cols-7">
            {weekdays.map((label) => (
              <span
                key={label.long}
                role="columnheader"
                aria-label={label.long}
                title={label.long}
                className="pb-1.5 text-center text-(length:--ui-font-caption) font-normal text-(--ui-text-secondary)"
              >
                {label.short}
              </span>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, week) => (
            <div role="row" key={week} className="grid grid-cols-7 py-0.5">
              {cells.slice(week * 7, week * 7 + 7).map((date, column) => (
                <div
                  role="gridcell"
                  key={column}
                  className="flex justify-center"
                  aria-selected={date ? dateKey(date) === selectedKey : undefined}
                >
                  {date ? (
                    <button
                      type="button"
                      aria-label={date.toLocaleDateString(locale, { dateStyle: "full" })}
                      data-date={dateKey(date)}
                      tabIndex={dateKey(date) === dateKey(focusedDate) ? 0 : -1}
                      onKeyDown={(event) => onDayKeyDown(event, date)}
                      title={date.toLocaleDateString(locale, {
                        dateStyle: "full",
                      })}
                      disabled={!!minimum && date < minimum}
                      aria-current={dateKey(date) === dateKey(today) ? "date" : undefined}
                      className="date-time-day relative rounded text-xs tabular-nums"
                      data-selected={dateKey(date) === selectedKey || undefined}
                      onClick={() => pick(date)}
                    >
                      {date.getDate()}
                      {dateKey(date) === dateKey(today) ? (
                        <span
                          aria-hidden="true"
                          className="absolute bottom-1 left-1/2 size-0.5 -translate-x-1/2 rounded-full bg-current"
                        />
                      ) : null}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-stroke px-1 pt-3">
        <div>
          <label htmlFor={timeId} className="flex items-center gap-1.5 text-xs text-content">
            <Clock className="size-3 shrink-0 text-(--ui-text-secondary)" aria-hidden="true" />
            {t("Time")}
          </label>
          <p
            id={timeHintId}
            className="mt-0.5 text-(length:--ui-font-caption) text-(--ui-text-secondary)"
          >
            {t("Local time, 24-hour")}
          </p>
        </div>
        <div className="w-24">
          <TextField
            label={t("Time")}
            hideLabel
            id={timeId}
            type="text"
            aria-describedby={timeHintId}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("HH:mm")}
            value={time}
            onChange={(event) => onChange(`${dateKey(selected)}T${event.target.value}`)}
            className="text-center text-xs tabular-nums"
          />
        </div>
      </div>
    </div>
  );
}
