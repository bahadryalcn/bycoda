import { useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** Dense rows or roomier cards for the Servers inventory. */
export type ServersLayout = "list" | "cards";

const EVENT = "bycoda:servers-layout";

const layoutSetting = createStoredSetting<ServersLayout>({
  key: "bycoda.servers.layout",
  fallback: "list",
  event: EVENT,
  storageEvents: true,
  parse: (raw) => (raw === "cards" ? "cards" : "list"),
  serialize: (value) => value,
});

/** Persisted in localStorage so the choice survives restarts and sibling windows. */
export function useServersLayout(): [ServersLayout, (value: ServersLayout) => void] {
  const layout = useSyncExternalStore(
    layoutSetting.subscribe,
    layoutSetting.load,
    () => "list" as const,
  );
  return [layout, layoutSetting.save];
}

export function resetServersLayoutForTests() {
  try {
    localStorage.removeItem("bycoda.servers.layout");
  } catch {
    // Storage may be unavailable in private mode; the fallback still applies.
  }
}
