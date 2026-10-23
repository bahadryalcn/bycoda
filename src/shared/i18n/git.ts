import { getLocale as currentLocale, useLocale as subscribeLocale, translateAt } from "./index";
import { useMemo } from "react";

export const getLocale = () => currentLocale("git");
export const useLocale = () => subscribeLocale("git");
export const t = (message: string, values?: Record<string, unknown>) =>
  translateAt(getLocale(), message, values);

/** Locale-bound translator for compiler-managed Git components. */
export function useT(): typeof t {
  const locale = useLocale();
  return useMemo(() => (message, values) => translateAt(locale, message, values), [locale]);
}
