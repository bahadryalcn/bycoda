const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** Format whole-number UI counts with stable thousands separators. */
export function formatInteger(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

/** Clamp without rounding; integer callers must normalize explicitly. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
