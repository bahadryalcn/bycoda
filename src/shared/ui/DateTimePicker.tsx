import { useLocale, useT } from "../i18n";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Clock } from "./icons";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { Field, type FieldVariant } from "./Field";
import { Popover } from "./Popover";
import { SelectTrigger } from "./arc/select/select";
import { LAYER } from "../lib/layers";
import { isImeComposition } from "../lib/keyboard";
import "./DateTimePicker.css";

/**
 * Which parts a picker shows and which value format it reads and emits. The formats are the native
 * input values, so `type="date" | "time" | "datetime-local"` fields migrate without conversion:
 * `date` is `YYYY-MM-DD`, `time` is `HH:mm`, `datetime` is `YYYY-MM-DDTHH:mm`.
 */
export type DateTimeMode = "date" | "time" | "datetime";

export function toLocalDateTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && toLocalDateTime(date) === value ? date : null;
}

/** A `YYYY-MM-DD` value as local noon, or null when malformed or normalized (2028-02-30). */
export function parseLocalDate(value: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDateTime(`${value}T12:00`) : null;
}

/** A 24-hour `HH:mm` value as minutes after midnight, or null when malformed. */
export function parseLocalTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Whether `value` is a complete value in `mode`'s native format. */
export function isLocalDateTimeValue(value: string, mode: DateTimeMode): boolean {
  if (mode === "date") return parseLocalDate(value) !== null;
  if (mode === "time") return parseLocalTime(value) !== null;
  return parseLocalDateTime(value) !== null;
}

type Props = {
  /** In the native format of `mode`; see {@link DateTimeMode}. */
  value: string;
  onChange: (value: string) => void;
  /** `datetime` (default) shows the calendar and time, `date` only the calendar, `time` only the time. */
  mode?: DateTimeMode;
  /** `YYYY-MM-DD`; days before it cannot be chosen. Ignored in `time` mode. */
  minDate?: string;
  autoFocus?: boolean;
  /** Nothing can be chosen or typed; the calendar and time dim. */
  disabled?: boolean;
  /** The value is shown on the normal grid and time field but cannot change; browsing months still works. */
  readOnly?: boolean;
  /** The time field takes the danger frame; the owner supplies the message. */
  invalid?: boolean;
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

export function DateTimePicker({
  value,
  onChange,
  mode = "datetime",
  minDate,
  autoFocus = false,
  disabled = false,
  readOnly = false,
  invalid = false,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const today = new Date(Date.now());
  const dateValue = mode === "time" ? "" : value.slice(0, 10);
  const selected = parseLocalDateTime(`${dateValue}T12:00`) ?? today;
  const minimum = minDate ? parseLocalDateTime(`${minDate}T12:00`) : null;
  const initial = minimum && selected < minimum ? minimum : selected;
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1, 12),
  );
  const [focusedDate, setFocusedDate] = useState(initial);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus && mode !== "time");
  const minimumTime = minimum?.getTime();
  const selectedKey = dateValue;
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
  const time =
    mode === "time"
      ? value
      : mode === "date"
        ? ""
        : value.includes("T")
          ? value.slice(value.indexOf("T") + 1)
          : "";
  // A malformed time shows the danger frame once the field is left; typing a partial value stays quiet.
  // A standalone time may be empty (the owner decides whether it is required).
  const [timeTouched, setTimeTouched] = useState(false);
  const timeInvalid =
    timeTouched &&
    (mode === "time"
      ? time !== "" && parseLocalTime(time) === null
      : parseLocalDateTime(`${selectedKey}T${time}`) === null);
  const navigate = (date: Date, focus: boolean) => {
    const next = minimum && date < minimum ? minimum : date;
    shouldFocus.current = focus;
    setFocusedDate(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
  };
  const pick = (date: Date) => {
    setFocusedDate(date);
    if (disabled || readOnly) return;
    onChange(mode === "date" ? dateKey(date) : `${dateKey(date)}T${time}`);
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
  const timeFooter = (
    <div className="date-time-footer">
      <div>
        <label htmlFor={timeId} className="date-time-time-label">
          <Clock className="date-time-time-icon size-(--ui-icon-xs)" aria-hidden="true" />
          {t("Time")}
        </label>
        <p id={timeHintId} className="date-time-hint">
          {t("Local time, 24-hour")}
        </p>
      </div>
      <div className="date-time-time-field">
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
          aria-invalid={timeInvalid || invalid || undefined}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus && mode === "time"}
          onFocus={() => setTimeTouched(false)}
          onBlur={() => setTimeTouched(true)}
          onChange={(event) => {
            if (disabled || readOnly) return;
            onChange(
              mode === "time" ? event.target.value : `${dateKey(selected)}T${event.target.value}`,
            );
          }}
          className="date-time-time-input"
        />
      </div>
    </div>
  );
  return (
    <div
      className="bycoda-date-time-picker"
      data-mode={mode}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      data-invalid={invalid || undefined}
    >
      {mode === "time" ? null : (
        <>
          <div className="date-time-header">
            <span id={headingId} aria-live="polite" className="date-time-title">
              {monthLabel} <span className="date-time-year">{month.getFullYear()}</span>
            </span>
            <div className="date-time-nav">
              <Button
                variant="ghost"
                iconOnly
                label={t("Previous month")}
                disabled={previousDisabled || disabled}
                onClick={() => navigate(shiftMonth(focusedDate, -1), false)}
                className="date-time-month-action"
              >
                <ChevronLeft className="size-(--ui-icon-sm)" />
              </Button>
              <Button
                variant="ghost"
                iconOnly
                label={t("Next month")}
                disabled={disabled}
                onClick={() => navigate(shiftMonth(focusedDate, 1), false)}
                className="date-time-month-action"
              >
                <ChevronRight className="size-(--ui-icon-sm)" />
              </Button>
            </div>
          </div>
          <div className="date-time-calendar">
            <div
              ref={gridRef}
              role="grid"
              aria-labelledby={headingId}
              aria-readonly={readOnly || undefined}
              aria-disabled={disabled || undefined}
            >
              <div role="row" className="date-time-row">
                {weekdays.map((label) => (
                  <span
                    key={label.long}
                    role="columnheader"
                    aria-label={label.long}
                    title={label.long}
                    className="date-time-weekday"
                  >
                    {label.short}
                  </span>
                ))}
              </div>
              {Array.from({ length: cells.length / 7 }, (_, week) => (
                <div role="row" key={week} className="date-time-row date-time-week">
                  {cells.slice(week * 7, week * 7 + 7).map((date, column) => (
                    <div
                      role="gridcell"
                      key={column}
                      className="date-time-cell"
                      aria-selected={date ? dateKey(date) === selectedKey : undefined}
                    >
                      {date ? (
                        <button
                          type="button"
                          aria-label={date.toLocaleDateString(locale, {
                            dateStyle: "full",
                          })}
                          data-date={dateKey(date)}
                          tabIndex={dateKey(date) === dateKey(focusedDate) ? 0 : -1}
                          onKeyDown={(event) => onDayKeyDown(event, date)}
                          title={date.toLocaleDateString(locale, {
                            dateStyle: "full",
                          })}
                          disabled={disabled || (!!minimum && date < minimum)}
                          aria-current={dateKey(date) === dateKey(today) ? "date" : undefined}
                          className="date-time-day"
                          data-selected={dateKey(date) === selectedKey || undefined}
                          data-today={dateKey(date) === dateKey(today) || undefined}
                          onClick={() => pick(date)}
                        >
                          {date.getDate()}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {mode === "date" ? null : timeFooter}
    </div>
  );
}

export type DateTimeFieldProps = {
  label: string;
  /** The native input value of `mode`: `YYYY-MM-DD`, `HH:mm` or `YYYY-MM-DDTHH:mm`; `""` when empty. */
  value: string;
  /** Receives a complete value or `""`, exactly like the native input's `value`. */
  onChange: (value: string) => void;
  /** Defaults to `datetime` (the `datetime-local` replacement). */
  mode?: DateTimeMode;
  /** Earliest `YYYY-MM-DD` day, like the native `min`. A full datetime is accepted; only its date is used. */
  min?: string;
  disabled?: boolean;
  /** Shows the value; the calendar can still be browsed but nothing changes. */
  readOnly?: boolean;
  /** Exposed as `aria-required`. Validation and its message stay with the owner (`error`). */
  required?: boolean;
  error?: string;
  description?: string;
  placeholder?: string;
  /** Keep `label` as the accessible name only; the surrounding UI must give visible context. */
  hideLabel?: boolean;
  fieldVariant?: FieldVariant;
  fieldSize?: "sm" | "md";
  id?: string;
  /** Submits the committed value with a form. */
  name?: string;
  /** Adds a Clear action to the open picker; Backspace or Delete on the trigger also clears. */
  clearable?: boolean;
  className?: string;
};

function formatFieldValue(value: string, mode: DateTimeMode, locale: string): string | undefined {
  if (!value) return undefined;
  if (mode === "date") {
    return (
      parseLocalDate(value)?.toLocaleDateString(locale, {
        dateStyle: "medium",
      }) ?? value
    );
  }
  const full = parseLocalDateTime(value);
  if (full)
    return full.toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const date = parseLocalDate(value.slice(0, 10));
  return date
    ? `${date.toLocaleDateString(locale, { dateStyle: "medium" })} ${value.slice(11)}`.trim()
    : value;
}

/**
 * The labelled form field for a date, a time or a local date and time, replacing native
 * `type="date" | "time" | "datetime-local"` inputs with the shared calendar and 24-hour entry.
 * Date modes open the {@link DateTimePicker} in a popover from a field-framed trigger; `time`
 * is a typed `HH:mm` field. Like the native inputs, `onChange` only reports complete values
 * (or `""`), while an unfinished entry stays a local draft.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  mode = "datetime",
  min,
  disabled = false,
  readOnly = false,
  required = false,
  error,
  description,
  placeholder,
  hideLabel = false,
  fieldVariant = "form",
  fieldSize,
  id,
  name,
  clearable = false,
  className,
}: DateTimeFieldProps) {
  const t = useT();
  const locale = useLocale();
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The draft is what the picker shows; the owner hears only complete values or "" (native semantics).
  // A new value from the owner replaces the draft during render.
  const [draft, setDraft] = useState({ source: value, text: value });
  if (draft.source !== value) setDraft({ source: value, text: value });
  const text = draft.source === value ? draft.text : value;
  const [timeTouched, setTimeTouched] = useState(false);
  if ((disabled || mode === "time") && open) setOpen(false);

  const update = (next: string) => {
    const committed = isLocalDateTimeValue(next, mode) ? next : "";
    setDraft({ source: committed === value ? value : committed, text: next });
    if (committed !== value) onChange(committed);
  };
  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus({ preventScroll: true });
  };
  const canClear = clearable && !disabled && !readOnly && text !== "";
  const hiddenInput = name ? <input type="hidden" name={name} value={value} /> : null;

  if (mode === "time") {
    const timeInvalid = timeTouched && text !== "" && parseLocalTime(text) === null;
    return (
      <div className={["min-w-0", className].filter(Boolean).join(" ")}>
        <TextField
          id={controlId}
          label={label}
          hideLabel={hideLabel}
          fieldVariant={fieldVariant}
          fieldSize={fieldSize}
          description={description ?? t("Local time, 24-hour")}
          error={error}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? t("HH:mm")}
          value={text}
          required={required}
          aria-invalid={timeInvalid || undefined}
          disabled={disabled}
          readOnly={readOnly}
          clearable={canClear}
          onFocus={() => setTimeTouched(false)}
          onBlur={() => setTimeTouched(true)}
          onChange={(event) => {
            if (!disabled && !readOnly) update(event.target.value);
          }}
          className="date-time-time-input date-time-field-time"
        />
        {hiddenInput}
      </div>
    );
  }

  const shown = formatFieldValue(text, mode, locale);
  const shownPlaceholder =
    placeholder ?? (mode === "date" ? t("Choose a date") : t("Choose date and time"));
  const minDate = min ? min.slice(0, 10) : undefined;
  const layer = root.current?.closest('[role="dialog"]') ? LAYER.dialogPopover : LAYER.popover;
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      variant={fieldVariant}
      id={controlId}
      className={["min-w-0", className].filter(Boolean).join(" ")}
    >
      {(control) => (
        <div ref={root} className="relative min-w-0">
          <SelectTrigger
            {...control}
            ref={trigger}
            type="button"
            data-field-size={fieldSize ?? (fieldVariant === "compact" ? "sm" : "md")}
            data-state={open ? "open" : "closed"}
            data-disabled={disabled || undefined}
            disabled={disabled}
            aria-label={`${label}: ${shown ?? shownPlaceholder}`}
            aria-required={required || undefined}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            onClick={() => {
              if (!disabled) setOpen((current) => !current);
            }}
            onKeyDown={(event) => {
              if (disabled || isImeComposition(event.nativeEvent)) return;
              if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setOpen(true);
                return;
              }
              if (canClear && (event.key === "Backspace" || event.key === "Delete")) {
                event.preventDefault();
                update("");
              }
            }}
            className="bycoda-arc bycoda-arc-select date-time-field-trigger"
          >
            <span
              className="date-time-field-value"
              data-placeholder={shown ? undefined : ""}
              title={shown}
            >
              {shown ?? shownPlaceholder}
            </span>
            <Clock className="date-time-field-icon size-(--ui-icon-sm)" aria-hidden="true" />
          </SelectTrigger>
          {hiddenInput}
          {open ? (
            <Popover
              id={popoverId}
              anchor={trigger}
              side="bottom"
              align="start"
              gap={4}
              layer={layer}
              role="dialog"
              aria-label={label}
              data-dialog-popover
              onDismiss={(reason) => close(reason === "escape")}
              className="bycoda-arc bycoda-arc-menu date-time-field-popover"
            >
              <DateTimePicker
                mode={mode}
                value={text}
                minDate={minDate}
                disabled={disabled}
                readOnly={readOnly}
                invalid={Boolean(error)}
                autoFocus
                onChange={(next) => {
                  update(next);
                  if (mode === "date" && isLocalDateTimeValue(next, "date")) close(true);
                }}
              />
              {canClear ? (
                <div className="date-time-field-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      update("");
                      close(true);
                    }}
                  >
                    {t("Clear")}
                  </Button>
                </div>
              ) : null}
            </Popover>
          ) : null}
        </div>
      )}
    </Field>
  );
}
