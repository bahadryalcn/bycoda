import { useSyncExternalStore } from "react";
import {
  subscribeLocale,
  localeRevision,
  getLocale,
  boundTranslator,
  type LanguageDomain,
  type Locale,
  type t,
} from "./core";
import { boundFormat, type BoundFormat } from "./boundFormat";
export * from "./core";
export type { BoundFormat } from "./boundFormat";
export { dateTimeFormat, relativeTimeFormat } from "../lib/intl";

/** React subscriptions update labels without remounting sessions or inputs. */
export function useLocale(domain?: LanguageDomain): Locale {
  useSyncExternalStore(subscribeLocale, localeRevision, () => 0);
  return getLocale(domain);
}

/** Stable per-language translator for components compiled by React Compiler. */
export function useT(): typeof t {
  return useSyncExternalStore(subscribeLocale, boundTranslator, boundTranslator);
}

/**
 * Locale-dependent formatters for components compiled by React Compiler. Use it when a
 * render path formats a number, date, size, duration or relative time: the module functions
 * (`formatNumber`, `formatDuration`, ...) read the current language, which the compiler cannot
 * see, so it opts such components out. The returned object is one stable instance per
 * language, so memoized output recomputes exactly when the language changes. Members have the
 * module functions' signatures and results, except `formatRelativeTime`,
 * `formatGithubRelativeTime` and `formatChatDate`, whose `now` is required (pass a clock value
 * from state or props; never read `Date.now()` in render). Keep the module functions for
 * handlers, effects, non-React code and hosts.
 */
export function useFormat(): BoundFormat {
  return useSyncExternalStore(subscribeLocale, boundFormat, boundFormat);
}
