import { useLayoutEffect, useRef } from "react";
import { useT } from "../../i18n";
import { useCalendarFormat } from "../../i18n/calendar";
import { ScrollArea } from "../ScrollArea";
import { Text } from "../Text";
import { minuteOptions, parseLocalTime, timeKey } from "./values";
import styles from "./Pickers.module.css";

function TimeColumn({
  label,
  values,
  selected,
  onChange,
  format,
  disabled,
}: {
  label: string;
  values: number[];
  selected: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- centers the selected DOM option in its own scroll rail without scrolling the popover or window
  useLayoutEffect(() => {
    const rail = root.current;
    const option = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (rail && option)
      rail.scrollTop = option.offsetTop - (rail.clientHeight - option.offsetHeight) / 2;
  }, [selected]);
  return (
    <div className={styles.column}>
      <Text size="caption" tone="secondary">
        {label}
      </Text>
      <ScrollArea
        ref={root}
        role="listbox"
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={styles.rail}
        gutter="stable"
      >
        {values.map((value, index) => (
          <button
            key={value}
            type="button"
            role="option"
            aria-selected={value === selected}
            tabIndex={value === selected ? 0 : -1}
            disabled={disabled}
            className={styles.option}
            onClick={() => onChange(value)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowDown"
                  ? Math.min(values.length - 1, index + 1)
                  : event.key === "ArrowUp"
                    ? Math.max(0, index - 1)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? values.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              event.stopPropagation();
              onChange(values[next]);
              root.current
                ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
                [next]?.focus({ preventScroll: true });
            }}
          >
            {format(value)}
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}

export function TimeColumns({
  value,
  onChange,
  minuteStep,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
  disabled?: boolean;
}) {
  const format = useCalendarFormat();
  const t = useT();
  const time = parseLocalTime(value) ?? 0;
  const hour = Math.floor(time / 60);
  const minute = time % 60;
  return (
    <div className={styles.columns}>
      <TimeColumn
        label={t("Hour")}
        values={Array.from({ length: 24 }, (_, i) => i)}
        selected={hour}
        onChange={(next) => onChange(timeKey(next * 60 + minute))}
        disabled={disabled}
        format={(next) => format.date(new Date(2000, 0, 1, next), { hour: "numeric" })}
      />
      <TimeColumn
        label={t("Minute")}
        values={minuteOptions(minuteStep, minute)}
        selected={minute}
        onChange={(next) => onChange(timeKey(hour * 60 + next))}
        disabled={disabled}
        format={(next) =>
          format
            .parts(new Date(2000, 0, 1, 0, next), { hour: "2-digit", minute: "2-digit" })
            .find((part) => part.type === "minute")?.value ?? ""
        }
      />
    </div>
  );
}
