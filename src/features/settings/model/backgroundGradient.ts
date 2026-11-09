import type { WorkspaceBackground } from "./workspaceBackground";

/** Pure validation for a generated gradient; shared by the Host command and the Settings client. */
export const BACKGROUND_GRADIENT_TYPES = ["linear", "radial", "solid"] as const;
export const BACKGROUND_GRADIENT_NAME_MAX = 40;
export const BACKGROUND_GRADIENT_STOP_COUNT = 3;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** A generated gradient after validation: every field is in range and every stop is a hex color. */
export type BackgroundGradientSuggestion = {
  name: string;
  stops: [string, string, string];
  angle: number;
  type: (typeof BACKGROUND_GRADIENT_TYPES)[number];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Validates one generated gradient. Invalid stops are dropped; two valid stops are padded to three
 * by repeating the last one. Returns `null` when fewer than two usable colors remain.
 */
export function sanitizeBackgroundGradient(input: unknown): BackgroundGradientSuggestion | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const stops = Array.isArray(raw.stops)
    ? raw.stops
        .filter((stop): stop is string => typeof stop === "string" && HEX_PATTERN.test(stop))
        .map((stop) => stop.toLowerCase())
        .slice(0, BACKGROUND_GRADIENT_STOP_COUNT)
    : [];
  if (stops.length < 2) return null;
  while (stops.length < BACKGROUND_GRADIENT_STOP_COUNT) stops.push(stops[stops.length - 1]!);
  const name =
    typeof raw.name === "string" ? raw.name.trim().slice(0, BACKGROUND_GRADIENT_NAME_MAX) : "";
  const angle =
    typeof raw.angle === "number" && Number.isFinite(raw.angle)
      ? clamp(Math.round(raw.angle), 0, 360)
      : 135;
  const type = (BACKGROUND_GRADIENT_TYPES as readonly string[]).includes(raw.type as string)
    ? (raw.type as BackgroundGradientSuggestion["type"])
    : "linear";
  return {
    name,
    stops: [stops[0]!, stops[1]!, stops[2]!],
    angle,
    type,
  };
}

/** The fields a generated gradient writes onto the workspace background. */
export function backgroundGradientChange(
  suggestion: BackgroundGradientSuggestion,
): Pick<WorkspaceBackground, "enabled" | "style" | "colors" | "angle"> {
  return {
    enabled: true,
    style: suggestion.type,
    colors: suggestion.stops,
    angle: suggestion.angle,
  };
}
