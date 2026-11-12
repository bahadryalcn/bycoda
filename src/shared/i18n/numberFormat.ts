const formats = new Map<string, Intl.NumberFormat>();

/** Bounded number formatter cache; option insertion order does not affect identity. */
export function numberFormat(
  locale?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = JSON.stringify([
    locale ?? null,
    Object.entries(options ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  const cached = formats.get(key);
  if (cached) return cached;
  const format = new Intl.NumberFormat(locale, options);
  if (formats.size >= 64) formats.delete(formats.keys().next().value!);
  formats.set(key, format);
  return format;
}
