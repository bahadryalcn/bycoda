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
export * from "./core";

/** React subscriptions update labels without remounting sessions or inputs. */
export function useLocale(domain?: LanguageDomain): Locale {
  useSyncExternalStore(subscribeLocale, localeRevision, () => 0);
  return getLocale(domain);
}

/** Stable per-language translator for components compiled by React Compiler. */
export function useT(): typeof t {
  return useSyncExternalStore(subscribeLocale, boundTranslator, boundTranslator);
}
