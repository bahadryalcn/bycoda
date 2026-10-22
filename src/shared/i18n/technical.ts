import { getLocale as currentLocale, useLocale as subscribeLocale, translateAt } from "./index";

export const getLocale = () => currentLocale("technical");
export const useLocale = () => subscribeLocale("technical");
export const t = (message: string, values?: Record<string, unknown>) =>
  translateAt(getLocale(), message, values);
