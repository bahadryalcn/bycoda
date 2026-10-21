import { useSyncExternalStore } from "react";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import { normalizeProjectMascotName } from "../../projects/model/projectMascots";

// The host keeps only what runs a crew; how it looks on this device lives here,
// like project group icons and colors.
const APPEARANCE_KEY = "bycoda:crews:appearance";
const RAIL_KEY = "bycoda:crews:show-on-rail";
const CHANGED = "bycoda:crews-appearance-changed";

export type CrewAppearance = {
  /** A project mascot name; unset uses the one hashed from the crew id. */
  icon?: string;
  /** Index into `TAB_GROUP_COLORS`; unset or 0 keeps the mascot's own colors. */
  color?: number;
};

let cache: { raw: string | null; value: Record<string, CrewAppearance> } | null = null;

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
      if (!entry || typeof entry !== "object") continue;
      const { icon, color } = entry as Record<string, unknown>;
      const name = typeof icon === "string" ? normalizeProjectMascotName(icon) : null;
      value[id] = {
        ...(name ? { icon: name } : {}),
        ...(typeof color === "number" &&
        Number.isInteger(color) &&
        color > 0 &&
        color < TAB_GROUP_COLORS.length
          ? { color }
          : {}),
      };
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

export function crewColor(appearance: CrewAppearance | undefined): string | undefined {
  return appearance?.color ? TAB_GROUP_COLORS[appearance.color] : undefined;
}

export function loadCrewsOnRail(): boolean {
  return read(RAIL_KEY) !== "false";
}

export function saveCrewsOnRail(shown: boolean) {
  write(RAIL_KEY, String(shown));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_KEY || event.key === RAIL_KEY) {
      cache = null;
      onChange();
    }
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCrewAppearances() {
  return useSyncExternalStore(subscribe, loadCrewAppearances, loadCrewAppearances);
}

export function useCrewsOnRail() {
  return useSyncExternalStore(subscribe, loadCrewsOnRail, loadCrewsOnRail);
}
