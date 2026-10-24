import { useRef, useState } from "react";
import { t, useLocale, useT } from "../i18n";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { TextField } from "./TextField";
import { DateRangePicker } from "./DateRangePicker";
import { parseLocalDateTime, toLocalDateTime } from "./DateTimePicker";
import { Clock } from "./icons";
import "./DateTimeRangePicker.css";

/** Exact local start/end instants. End is exclusive; the calendar selects inclusive days. */
export type DateTimeRange = { start: Date; end: Date };
export function DateTimeRangePicker({
  value,
  onChange,
  label = t("Date and time range"),
  minDate,
  maxDate,
}: {
  value: DateTimeRange;
  onChange: (range: DateTimeRange) => void;
  label?: string;
  minDate?: Date;
  maxDate?: Date;
}) {
  const t = useT();
  const locale = useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => toLocalDateTime(value.start));
  const [end, setEnd] = useState(() => toLocalDateTime(value.end));
  const parsedStart = parseLocalDateTime(start);
  const parsedEnd = parseLocalDateTime(end);
  const valid =
    parsedStart &&
    parsedEnd &&
    parsedEnd > parsedStart &&
    (!minDate || parsedStart >= minDate) &&
    (!maxDate || parsedEnd <= maxDate);
  const format = (date: Date) =>
    date.toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <>
      <Button
        ref={anchor}
        variant="secondary"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setStart(toLocalDateTime(value.start));
          setEnd(toLocalDateTime(value.end));
          setOpen(!open);
        }}
      >
        <Clock className="size-3.5" />
        <span>
          {format(value.start)} – {format(value.end)}
        </span>
      </Button>
      {open && (
        <Popover
          ref={panel}
          anchor={anchor}
          align="end"
          onDismiss={() => setOpen(false)}
          className="date-time-range-panel"
          role="dialog"
          aria-label={label}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) {
                onChange({ start: parsedStart, end: parsedEnd });
                setOpen(false);
              }
            }}
          >
            <h3>{label}</h3>
            <DateRangePicker
              minDate={minDate}
              maxDate={maxDate ? new Date(maxDate.getTime() - 1) : undefined}
              value={
                parsedStart && parsedEnd
                  ? { start: parsedStart, end: new Date(parsedEnd.getTime() - 1) }
                  : null
              }
              months={1}
              boundary={() => panel.current}
              expandInFlow
              onChange={(range) => {
                setStart(toLocalDateTime(range.start));
                const next = new Date(range.end);
                next.setDate(next.getDate() + 1);
                next.setHours(0, 0, 0, 0);
                setEnd(toLocalDateTime(next));
              }}
            />
            <TextField
              label={t("Start date and time")}
              type="datetime-local"
              min={minDate ? toLocalDateTime(minDate) : undefined}
              max={maxDate ? toLocalDateTime(maxDate) : undefined}
              step={900}
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
            <TextField
              label={t("End date and time")}
              type="datetime-local"
              min={minDate ? toLocalDateTime(minDate) : undefined}
              max={maxDate ? toLocalDateTime(maxDate) : undefined}
              step={900}
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
            <p>{t("End time is exclusive. Usage is recorded in 15-minute intervals.")}</p>
            {!valid && <p role="alert">{t("End must be after start.")}</p>}
            <div className="date-time-range-actions">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={!valid}>
                {t("Apply")}
              </Button>
            </div>
          </form>
        </Popover>
      )}
    </>
  );
}
