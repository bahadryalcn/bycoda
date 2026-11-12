import { useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useCalendarFormat } from "../../i18n/calendar";
import { Button } from "../Button";
import { Heading } from "../Heading";
import { Text } from "../Text";
import { ChevronLeft, ChevronRight } from "../icons";
import { useToday } from "../arc/lib/use-today";
import {
  addDays,
  dateKey,
  gridDestination,
  parseLocalDate,
  shiftMonth,
  type DateRange,
} from "./values";
import styles from "./Pickers.module.css";

export function CalendarGrid({
  value,
  onChange,
  min,
  max,
  range,
  pending,
  onPreview,
  autoFocus = false,
  disabled,
  readOnly,
}: {
  value: string;
  onChange: (date: Date) => void;
  min?: string;
  max?: string;
  range?: DateRange | null;
  pending?: boolean;
  onPreview?: (date: Date | null) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const t = useT();
  const format = useCalendarFormat();
  const today = useToday();
  const heading = useId();
  const grid = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus);
  const bound = (date: Date) => {
    const key = dateKey(date);
    return (
      (min && key < min ? parseLocalDate(min) : max && key > max ? parseLocalDate(max) : date) ??
      date
    );
  };
  const [state, setState] = useState(() => {
    const date = bound(parseLocalDate(value) ?? today ?? new Date(2000, 0, 1, 12));
    return { source: value, min, max, focus: date, month: date };
  });
  // Reconcile external selection/bounds after commit so DOM focus is read outside render.
  useLayoutEffect(() => {
    if (state.source === value && state.min === min && state.max === max) return;
    const date = bound(
      state.source !== value ? (parseLocalDate(value) ?? state.focus) : state.focus,
    );
    shouldFocus.current = !!grid.current?.contains(document.activeElement);
    setState({ source: value, min, max, focus: date, month: date });
  }, [state, value, min, max, bound]);
  // Keep the roving calendar tab stop focused after keyboard month/day navigation.
  useLayoutEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    grid.current
      ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?.focus({ preventScroll: true });
  }, [state]);
  const navigate = (date: Date, focus: boolean) => {
    const next = bound(date);
    shouldFocus.current = focus;
    setState({ source: value, min, max, focus: next, month: next });
    if (pending) onPreview?.(next);
  };
  const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12);
  const weekStart = format.weekStart;
  const offset = (first.getDay() - weekStart + 7) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    i >= offset && i < offset + count ? addDays(first, i - offset) : null,
  );
  const monthKey = dateKey(first).slice(0, 7);
  const selectedKey = dateKey(state.focus);
  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <Heading id={heading} size="caption">
          {format.date(first, { month: "long", year: "numeric" })}
        </Heading>
        <div className={styles.navigation}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Previous month")}
            disabled={disabled || (!!min && monthKey <= min.slice(0, 7))}
            onClick={() => navigate(shiftMonth(state.focus, -1), false)}
          >
            <ChevronLeft className="size-(--ui-icon-sm)" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Next month")}
            disabled={disabled || (!!max && monthKey >= max.slice(0, 7))}
            onClick={() => navigate(shiftMonth(state.focus, 1), false)}
          >
            <ChevronRight className="size-(--ui-icon-sm)" />
          </Button>
        </div>
      </div>
      <div
        ref={grid}
        role="grid"
        aria-labelledby={heading}
        aria-multiselectable={range ? true : undefined}
        aria-readonly={readOnly || undefined}
        onMouseLeave={() => onPreview?.(null)}
      >
        <div role="row" className={styles.week}>
          {Array.from({ length: 7 }, (_, i) => {
            const day = new Date(2024, 0, 7 + weekStart + i, 12);
            return (
              <Text
                key={i}
                role="columnheader"
                size="caption"
                tone="secondary"
                aria-label={format.date(day, { weekday: "long" })}
                className={styles.weekday}
              >
                {format.date(day, { weekday: "narrow" })}
              </Text>
            );
          })}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div role="row" key={row} className={styles.week}>
            {cells.slice(row * 7, row * 7 + 7).map((date, column) => {
              const key = date ? dateKey(date) : "";
              const inRange = !!range && key >= dateKey(range.start) && key <= dateKey(range.end);
              const selected = range
                ? key === dateKey(range.start) || key === dateKey(range.end)
                : key === value;
              const unavailable = !!disabled || (!!min && key < min) || (!!max && key > max);
              const label = date ? format.date(date, { dateStyle: "full" }) : undefined;
              return (
                <div
                  key={column}
                  role="gridcell"
                  aria-selected={date ? selected || inRange : undefined}
                  className={styles.cell}
                  data-range={(date && inRange) || undefined}
                  data-preview={(pending && inRange) || undefined}
                >
                  {date ? (
                    <button
                      type="button"
                      data-date={key}
                      data-selected={selected || undefined}
                      data-today={(today && key === dateKey(today)) || undefined}
                      aria-current={today && key === dateKey(today) ? "date" : undefined}
                      aria-label={label}
                      title={label}
                      tabIndex={key === selectedKey ? 0 : -1}
                      disabled={unavailable}
                      className={styles.day}
                      onFocus={() => {
                        if (pending) onPreview?.(date);
                      }}
                      onMouseEnter={() => onPreview?.(date)}
                      onClick={() => {
                        if (!readOnly) onChange(date);
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!readOnly) onChange(date);
                          return;
                        }
                        const next = gridDestination(date, event.key, weekStart);
                        if (!next) return;
                        event.preventDefault();
                        event.stopPropagation();
                        navigate(next, true);
                      }}
                    >
                      {format.date(date, { day: "numeric" })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
