import { useSyncExternalStore } from "react";
import {
  getSessionProjectAppearanceServerSnapshot,
  getSessionProjectAppearanceSnapshot,
  getSessionProjectBackground,
  subscribeSessionProjectAppearance,
} from "./sessionProjectAppearanceStore";

/**
 * A project or group's saved rail background. It lives in localStorage, which React Compiler
 * cannot see change, so rows read it through the appearance store like the session list does.
 */
export function useRailBackground(key: string, part: "header" | "body") {
  return useSyncExternalStore(
    subscribeSessionProjectAppearance,
    () => getSessionProjectBackground(getSessionProjectAppearanceSnapshot(), key, part),
    () => getSessionProjectBackground(getSessionProjectAppearanceServerSnapshot(), key, part),
  );
}
