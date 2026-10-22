import { getLocale as currentLocale, useLocale as subscribeLocale, translateAt } from "./index";

export const getLocale = () => currentLocale("git");
export const useLocale = () => subscribeLocale("git");
export const t = (message: string, values?: Record<string, unknown>) =>
  translateAt(getLocale(), message, values);
