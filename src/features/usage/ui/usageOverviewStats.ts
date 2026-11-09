import type { UsagePricing } from "../../providers/public/accountUsage";
import type { UsageSample } from "../model/usageAnalytics";

/** Derived figures of the usage overview's filtered samples. */
export function usageSampleStats(samples: UsageSample[], pricing: UsagePricing) {
  const unpriced = new Set<string>();
  let pricedTokens = 0;
  const days = new Set<string>();
  let cacheSavings = 0;
  for (const sample of samples) {
    if (sample.priced) pricedTokens += sample.tokens;
    else unpriced.add(sample.model);
    if (sample.tokens > 0) days.add(new Date(sample.at).toDateString());
    const rate = pricing(sample.model);
    if (rate) cacheSavings += (sample.cacheRead * (rate.input - rate.cacheRead)) / 1_000_000;
  }
  return {
    /** Models with at least one sample that has no list price, in first-seen order. */
    unpriced: [...unpriced],
    pricedTokens,
    /** Calendar days (local time) with any token usage. */
    activeDays: days.size,
    /** Dollars saved by cache reads, valued at the input-minus-cache-read rate. */
    cacheSavings,
  };
}

/** Rows whose text contains the search, case-folded for `locale`. */
export function searchRows<T>(
  rows: T[],
  text: (row: T) => string,
  search: string,
  locale: string,
): T[] {
  const needle = search.toLocaleLowerCase(locale);
  return rows.filter((row) => text(row).toLocaleLowerCase(locale).includes(needle));
}
