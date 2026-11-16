import { useSyncExternalStore } from "react";
import { createWindowStore } from "../../../shared/lib/store";

const KEY = "bycoda.codeRunReport";
const CHANGE = "bycoda:code-run-report";
const store = createWindowStore({ event: CHANGE, storageKeys: [KEY] });

export const CODE_RUN_REPORT_DEFAULT = true;

/** Whether a finished chat code block adds its output to the composer. On unless turned off. */
export function loadCodeRunReport(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? CODE_RUN_REPORT_DEFAULT : stored === "on";
  } catch {
    return CODE_RUN_REPORT_DEFAULT;
  }
}

export function saveCodeRunReport(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // private mode / quota: the default stays in effect
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function useCodeRunReport(): boolean {
  return useSyncExternalStore(store.subscribe, loadCodeRunReport, () => CODE_RUN_REPORT_DEFAULT);
}
