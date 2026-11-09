import { createStore } from "../../../shared/lib/store";
import { mixInOklab, relativeLuminance } from "./accentContrast";
import { themePalette } from "../../../shared/theme/palette";
import {
  acceptAppearanceStorageChange,
  readAppearanceValue,
  writeAppearanceValue,
} from "./appearancePersistence";

export type InteractionTintSource = "neutral" | "theme" | "accent" | "custom";
export type InteractionTint = {
  source: InteractionTintSource;
  customColor: string | null;
  strength: number;
};
export const INTERACTION_TINT_DEFAULT: InteractionTint = {
  source: "neutral",
  customColor: null,
  strength: 100,
};
export const INTERACTION_TINT_KEY = "bycoda.interactionTint.v1";
/** Percent of the tint each state mixes in at strength 100%. Mirrors `--ui-surface-*` in src/styles/index.css. */
export const INTERACTION_STEP_PERCENT = {
  dark: { hover: 7, selected: 15, pressed: 24 },
  light: { hover: 4, selected: 10, pressed: 16 },
} as const;

/** The percentages the current scheme and strength actually show. */
export function interactionStepPercent(light: boolean, strength: number) {
  const steps = INTERACTION_STEP_PERCENT[light ? "light" : "dark"];
  const scale = strength / 100;
  return {
    hover: Math.round(steps.hover * scale),
    selected: Math.round(steps.selected * scale),
    pressed: Math.round(steps.pressed * scale),
  };
}
const listeners = createStore();
let watching = false;

export function normalizeInteractionTint(value: unknown): InteractionTint {
  const input = value && typeof value === "object" ? (value as Partial<InteractionTint>) : {};
  const source =
    input.source === "theme" || input.source === "accent" || input.source === "custom"
      ? input.source
      : "neutral";
  const customColor =
    typeof input.customColor === "string" && /^#[0-9a-f]{6}$/i.test(input.customColor)
      ? input.customColor.toLowerCase()
      : null;
  const strength =
    typeof input.strength === "number" && Number.isFinite(input.strength)
      ? Math.max(50, Math.min(200, Math.round(input.strength)))
      : 100;
  return { source, customColor, strength };
}

export function loadInteractionTint(): InteractionTint {
  try {
    const raw = readAppearanceValue(INTERACTION_TINT_KEY);
    return normalizeInteractionTint(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeInteractionTint(null);
  }
}

export function applyInteractionTint(value: InteractionTint): void {
  const record = normalizeInteractionTint(value);
  const style = document.documentElement.style;
  if (record.source === "neutral" || (record.source === "custom" && !record.customColor)) {
    style.removeProperty("--ui-interaction-tint");
    style.removeProperty("--ui-interaction-strength");
    return;
  }
  let tint =
    record.source === "theme"
      ? // Mid lightness keeps the hue visible; the near-white content tone would mix back to gray.
        "hsl(var(--theme-hue) max(var(--theme-saturation), 40%) 60%)"
      : "var(--user-accent-color, var(--color-content))";
  if (record.source === "custom" && record.customColor) {
    tint = record.customColor;
    // shortcut: cap extreme luminance at 0.8; upgrade to measured theme/text contrast when rendered surface colors are available.
    for (let step = 1; relativeLuminance(tint) > 0.8 && step <= 100; step++) {
      tint = mixInOklab(record.customColor, themePalette.scrim, step / 100);
    }
  }
  style.setProperty("--ui-interaction-tint", tint);
  style.setProperty("--ui-interaction-strength", String(record.strength / 100));
}

function notify() {
  applyInteractionTint(loadInteractionTint());
  listeners.notify();
}

export function saveInteractionTint(value: InteractionTint): boolean {
  return writeAppearanceValue(
    INTERACTION_TINT_KEY,
    JSON.stringify(normalizeInteractionTint(value)),
    "interaction-tint",
    notify,
  );
}

export function subscribeInteractionTint(listener: () => void) {
  return listeners.subscribe(listener);
}

export function resetInteractionTint(): boolean {
  return saveInteractionTint(INTERACTION_TINT_DEFAULT);
}

export function initInteractionTint(): void {
  applyInteractionTint(loadInteractionTint());
  if (watching) return;
  watching = true;
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== INTERACTION_TINT_KEY && event.key !== null) return;
    acceptAppearanceStorageChange(INTERACTION_TINT_KEY);
    notify();
  });
}
