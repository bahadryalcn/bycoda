import { createStore } from "../../../shared/lib/store";
import {
  acceptAppearanceStorageChange,
  readAppearanceValue,
  writeAppearanceValue,
} from "./appearancePersistence";

/**
 * Scrollbars across the app (native bars, the editor rail and the terminal): the color the thumb
 * mixes in, its thickness, whether it shows at rest or only while the pointer is over the area, and
 * how strong the thumb reads. The default color follows Appearance: the chosen accent (a theme
 * palette or the accent picker sets `--user-accent-color`), else the neutral content tone; 6px, on hover.
 */
export type ScrollbarColor = "auto" | "neutral" | "theme" | "custom";
export type ScrollbarSize = "thin" | "medium" | "wide";
export type ScrollbarVisibility = "hover" | "always";
export type ScrollbarStyle = {
  color: ScrollbarColor;
  customColor: string | null;
  size: ScrollbarSize;
  visibility: ScrollbarVisibility;
  strength: number;
};
export const SCROLLBAR_STYLE_DEFAULT: ScrollbarStyle = {
  color: "auto",
  customColor: null,
  size: "thin",
  visibility: "hover",
  strength: 100,
};
export const SCROLLBAR_STYLE_KEY = "bycoda.scrollbarStyle.v1";
export const SCROLLBAR_STRENGTH_MIN = 50;
export const SCROLLBAR_STRENGTH_MAX = 200;
/** Thickness in CSS pixels; "thin" matches `--ui-scrollbar-size` in src/styles/index.css. */
export const SCROLLBAR_SIZE_PX: Record<ScrollbarSize, number> = { thin: 6, medium: 10, wide: 14 };
const listeners = createStore();
let watching = false;

export function normalizeScrollbarStyle(value: unknown): ScrollbarStyle {
  const input = value && typeof value === "object" ? (value as Partial<ScrollbarStyle>) : {};
  const color =
    input.color === "neutral" || input.color === "theme" || input.color === "custom"
      ? input.color
      : "auto";
  const customColor =
    typeof input.customColor === "string" && /^#[0-9a-f]{6}$/i.test(input.customColor)
      ? input.customColor.toLowerCase()
      : null;
  const size = input.size === "medium" || input.size === "wide" ? input.size : "thin";
  const visibility = input.visibility === "always" ? "always" : "hover";
  const strength =
    typeof input.strength === "number" && Number.isFinite(input.strength)
      ? Math.max(
          SCROLLBAR_STRENGTH_MIN,
          Math.min(SCROLLBAR_STRENGTH_MAX, Math.round(input.strength)),
        )
      : 100;
  return { color, customColor, size, visibility, strength };
}

export function loadScrollbarStyle(): ScrollbarStyle {
  try {
    const raw = readAppearanceValue(SCROLLBAR_STYLE_KEY);
    return normalizeScrollbarStyle(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeScrollbarStyle(null);
  }
}

/** CSS color the thumb mixes in; `null` keeps the stylesheet's Appearance-following default. */
export function scrollbarColor(value: ScrollbarStyle): string | null {
  switch (value.color) {
    case "neutral":
      return "var(--color-content)";
    case "theme":
      // Mid lightness keeps the hue visible, as the interaction tint's Theme source does.
      return "hsl(var(--theme-hue) max(var(--theme-saturation), 40%) 60%)";
    case "custom":
      return value.customColor;
    default:
      return null;
  }
}

export function applyScrollbarStyle(value: ScrollbarStyle): void {
  const record = normalizeScrollbarStyle(value);
  const root = document.documentElement;
  const color = scrollbarColor(record);
  if (color) root.style.setProperty("--ui-scrollbar-color", color);
  else root.style.removeProperty("--ui-scrollbar-color");
  if (record.size === "thin") root.style.removeProperty("--ui-scrollbar-size");
  else root.style.setProperty("--ui-scrollbar-size", `${SCROLLBAR_SIZE_PX[record.size]}px`);
  if (record.strength === 100) root.style.removeProperty("--ui-scrollbar-strength");
  else root.style.setProperty("--ui-scrollbar-strength", String(record.strength / 100));
  root.dataset.scrollbarVisibility = record.visibility;
}

function notify() {
  applyScrollbarStyle(loadScrollbarStyle());
  listeners.notify();
}

export function saveScrollbarStyle(value: ScrollbarStyle): boolean {
  return writeAppearanceValue(
    SCROLLBAR_STYLE_KEY,
    JSON.stringify(normalizeScrollbarStyle(value)),
    "scrollbar-style",
    notify,
  );
}

export function subscribeScrollbarStyle(listener: () => void) {
  return listeners.subscribe(listener);
}

export function resetScrollbarStyle(): boolean {
  return saveScrollbarStyle(SCROLLBAR_STYLE_DEFAULT);
}

export function initScrollbarStyle(): void {
  applyScrollbarStyle(loadScrollbarStyle());
  if (watching) return;
  watching = true;
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== SCROLLBAR_STYLE_KEY && event.key !== null) return;
    acceptAppearanceStorageChange(SCROLLBAR_STYLE_KEY);
    notify();
  });
}
