import { getLocale as currentLocale, useLocale as subscribeLocale, translateAt } from "./index";
import { useMemo } from "react";

export const getLocale = () => currentLocale("technical");
export const useLocale = () => subscribeLocale("technical");
export const t = (message: string, values?: Record<string, unknown>) =>
  translateAt(getLocale(), message, values);

/** Locale-bound translator for compiler-managed technical controls. */
export function useT(): typeof t {
  const locale = useLocale();
  return useMemo(() => (message, values) => translateAt(locale, message, values), [locale]);
}
