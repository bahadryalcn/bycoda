import { version as APP_VERSION } from "../../../../package.json";
import type { GuideAction } from "./guide";
import type { TourStepDef } from "./tourSteps";
import type { UsageGuideTarget } from "./usageGuideTargets";

/**
 * A new feature worth pointing at after an update.
 *
 * - `id`: stable and unique; remembered once the user has seen the highlight.
 * - `sinceVersion`: the release that ships the feature (`0.8.0`). Users who updated from an
 *   older version see it once; fresh installs and users already on that version never do.
 * - `target`: the `data-usage-guide` name of the control to point at. Add the attribute to
 *   the control (and the name to `usageGuideTargets.ts`) when it has none yet.
 * - `reveal`: optional safe navigation action that brings a hidden target on screen.
 */
export type FeatureHighlight = {
  id: string;
  sinceVersion: string;
  target: UsageGuideTarget;
  title: string;
  body: string;
  reveal?: GuideAction;
};

/**
 * The registry. Add one entry per user-visible feature in the release that ships it, build the
 * list here (not at module load) with literal `t()` calls so the locale checker sees them, and
 * add the strings to the eight locale catalogs. Remove an entry when it is a few releases old;
 * leaving it is harmless because nobody older than `sinceVersion` is left.
 *
 * Example (kept as a comment so nothing ships by accident):
 *
 *   import { t } from "../../../shared/i18n";
 *   return [
 *     {
 *       id: "terminal.split",
 *       sinceVersion: "0.8.0",
 *       target: "terminal-toggle",
 *       title: t("Split the terminal"),
 *       body: t("Run two shells side by side from the terminal menu."),
 *     },
 *   ];
 */
export function featureHighlights(): FeatureHighlight[] {
  return [];
}

const KEY = "bycoda.highlights.v1";
const listeners = new Set<() => void>();

type HighlightState = {
  /** The version up to which highlights were handled; only newer entries are pending. */
  baseline: string;
  seen: string[];
};

/** `0.7.0`, `v0.7.0-beta.1` → [0, 7, 0]; the pre-release suffix is ignored. */
function versionParts(version: string): number[] {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function parse(raw: string | null): HighlightState | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { baseline, seen } = value as Record<string, unknown>;
    if (typeof baseline !== "string" || !baseline) return null;
    return {
      baseline,
      seen: Array.isArray(seen) ? seen.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return null;
  }
}

/** Kept for this window when storage is unavailable, so a marker never reappears after a click. */
let fallback: HighlightState | null = null;

function loadState(): HighlightState | null {
  try {
    return parse(localStorage.getItem(KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveState(state: HighlightState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    fallback = null;
  } catch {
    fallback = state;
  }
  for (const listener of listeners) listener();
}

/** Stable string snapshot for `useSyncExternalStore`. */
export function getHighlightsSnapshot(): string {
  const state = loadState();
  return state ? `${state.baseline}|${state.seen.join(",")}` : "";
}

export function subscribeHighlights(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What changed since the user last looked: entries newer than the baseline, up to this build. */
export function pendingHighlights(
  currentVersion: string = APP_VERSION,
  all: readonly FeatureHighlight[] = featureHighlights(),
): FeatureHighlight[] {
  const state = loadState();
  // No record yet: a fresh install (or the first run of this feature) starts from now.
  if (!state) return [];
  return all.filter(
    (item) =>
      !state.seen.includes(item.id) &&
      compareVersions(item.sinceVersion, state.baseline) > 0 &&
      compareVersions(item.sinceVersion, currentVersion) <= 0,
  );
}

/**
 * Run once per window at startup. Without a record the user starts from this version, so a
 * fresh install never sees old highlights (the first-run tour already covers them). With a
 * record, the baseline moves forward as soon as nothing is pending.
 */
export function syncHighlightBaseline(
  currentVersion: string = APP_VERSION,
  all: readonly FeatureHighlight[] = featureHighlights(),
): void {
  const state = loadState();
  if (!state) {
    saveState({ baseline: currentVersion, seen: [] });
    return;
  }
  if (pendingHighlights(currentVersion, all).length > 0) return;
  if (compareVersions(currentVersion, state.baseline) > 0)
    saveState({ baseline: currentVersion, seen: state.seen });
}

/** Called when the user clicks the marked control or the tour has shown the highlight. */
export function markHighlightSeen(
  id: string,
  currentVersion: string = APP_VERSION,
  all: readonly FeatureHighlight[] = featureHighlights(),
): void {
  const state = loadState();
  if (!state || state.seen.includes(id)) return;
  saveState({ baseline: state.baseline, seen: [...state.seen, id] });
  syncHighlightBaseline(currentVersion, all);
}

/** The highlights as cards of the shared tour. */
export function highlightTourSteps(items: readonly FeatureHighlight[]): TourStepDef[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    targets: [item.target],
    reveal: item.reveal,
  }));
}
