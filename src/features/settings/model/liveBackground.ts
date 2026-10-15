import { useSyncExternalStore } from "react";
import { clamp } from "../../../shared/lib/numbers";
import { t } from "../../../shared/i18n";

export const LIVE_BACKGROUND_KEY = "bycoda.liveBackground.v1";
export const LIVE_BACKGROUND_INTENSITY_KEY = "bycoda.liveBackgroundIntensity.v1";
export const LIVE_BACKGROUND_CHANGE_EVENT = "bycoda:livebackgroundchange";

export type LiveBackground = "none" | "code-rain" | "galaxy" | "water" | "aurora";

export const LIVE_BACKGROUNDS: readonly LiveBackground[] = [
  "none",
  "code-rain",
  "galaxy",
  "water",
  "aurora",
];

export const LIVE_BACKGROUND_DEFAULT: LiveBackground = "none";

export const LIVE_BACKGROUND_INTENSITY_MIN = 0.05;
export const LIVE_BACKGROUND_INTENSITY_MAX = 0.8;
export const LIVE_BACKGROUND_INTENSITY_DEFAULT = 0.35;

export function liveBackgroundLabel(value: LiveBackground): string {
  switch (value) {
    case "none":
      return t("None");
    case "code-rain":
      return t("Code rain");
    case "galaxy":
      return t("Galaxy");
    case "water":
      return t("Water");
    case "aurora":
      return t("Aurora");
  }
}

export function liveBackgroundDescription(value: LiveBackground): string {
  switch (value) {
    case "none":
      return t("No animated layer behind chat panes.");
    case "code-rain":
      return t("Flickering characters drift down behind the conversation.");
    case "galaxy":
      return t("A slowly turning spiral of stars.");
    case "water":
      return t("Raindrops ripple across a still surface.");
    case "aurora":
      return t("Soft bands of light wave across the pane.");
  }
}

function isLiveBackground(value: unknown): value is LiveBackground {
  return typeof value === "string" && (LIVE_BACKGROUNDS as readonly string[]).includes(value);
}

export function loadLiveBackground(): LiveBackground {
  try {
    const raw = localStorage.getItem(LIVE_BACKGROUND_KEY);
    return isLiveBackground(raw) ? raw : LIVE_BACKGROUND_DEFAULT;
  } catch {
    return LIVE_BACKGROUND_DEFAULT;
  }
}

export function loadLiveBackgroundIntensity(): number {
  try {
    const raw = localStorage.getItem(LIVE_BACKGROUND_INTENSITY_KEY);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed)
      ? clamp(parsed, LIVE_BACKGROUND_INTENSITY_MIN, LIVE_BACKGROUND_INTENSITY_MAX)
      : LIVE_BACKGROUND_INTENSITY_DEFAULT;
  } catch {
    return LIVE_BACKGROUND_INTENSITY_DEFAULT;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIVE_BACKGROUND_CHANGE_EVENT));
}

export function saveLiveBackground(value: LiveBackground) {
  write(LIVE_BACKGROUND_KEY, isLiveBackground(value) ? value : LIVE_BACKGROUND_DEFAULT);
}

export function saveLiveBackgroundIntensity(value: number) {
  write(
    LIVE_BACKGROUND_INTENSITY_KEY,
    String(clamp(value, LIVE_BACKGROUND_INTENSITY_MIN, LIVE_BACKGROUND_INTENSITY_MAX)),
  );
}

/** Other windows follow through storage events. */
function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === LIVE_BACKGROUND_KEY ||
      event.key === LIVE_BACKGROUND_INTENSITY_KEY
    ) {
      listener();
    }
  };
  window.addEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLiveBackground(): LiveBackground {
  return useSyncExternalStore(subscribe, loadLiveBackground, () => LIVE_BACKGROUND_DEFAULT);
}

export function useLiveBackgroundIntensity(): number {
  return useSyncExternalStore(
    subscribe,
    loadLiveBackgroundIntensity,
    () => LIVE_BACKGROUND_INTENSITY_DEFAULT,
  );
}
