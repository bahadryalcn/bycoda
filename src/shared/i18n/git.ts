import { useLocale as subscribeLocale } from "./index";
import { translateAt } from "./core";
import { useMemo } from "react";
import type { t } from "./gitCore";

export { getLocale, t } from "./gitCore";
export const useLocale = () => subscribeLocale("git");

/** Locale-bound translator for compiler-managed Git components. */
export function useT(): typeof t {
  const locale = useLocale();
  return useMemo(() => (message, values) => translateAt(locale, message, values), [locale]);
}
