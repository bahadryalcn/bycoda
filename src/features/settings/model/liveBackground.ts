import { useSyncExternalStore } from "react";
import { clamp } from "../../../shared/lib/numbers";
import { t } from "../../../shared/i18n";

export const LIVE_BACKGROUND_KEY = "bycoda.liveBackground.v1";
export const LIVE_BACKGROUND_INTENSITY_KEY = "bycoda.liveBackgroundIntensity.v1";
export const LIVE_BACKGROUND_CHANGE_EVENT = "bycoda:livebackgroundchange";

export type LiveBackground =
  | "none"
  | "gradient-ascii"
  | "code-rain"
  | "micro-slats"
  | "web-threads"
  | "scanner"
  | "lightfall"
  | "prism"
  | "side-rays"
  | "light-rays"
  | "pixel-blast"
  | "dot-grid"
  | "hyperspeed"
  | "orb"
  | "world-tree"
  | "letter-glitch";

export const LIVE_BACKGROUNDS: readonly LiveBackground[] = [
  "none",
  "gradient-ascii",
  "code-rain",
  "micro-slats",
  "web-threads",
  "scanner",
  "lightfall",
  "prism",
  "side-rays",
  "light-rays",
  "pixel-blast",
  "dot-grid",
  "hyperspeed",
  "letter-glitch",
  "orb",
  "world-tree",
];

export const LIVE_BACKGROUND_DEFAULT: LiveBackground = "gradient-ascii";

export const LIVE_BACKGROUND_INTENSITY_MIN = 0.05;
export const LIVE_BACKGROUND_INTENSITY_MAX = 0.8;
export const LIVE_BACKGROUND_INTENSITY_DEFAULT = 0.35;

export function liveBackgroundLabel(value: LiveBackground): string {
  switch (value) {
    case "orb":
      return t("Orb");
    case "world-tree":
      return t("World tree");
    case "none":
      return t("None");
    case "code-rain":
      return t("Code rain");
    case "gradient-ascii":
      return t("Gradient ASCII");
    case "micro-slats":
      return t("Micro slats");
    case "web-threads":
      return t("Web threads");
    case "scanner":
      return t("Scanner");
    case "lightfall":
      return t("Lightfall");
    case "prism":
      return t("Prism");
    case "side-rays":
      return t("Side rays");
    case "light-rays":
      return t("Light rays");
    case "pixel-blast":
      return t("Pixel blast");
    case "dot-grid":
      return t("Dot grid");
    case "hyperspeed":
      return t("Hyperspeed");
    case "letter-glitch":
      return t("Letter glitch");
  }
}

export function liveBackgroundDescription(value: LiveBackground): string {
  switch (value) {
    case "orb":
      return t("A flowing ring of light that breathes and brightens while the AI replies.");
    case "world-tree":
      return t(
        "A world tree woven from code. Light travels from its roots to its branches while the AI replies.",
      );
    case "none":
      return t("No animated layer behind chat panes.");
    case "gradient-ascii":
      return t(
        "A talking AI face formed in ASCII characters; its lips move while a reply streams.",
      );
    case "code-rain":
      return t("Flickering characters drift down behind the conversation.");
    case "micro-slats":
      return t("Fine slats that tilt and shimmer while the AI replies.");
    case "web-threads":
      return t("A web of threads that tightens and pulses while the AI replies.");
    case "scanner":
      return t("A scan line sweeps the pane, quickening while the AI replies.");
    case "lightfall":
      return t("Streaks of light fall through the pane, brighter while the AI replies.");
    case "prism":
      return t("Refracted light bands that drift while the AI replies.");
    case "side-rays":
      return t("Rays fanning in from the side, pulsing while the AI replies.");
    case "light-rays":
      return t("Soft light rays radiating outward, strengthening while the AI replies.");
    case "pixel-blast":
      return t("Pixel bursts that bloom and scatter while the AI replies.");
    case "dot-grid":
      return t("A grid of dots that ripples outward while the AI replies.");
    case "hyperspeed":
      return t("Streaking stars rush past, faster while the AI replies.");
    case "letter-glitch":
      return t("Letters flicker and glitch in place, intensifying while the AI replies.");
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
