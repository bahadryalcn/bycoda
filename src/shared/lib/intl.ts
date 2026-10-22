/** Bounded, option-aware formatter caches shared by all feature surfaces. */
const dates = new Map<string, Intl.DateTimeFormat>();
const relatives = new Map<string, Intl.RelativeTimeFormat>();
const collators = new Map<string, Intl.Collator>();
function cached<T>(
  cache: Map<string, T>,
  locale: Intl.LocalesArgument,
  options: object | undefined,
  create: () => T,
): T {
  const key = JSON.stringify([
    locale ?? null,
    Object.entries(options ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  const hit = cache.get(key);
  if (hit) return hit;
  const value = create();
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
export const dateTimeFormat = (
  locale?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) => cached(dates, locale, options, () => new Intl.DateTimeFormat(locale, options));
export const relativeTimeFormat = (
  locale?: Intl.LocalesArgument,
  options?: Intl.RelativeTimeFormatOptions,
) => cached(relatives, locale, options, () => new Intl.RelativeTimeFormat(locale, options));
export const collator = (locale?: Intl.LocalesArgument, options?: Intl.CollatorOptions) =>
  cached(collators, locale, options, () => new Intl.Collator(locale, options));
