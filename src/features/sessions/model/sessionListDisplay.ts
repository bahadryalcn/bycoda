import { useSyncExternalStore } from "react";

/**
 * How session rows are drawn in the sidebar. A view preference, kept apart
 * from `SessionSidebarFilters` so it never counts as an active filter or gets
 * reset by "Clear filters".
 */
export type SessionListDensity = "compact" | "standard" | "detailed";

export type SessionListDisplay = {
  density: SessionListDensity;
  showModel: boolean;
  showBranch: boolean;
  /** How long a dragged session rests on another before they group. */
  groupDelayMs: number;
};

export const SESSION_LIST_DENSITIES: readonly SessionListDensity[] = [
  "compact",
  "standard",
  "detailed",
];

export const DEFAULT_SESSION_LIST_DISPLAY: SessionListDisplay = {
  density: "standard",
  showModel: true,
  showBranch: true,
  groupDelayMs: 700,
};

export const GROUP_DELAY_MIN_MS = 300;
export const GROUP_DELAY_MAX_MS = 1500;

const DISPLAY_KEY = "bycoda.sessionListDisplay.v1";
const CHANGE_EVENT = "bycoda:sessionlistdisplaychange";

let cached: SessionListDisplay | null = null;
const listeners = new Set<() => void>();

export function parseSessionListDisplay(raw: string | null): SessionListDisplay {
  if (!raw) return DEFAULT_SESSION_LIST_DISPLAY;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof SessionListDisplay, unknown>>;
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    return {
      density: SESSION_LIST_DENSITIES.includes(parsed.density as SessionListDensity)
        ? (parsed.density as SessionListDensity)
        : DEFAULT_SESSION_LIST_DISPLAY.density,
      showModel: flag(parsed.showModel, DEFAULT_SESSION_LIST_DISPLAY.showModel),
      showBranch: flag(parsed.showBranch, DEFAULT_SESSION_LIST_DISPLAY.showBranch),
      groupDelayMs:
        typeof parsed.groupDelayMs === "number" && Number.isFinite(parsed.groupDelayMs)
          ? Math.round(
              Math.min(GROUP_DELAY_MAX_MS, Math.max(GROUP_DELAY_MIN_MS, parsed.groupDelayMs)),
            )
          : DEFAULT_SESSION_LIST_DISPLAY.groupDelayMs,
    };
  } catch {
    return DEFAULT_SESSION_LIST_DISPLAY;
  }
}

export function loadSessionListDisplay(): SessionListDisplay {
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DISPLAY_KEY);
  } catch {
    /* storage unavailable: defaults */
  }
  cached = parseSessionListDisplay(raw);
  return cached;
}

export function saveSessionListDisplay(next: SessionListDisplay): void {
  // Normalized like a stored value, so a stale or partial caller cannot set
  // an out-of-range delay.
  const raw = JSON.stringify(next);
  cached = parseSessionListDisplay(raw);
  try {
    localStorage.setItem(DISPLAY_KEY, raw);
  } catch {
    /* keep the in-memory choice for this run */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  else notify();
}

export function updateSessionListDisplay(patch: Partial<SessionListDisplay>): void {
  saveSessionListDisplay({ ...loadSessionListDisplay(), ...patch });
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== DISPLAY_KEY && event.key !== null) return;
  cached = null;
  notify();
}

/** Every sidebar and the settings page share one set of window listeners. */
function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const subscription = () => listener();
  listeners.add(subscription);
  if (listeners.size === 1) {
    window.addEventListener(CHANGE_EVENT, notify);
    window.addEventListener("storage", onStorage);
  }
  return () => {
    if (!listeners.delete(subscription) || listeners.size !== 0) return;
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSessionListDisplay(): SessionListDisplay {
  return useSyncExternalStore(
    subscribe,
    loadSessionListDisplay,
    () => DEFAULT_SESSION_LIST_DISPLAY,
  );
}

/**
 * The short label for narrow rows: the family word of spaced names, without
 * the vendor ("Claude Opus 5.5" → "Opus"), or the name without its variant
 * suffix ("GPT-6.1-Sol" → "GPT-6.1").
 */
export function shortModelName(name: string): string {
  const trimmed = name.trim().replace(/^Claude\s+/i, "");
  const space = trimmed.indexOf(" ");
  if (space > 0) return trimmed.slice(0, space);
  const variant = /^(.*\d.*)-[A-Za-z]+$/.exec(trimmed);
  return variant ? variant[1] : trimmed;
}
