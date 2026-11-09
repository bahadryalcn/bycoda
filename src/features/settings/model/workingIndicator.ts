import { createStore } from "../../../shared/lib/store";
import {
  acceptAppearanceStorageChange,
  readAppearanceValue,
  writeAppearanceValue,
} from "./appearancePersistence";

/**
 * How a project row shows a working agent: which color the tint and pulse use, whether the pulse
 * animates, and how strong both read. "auto" follows Appearance: the chosen accent (a theme palette
 * or the accent picker sets `--user-accent-color`), else the built-in working blue, since the
 * default accent is a neutral gray that would hide the signal.
 */
export type WorkingIndicatorColor = "auto" | "theme" | "custom";
export type WorkingIndicatorStyle = "pulse" | "steady" | "off";
export type WorkingIndicator = {
  color: WorkingIndicatorColor;
  customColor: string | null;
  style: WorkingIndicatorStyle;
  strength: number;
};
export const WORKING_INDICATOR_DEFAULT: WorkingIndicator = {
  color: "auto",
  customColor: null,
  style: "pulse",
  strength: 100,
};
export const WORKING_INDICATOR_KEY = "bycoda.workingIndicator.v1";
export const WORKING_INDICATOR_STRENGTH_MIN = 50;
export const WORKING_INDICATOR_STRENGTH_MAX = 250;
const listeners = createStore();
let watching = false;

export function normalizeWorkingIndicator(value: unknown): WorkingIndicator {
  const input = value && typeof value === "object" ? (value as Partial<WorkingIndicator>) : {};
  const color = input.color === "theme" || input.color === "custom" ? input.color : "auto";
  const customColor =
    typeof input.customColor === "string" && /^#[0-9a-f]{6}$/i.test(input.customColor)
      ? input.customColor.toLowerCase()
      : null;
  const style = input.style === "steady" || input.style === "off" ? input.style : "pulse";
  const strength =
    typeof input.strength === "number" && Number.isFinite(input.strength)
      ? Math.max(
          WORKING_INDICATOR_STRENGTH_MIN,
          Math.min(WORKING_INDICATOR_STRENGTH_MAX, Math.round(input.strength)),
        )
      : 100;
  return { color, customColor, style, strength };
}

export function loadWorkingIndicator(): WorkingIndicator {
  try {
    const raw = readAppearanceValue(WORKING_INDICATOR_KEY);
    return normalizeWorkingIndicator(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeWorkingIndicator(null);
  }
}

/** CSS color for a record; `null` keeps the stylesheet's Appearance-following default. */
export function workingIndicatorColor(value: WorkingIndicator): string | null {
  switch (value.color) {
    case "theme":
      // Mid lightness keeps the hue visible, as the interaction tint's Theme source does.
      return "hsl(var(--theme-hue) max(var(--theme-saturation), 40%) 60%)";
    case "custom":
      return value.customColor;
    default:
      return null;
  }
}

export function applyWorkingIndicator(value: WorkingIndicator): void {
  const record = normalizeWorkingIndicator(value);
  const root = document.documentElement;
  const color = workingIndicatorColor(record);
  if (color) root.style.setProperty("--ui-working-row-color", color);
  else root.style.removeProperty("--ui-working-row-color");
  if (record.strength === 100) root.style.removeProperty("--ui-working-row-strength");
  else root.style.setProperty("--ui-working-row-strength", String(record.strength / 100));
  root.dataset.workingIndicator = record.style;
}

function notify() {
  applyWorkingIndicator(loadWorkingIndicator());
  listeners.notify();
}

export function saveWorkingIndicator(value: WorkingIndicator): boolean {
  return writeAppearanceValue(
    WORKING_INDICATOR_KEY,
    JSON.stringify(normalizeWorkingIndicator(value)),
    "working-indicator",
    notify,
  );
}

export function subscribeWorkingIndicator(listener: () => void) {
  return listeners.subscribe(listener);
}

export function resetWorkingIndicator(): boolean {
  return saveWorkingIndicator(WORKING_INDICATOR_DEFAULT);
}

export function initWorkingIndicator(): void {
  applyWorkingIndicator(loadWorkingIndicator());
  if (watching) return;
  watching = true;
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== WORKING_INDICATOR_KEY && event.key !== null) return;
    acceptAppearanceStorageChange(WORKING_INDICATOR_KEY);
    notify();
  });
}
