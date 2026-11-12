import { useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { useCalendarFormat } from "../../i18n/calendar";
import { useToday } from "../arc/lib/use-today";
import { Button } from "../Button";
import { Text } from "../Text";
import { CalendarGrid } from "./CalendarGrid";
import { TimeColumns } from "./TimeColumns";
import { ValueEntry } from "./ValueEntry";
import { PickerShell } from "./PickerShell";
import type { PickerFieldProps } from "./types";
import { defaultDateRangePresets, type DateRangePreset } from "./presets";
import {
  clampValue,
  dateKey,
  formatValue,
  orderedRange,
  parseLocalDate,
  parseLocalDateTime,
  toLocalDateTime,
  type DateRange,
} from "./values";
import styles from "./Pickers.module.css";

export type RangePickerProps = Omit<PickerFieldProps, "label"> & {
  label?: string;
  value: DateRange | null;
  onChange: (range: DateRange) => void;
  /** Optional fields clear through this callback; onChange keeps its non-null range contract. */
  onClear?: () => void;
  min?: Date;
  max?: Date;
  minDate?: Date;
  maxDate?: Date;
  minuteStep?: number;
  /** Inclusive local-day presets; datetime ranges convert their end to next local midnight. */
  presets?: DateRangePreset[];
};

function RangeEditor({
  value,
  onChange,
  close,
  clear,
  withTime,
  min,
  max,
  presets = defaultDateRangePresets,
  minuteStep,
}: RangePickerProps & { close: () => void; clear: ReactNode; withTime: boolean }) {
  const t = useT();
  const today = useToday();
  const mode = withTime ? "datetime" : "date";
  const serialize = (date: Date) => (withTime ? toLocalDateTime(date) : dateKey(date));
  const minimum = min ? serialize(min) : undefined;
  const maximum = max ? serialize(max) : undefined;
  const parse = withTime ? parseLocalDateTime : parseLocalDate;
  const [start, setStart] = useState(() => (value ? serialize(value.start) : ""));
  const [end, setEnd] = useState(() => (value ? serialize(value.end) : ""));
  const [pending, setPending] = useState<Date | null>(null);
  const [preview, setPreview] = useState<Date | null>(null);
  const [endpoint, setEndpoint] = useState<"start" | "end">("start");
  const [entryValid, setEntryValid] = useState({ start: true, end: true });
  const parsedStart = parse(start);
  const parsedEnd = parse(end);
  const valid =
    !!parsedStart &&
    !!parsedEnd &&
    (withTime ? parsedEnd > parsedStart : parsedEnd >= parsedStart) &&
    (!minimum || start >= minimum) &&
    (!maximum || end <= maximum) &&
    !pending &&
    entryValid.start &&
    entryValid.end;
  const calendarEnd = parsedEnd && withTime ? new Date(parsedEnd.getTime() - 1) : parsedEnd;
  const selected = parsedStart && calendarEnd ? { start: parsedStart, end: calendarEnd } : null;
  const shownRange = pending ? orderedRange(pending, preview ?? pending) : selected;
  const updateStart = (next: string) => setStart(clampValue(next, mode, minimum, maximum));
  const updateEnd = (next: string) => setEnd(clampValue(next, mode, minimum, maximum));
  const selectRange = (range: DateRange) => {
    const ordered = orderedRange(range.start, range.end);
    const first = new Date(
      ordered.start.getFullYear(),
      ordered.start.getMonth(),
      ordered.start.getDate(),
    );
    const last = new Date(
      ordered.end.getFullYear(),
      ordered.end.getMonth(),
      ordered.end.getDate() + (withTime ? 1 : 0),
    );
    updateStart(serialize(first));
    updateEnd(serialize(last));
    setPending(null);
    setPreview(null);
    setEntryValid({ start: true, end: true });
  };
  const presetRange = (preset: DateRangePreset) => {
    const range = preset.range(today ?? new Date(2000, 0, 1));
    const start = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate(),
    );
    const end = new Date(
      range.end.getFullYear(),
      range.end.getMonth(),
      range.end.getDate() + (withTime ? 1 : 0),
    );
    return { start, end };
  };
  const allowedPreset = (preset: DateRangePreset) => {
    const range = presetRange(preset);
    return (
      !!today &&
      Number.isFinite(range.start.getTime()) &&
      Number.isFinite(range.end.getTime()) &&
      range.start <= range.end &&
      (!minimum || serialize(range.start) >= minimum) &&
      (!maximum || serialize(range.end) <= maximum)
    );
  };
  return (
    <div
      className={styles.range}
      data-presets={presets.length ? true : undefined}
      data-time={withTime || undefined}
    >
      {presets.length ? (
        <div className={styles.presets}>
          {presets.map((preset, index) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              disabled={!allowedPreset(preset)}
              onClick={() => selectRange(preset.range(new Date()))}
              onKeyDown={(event) => {
                const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
                if (!forward && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const direction = forward ? 1 : -1;
                for (let step = 1; step < presets.length; step++) {
                  const next = (index + step * direction + presets.length) % presets.length;
                  if (allowedPreset(presets[next])) {
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>("button")
                      [next]?.focus();
                    break;
                  }
                }
              }}
            >
              {t(preset.label)}
            </Button>
          ))}
        </div>
      ) : null}
      <div className={styles.rangeMain}>
        <CalendarGrid
          value={pending ? dateKey(pending) : start.slice(0, 10)}
          range={shownRange}
          pending={!!pending}
          min={minimum?.slice(0, 10)}
          max={max ? dateKey(withTime ? new Date(max.getTime() - 1) : max) : undefined}
          autoFocus
          onPreview={setPreview}
          onChange={(date) => {
            if (pending) selectRange({ start: pending, end: date });
            else {
              setPending(date);
              setPreview(date);
            }
          }}
        />
        {withTime ? (
          <div className={styles.side}>
            <div className={styles.endpoints}>
              <Button
                size="sm"
                variant="ghost"
                selected={endpoint === "start"}
                aria-pressed={endpoint === "start"}
                onClick={() => setEndpoint("start")}
              >
                {t("Start")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                selected={endpoint === "end"}
                aria-pressed={endpoint === "end"}
                onClick={() => setEndpoint("end")}
              >
                {t("End")}
              </Button>
            </div>
            <TimeColumns
              value={(endpoint === "start" ? start : end).slice(11)}
              minuteStep={minuteStep}
              disabled={!(endpoint === "start" ? parsedStart : parsedEnd)}
              onChange={(time) => {
                if (endpoint === "start") updateStart(`${start.slice(0, 10)}T${time}`);
                else updateEnd(`${end.slice(0, 10)}T${time}`);
              }}
            />
            <Text size="caption" tone="secondary">
              {t("End time is exclusive.")}
            </Text>
          </div>
        ) : null}
        <div className={styles.entries}>
          <ValueEntry
            value={start}
            mode={mode}
            label={withTime ? t("Start date and time") : t("Start date")}
            onChange={updateStart}
            onValidityChange={(valid) => setEntryValid((state) => ({ ...state, start: valid }))}
          />
          <ValueEntry
            value={end}
            mode={mode}
            label={withTime ? t("End date and time") : t("End date")}
            onChange={updateEnd}
            onValidityChange={(valid) => setEntryValid((state) => ({ ...state, end: valid }))}
          />
        </div>
        {parsedStart &&
        parsedEnd &&
        (withTime ? parsedEnd <= parsedStart : parsedEnd < parsedStart) ? (
          <Text size="caption" tone="danger" className={styles.wide}>
            {t("End must be after start.")}
          </Text>
        ) : null}
      </div>
      <div className={styles.footer}>
        {clear}
        <Button variant="ghost" size="sm" onClick={close}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!valid}
          onClick={() => {
            if (!valid || !parsedStart || !parsedEnd) return;
            const localDay = (date: Date) =>
              new Date(date.getFullYear(), date.getMonth(), date.getDate());
            onChange({
              start: withTime ? parsedStart : localDay(parsedStart),
              end: withTime ? parsedEnd : localDay(parsedEnd),
            });
            close();
          }}
        >
          {t("Apply")}
        </Button>
      </div>
    </div>
  );
}

export function RangePicker({ withTime, ...props }: RangePickerProps & { withTime: boolean }) {
  const t = useT();
  const format = useCalendarFormat();
  const mode = withTime ? "datetime" : "date";
  const serialize = (date: Date) => (withTime ? toLocalDateTime(date) : dateKey(date));
  const shown = props.value
    ? `${formatValue(serialize(props.value.start), mode, format.date)} – ${formatValue(serialize(props.value.end), mode, format.date)}`
    : "";
  const min = props.min ?? props.minDate;
  const max = props.max ?? props.maxDate;
  return (
    <PickerShell
      {...props}
      label={props.label ?? (withTime ? t("Date and time range") : t("Date range"))}
      placeholder={props.placeholder ?? t("Custom date range")}
      shown={shown}
      rawValue={props.value ? `${serialize(props.value.start)}/${serialize(props.value.end)}` : ""}
      onClear={props.onClear}
    >
      {(close, clear) => (
        <RangeEditor
          clear={clear}
          {...props}
          min={min}
          max={max}
          withTime={withTime}
          close={close}
        />
      )}
    </PickerShell>
  );
}
