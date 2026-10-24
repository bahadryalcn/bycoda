import { useSyncExternalStore } from "react";
import { clamp } from "../../../shared/lib/numbers";
import { t } from "../../../shared/i18n";

export const LIVE_BACKGROUND_KEY = "bycoda.liveBackground.v1";
export const LIVE_BACKGROUND_INTENSITY_KEY = "bycoda.liveBackgroundIntensity.v1";
export const LIVE_BACKGROUND_CHANGE_EVENT = "bycoda:livebackgroundchange";

export type LiveBackground =
  | "none"
  | "neural-tree"
  | "latent-face"
  | "thought-weaver"
  | "ascii-mask";

export const LIVE_BACKGROUNDS: readonly LiveBackground[] = [
  "none",
  "neural-tree",
  "latent-face",
  "thought-weaver",
  "ascii-mask",
];

/** New installations stay still until the owner chooses a scene. */
export const LIVE_BACKGROUND_DEFAULT: LiveBackground = "none";
// Keep the old stored ID reversible; reads resolve it into the new collection.
const LEGACY_LIVE_BACKGROUND_DEFAULT = "gradient-ascii";
const LEGACY_SCENES: Readonly<Record<string, LiveBackground>> = {
  "world-tree": "neural-tree",
  "gradient-ascii": "latent-face",
  orb: "latent-face",
  "code-rain": "thought-weaver",
  "micro-slats": "thought-weaver",
  "web-threads": "thought-weaver",
  scanner: "thought-weaver",
  lightfall: "thought-weaver",
  prism: "thought-weaver",
  "side-rays": "thought-weaver",
  "light-rays": "thought-weaver",
  "pixel-blast": "thought-weaver",
  "dot-grid": "thought-weaver",
  hyperspeed: "thought-weaver",
  "letter-glitch": "thought-weaver",
};

export const LIVE_BACKGROUND_INTENSITY_MIN = 0.05;
export const LIVE_BACKGROUND_INTENSITY_MAX = 0.8;
export const LIVE_BACKGROUND_INTENSITY_DEFAULT = 0.35;

export function liveBackgroundLabel(value: LiveBackground): string {
  switch (value) {
    case "none":
      return t("None");
    case "neural-tree":
      return t("Neural tree");
    case "latent-face":
      return t("Latent face");
    case "thought-weaver":
      return t("Thought weaver");
    case "ascii-mask":
      return t("ASCII mask");
  }
}

export function liveBackgroundDescription(value: LiveBackground): string {
  switch (value) {
    case "none":
      return t("No animated layer behind chat panes.");
    case "neural-tree":
      return t("A quiet neural tree. Light follows its branches while the AI replies.");
    case "latent-face":
      return t("An AI portrait in ASCII, with subtle changes while the AI replies.");
    case "thought-weaver":
      return t("A small digital loom weaves delicate threads while the AI replies.");
    case "ascii-mask":
      return t("A faint mask surfaces from an ASCII gradient while the AI replies.");
  }
}

function isLiveBackground(value: unknown): value is LiveBackground {
  return typeof value === "string" && (LIVE_BACKGROUNDS as readonly string[]).includes(value);
}

/** Installs from before the still default keep the scene they have been seeing:
 * an earlier onboarding or project history marks one, and the old default is saved once. */
function keepLegacyDefault() {
  try {
    if (localStorage.getItem(LIVE_BACKGROUND_KEY) !== null) return;
    const earlier =
      localStorage.getItem("bycoda.onboarding.v1") !== null ||
      localStorage.getItem("bycoda.recentProjects") !== null;
    if (earlier) localStorage.setItem(LIVE_BACKGROUND_KEY, LEGACY_LIVE_BACKGROUND_DEFAULT);
  } catch {
    // Storage unavailable: the still default applies for this run.
  }
}
keepLegacyDefault();

export function loadLiveBackground(): LiveBackground {
  try {
    const raw = localStorage.getItem(LIVE_BACKGROUND_KEY);
    return isLiveBackground(raw)
      ? raw
      : raw !== null && Object.prototype.hasOwnProperty.call(LEGACY_SCENES, raw)
        ? LEGACY_SCENES[raw]
        : LIVE_BACKGROUND_DEFAULT;
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
