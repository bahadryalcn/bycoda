import { numberFormat } from "../../../shared/i18n/numberFormat";

function range(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

/** Preset token limits, ascending. */
export const TOKEN_LADDER: number[] = [
  100_000,
  250_000,
  500_000,
  ...range(1_000_000, 5_000_000, 1_000_000),
  ...range(10_000_000, 25_000_000, 5_000_000),
  ...range(30_000_000, 100_000_000, 10_000_000),
  ...range(150_000_000, 500_000_000, 50_000_000),
];

export type TokenAmountParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: "decimal" | "negative" | "invalid" };

type Separators = { group: string; decimal: string };

function separatorsFor(locale: string): Separators {
  const parts = numberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? "",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/**
 * Parses a typed token limit in the locale's own number style. Empty text and 0 mean no limit
 * (null), as the cap copy promises. Accepts K/M suffixes; the grouping separator and spaces
 * are ignored.
 */
export function parseTokenAmount(text: string, locale: string): TokenAmountParse {
  const compact = text.replace(/[\s   ]/g, "");
  if (!compact) return { ok: true, value: null };
  if (compact.startsWith("-") || compact.startsWith("−")) {
    return { ok: false, reason: "negative" };
  }
  const { group, decimal } = separatorsFor(locale);
  let body = compact;
  const suffix = /[kKmM]$/.exec(body)?.[0].toUpperCase();
  if (suffix) body = body.slice(0, -1);
  const zeros = suffix === "M" ? 6 : suffix === "K" ? 3 : 0;
  if (group) body = body.split(group).join("");
  body = body.split(decimal).join(".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(body);
  if (!match) return { ok: false, reason: "invalid" };
  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(zeros, "0");
  if (/[1-9]/.test(fraction.slice(zeros))) return { ok: false, reason: "decimal" };
  const value = Number(whole) * 10 ** zeros + Number(fraction.slice(0, zeros) || 0);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "invalid" };
  return { ok: true, value: value === 0 ? null : value };
}

/** Whole number with the locale's grouping and no fraction digits. */
export function formatTokenAmount(value: number, locale: string): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Compact preset label such as 100K, 1M or 1.5M in the locale's notation. */
export function shortTokenLabel(value: number, locale: string): string {
  return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * Moves to the next (up) or previous (down) preset. Between presets it snaps to the nearest one
 * in that direction; down from the first preset (or below it) gives null (no limit); up from
 * null gives the first preset; up above the top preset keeps the value.
 */
export function stepTokenAmount(value: number | null, direction: 1 | -1): number | null {
  if (direction === 1) {
    if (value === null) return TOKEN_LADDER[0] ?? null;
    return TOKEN_LADDER.find((preset) => preset > value) ?? value;
  }
  if (value === null) return null;
  for (let index = TOKEN_LADDER.length - 1; index >= 0; index--) {
    const preset = TOKEN_LADDER[index]!;
    if (preset < value) return preset;
  }
  return null;
}
