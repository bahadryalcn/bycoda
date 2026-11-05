const formatters = new Map<string, Intl.DateTimeFormat>();

/** Civil date in the owner's explicit IANA time zone, or undefined for invalid input. */
export function ownerDay(at: number, timeZone: string): string | undefined {
  if (!Number.isFinite(at) || !timeZone) return undefined;
  try {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
      if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
      formatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(at);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return undefined;
  }
}

/** Add calendar days without assuming a local day has 24 hours. */
export function addCivilDays(day: string, offset: number): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(offset)) return undefined;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined;
  date.setUTCDate(date.getUTCDate() + offset);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

/** UTC instants enclosing the owner's current civil date, including DST transitions. */
export function ownerDayBounds(at: number, timeZone: string): { start: number; end: number } | undefined {
  const day = ownerDay(at, timeZone);
  if (!day) return undefined;
  const seek = (low: number, high: number, predicate: (value: string) => boolean) => {
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const value = ownerDay(middle, timeZone);
      if (!value) return undefined;
      if (predicate(value)) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const span = 72 * 60 * 60 * 1000;
  const center = Math.floor(at);
  const start = seek(center - span, center, value => value >= day);
  const end = seek(center, center + span, value => value > day);
  return start === undefined || end === undefined ? undefined : { start, end };
}
