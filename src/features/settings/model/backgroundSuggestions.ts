import { LIVE_BACKGROUNDS, type LiveBackground } from "./liveBackground";
import { WORKSPACE_BACKGROUND_PRESETS, type WorkspaceBackground } from "./workspaceBackground";

export { sanitizeBackgroundGradient } from "./backgroundGradient";
export type { BackgroundGradientSuggestion } from "./backgroundGradient";

/** Random combinations keep the live scene readable behind chat panes. */
export const BACKGROUND_RANDOM_VISIBILITY_MIN = 0.2;
export const BACKGROUND_RANDOM_VISIBILITY_MAX = 0.7;

export type BackgroundRandomCombination = {
  scene: Exclude<LiveBackground, "none">;
  intensity: number;
  gradient: WorkspaceBackground;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `random` returns [0, 1); out-of-range values are clamped so the pick stays in bounds. */
function pick<T>(items: readonly T[], random: () => number): T {
  const index = Math.min(items.length - 1, Math.floor(clamp(random(), 0, 1) * items.length));
  return items[index]!;
}

/** Dice button: a random live scene, a random gradient preset and a visibility from 20% to 70%. */
export function randomBackgroundCombination(
  random: () => number = Math.random,
): BackgroundRandomCombination {
  const scenes = LIVE_BACKGROUNDS.filter(
    (scene): scene is Exclude<LiveBackground, "none"> => scene !== "none",
  );
  const preset = pick(WORKSPACE_BACKGROUND_PRESETS, random);
  const span = BACKGROUND_RANDOM_VISIBILITY_MAX - BACKGROUND_RANDOM_VISIBILITY_MIN;
  const intensity =
    Math.round((BACKGROUND_RANDOM_VISIBILITY_MIN + clamp(random(), 0, 1) * span) * 100) / 100;
  return {
    scene: pick(scenes, random),
    intensity: clamp(intensity, BACKGROUND_RANDOM_VISIBILITY_MIN, BACKGROUND_RANDOM_VISIBILITY_MAX),
    gradient: { ...preset.value, enabled: true },
  };
}
