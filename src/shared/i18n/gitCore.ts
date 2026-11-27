import { getLocale as currentLocale, translateAt } from "./core";

export const getLocale = () => currentLocale("git");
export const t = (message: string, values?: Record<string, unknown>) =>
  translateAt(getLocale(), message, values);
