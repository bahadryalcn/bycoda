import { useSyncExternalStore } from "react";
import { getTabGroupLogosSnapshot } from "../../workspace/public/tabGroups";
import { subscribeTabGroupLogos } from "../../workspace/model/projectLogoState";

const NO_LOGOS: Record<string, string> = {};

/** Reactive logo record; every mounted reader shares one parse per stored change. */
export function useTabGroupLogos(): Record<string, string> {
  return useSyncExternalStore(subscribeTabGroupLogos, getTabGroupLogosSnapshot, () => NO_LOGOS);
}
