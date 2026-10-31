import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./Meter.module.css";

export type MeterTone = "neutral" | "accent" | "success" | "info" | "warning" | "danger";

export type MeterProps = Omit<ComponentPropsWithRef<"div">, "children" | "role"> & {
  /** `linear` bar (default) or a compact `ring`. */
  variant?: "linear" | "ring";
  /** Current measure. `null` shows the empty track without meter semantics (unknown). */
  value: number | null;
  min?: number;
  max?: number;
  /** At or above this value the meter uses the warning tone. */
  warning?: number;
  /** At or above this value the meter uses the danger tone. */
  danger?: number;
  /** Tone below the thresholds. Default `neutral` (secondary ink). */
  tone?: MeterTone;
  /** linear: 4px / 6px thick; ring: 16px / 24px. Default `sm`. */
  size?: "sm" | "md";
  /** Accessible name. Use `aria-labelledby` instead when a visible label names it. */
  label?: string;
  /** Spoken value, e.g. "42 k of 200 k tokens". Defaults to the number. */
  valueText?: string;
  /** Ring only: content in the centre (a glyph or a short number). */
  children?: ReactNode;
};

/** The tone a value reaches, so a caller can colour its own text the same way. */
export function meterTone(
  value: number | null,
  { warning, danger, tone = "neutral" }: Pick<MeterProps, "warning" | "danger" | "tone">,
): MeterTone {
  if (value === null) return tone;
  if (danger !== undefined && value >= danger) return "danger";
  if (warning !== undefined && value >= warning) return "warning";
  return tone;
}

/**
 * Informational measure (`role="meter"`): usage, capacity, context fill. Not for task
 * progress (use Progress) or quotas with remaining/over-limit copy (use UsageMeter).
 *
 * @example
 * <Meter label={t("Computer memory")} value={usedPercent} warning={75} danger={90} />
 * <Meter variant="ring" label={t("Context usage")} value={used} max={window} warning={window * 0.75}
 *   danger={window * 0.9} valueText={detail}><Zap /></Meter>
 */
export function Meter({
  variant = "linear",
  value,
  min = 0,
  max = 100,
  warning,
  danger,
  tone,
  size = "sm",
  label,
  valueText,
  children,
  className,
  ...props
}: MeterProps) {
  const span = max - min;
  const ratio =
    value === null || !(span > 0) ? 0 : Math.min(1, Math.max(0, (value - min) / span));
  const known = value !== null;
  const shared = {
    ...props,
    role: known ? "meter" : undefined,
    "aria-label": label,
    "aria-valuemin": known ? min : undefined,
    "aria-valuemax": known ? max : undefined,
    "aria-valuenow": known ? value : undefined,
    "aria-valuetext": known ? valueText : undefined,
    "data-tone": meterTone(value, { warning, danger, tone }),
    "data-size": size,
  };
  if (variant === "ring")
    return (
      <div {...shared} className={[styles.meter, styles.ring, className].filter(Boolean).join(" ")}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className={styles.ringSvg}>
          <circle cx="12" cy="12" r="10" strokeWidth="2" className={styles.ringTrack} />
          {ratio > 0 ? (
            <circle
              cx="12"
              cy="12"
              r="10"
              strokeWidth="2"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={100 * (1 - ratio)}
              transform="rotate(-90 12 12)"
              className={styles.ringValue}
            />
          ) : null}
        </svg>
        {children != null ? (
          <span className={styles.ringCenter} aria-hidden="true">
            {children}
          </span>
        ) : null}
      </div>
    );
  return (
    <div {...shared} className={[styles.meter, styles.linear, className].filter(Boolean).join(" ")}>
      <span className={styles.bar} style={{ inlineSize: `${ratio * 100}%` }} />
    </div>
  );
}
