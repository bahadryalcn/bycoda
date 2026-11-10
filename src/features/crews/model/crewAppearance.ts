import { useSyncExternalStore } from "react";
import { crewPaletteColor, parseAppearance, type CrewAppearance } from "./crewIdentity";
import { createWindowStore } from "../../../shared/lib/store";

// A host with `crews.identity.v1` stores a crew's look on the definition (`crewLook.ts`).
// This device-local copy serves older hosts and looks not yet migrated to the host.
// "Show crews on rail" is always a device preference.
const APPEARANCE_KEY = "bycoda:crews:appearance";
const RAIL_KEY = "bycoda:crews:show-on-rail";
const CHANGED = "bycoda:crews-appearance-changed";

export type { CrewAppearance };

let cache: { raw: string | null; value: Record<string, CrewAppearance> } | null = null;
const appearanceStore = createWindowStore({
  event: CHANGED,
  storageKeys: [APPEARANCE_KEY, RAIL_KEY],
  onStorage: () => {
    cache = null;
  },
});

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the change for this window when storage is unavailable.
  }
  cache = null;
  window.dispatchEvent(new Event(CHANGED));
}

export function loadCrewAppearances(): Record<string, CrewAppearance> {
  const raw = read(APPEARANCE_KEY);
  if (cache?.raw === raw) return cache.value;
  const value: Record<string, CrewAppearance> = {};
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      value[id] = parseAppearance(entry) ?? {};
    }
  } catch {
    // A corrupt entry falls back to every crew's default look.
  }
  cache = { raw, value };
  return value;
}

export function saveCrewAppearance(id: string, patch: CrewAppearance) {
  const all = { ...loadCrewAppearances() };
  const next = { ...all[id], ...patch };
  if (!next.icon) delete next.icon;
  if (!next.color) delete next.color;
  if (next.icon || next.color) all[id] = next;
  else delete all[id];
  write(APPEARANCE_KEY, JSON.stringify(all));
}

export function forgetCrewAppearance(id: string) {
  if (loadCrewAppearances()[id]) saveCrewAppearance(id, { icon: undefined, color: undefined });
}

export function crewColor(appearance: CrewAppearance | undefined): string | undefined {
  return crewPaletteColor(appearance?.color);
}

export function loadCrewsOnRail(): boolean {
  return read(RAIL_KEY) !== "false";
}

export function saveCrewsOnRail(shown: boolean) {
  write(RAIL_KEY, String(shown));
}

const subscribe = appearanceStore.subscribe;

export function useCrewAppearances() {
  return useSyncExternalStore(subscribe, loadCrewAppearances, loadCrewAppearances);
}

export function useCrewsOnRail() {
  return useSyncExternalStore(subscribe, loadCrewsOnRail, loadCrewsOnRail);
}
