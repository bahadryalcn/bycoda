import type { HostProjectAppearance } from "./protocol";

export const MAX_PROJECT_LOGO_LENGTH = 32_000;
export const MAX_DIRECTORY_LOGO_LENGTH = 4 * 1024 * 1024;

/** Saved desktop palette values include both hex and HSL colors. */
export function projectIdentityColor(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const hsl =
    /^hsl\(\s*(\d{1,3}(?:\.\d+)?)(?:\s*,\s*|\s+)(\d{1,3}(?:\.\d+)?)%(?:\s*,\s*|\s+)(\d{1,3}(?:\.\d+)?)%\s*\)$/i.exec(
      value,
    );
  if (!hsl) return;
  const hue = Number(hsl[1]);
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  if (hue > 360 || saturation > 1 || lightness > 1) return;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  // Hex works identically in native image/SVG and browser renderers.
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function parseProjectAppearance(input: unknown): HostProjectAppearance | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  const color = projectIdentityColor(value.color);
  const rawIcon = value.icon as Record<string, unknown> | undefined;
  const highlight = projectIdentityColor(rawIcon?.highlight);
  const icon =
    rawIcon &&
    typeof rawIcon.path === "string" &&
    rawIcon.path.length <= 4096 &&
    /^[MmLlHhVvCcSsQqTtAaZz\d\s.,+\-]+$/.test(rawIcon.path) &&
    highlight
      ? { path: rawIcon.path, highlight }
      : undefined;
  const logo =
    typeof value.logo === "string" &&
    value.logo.length <= MAX_PROJECT_LOGO_LENGTH &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.logo)
      ? value.logo
      : undefined;
  return color || icon || logo
    ? { ...(color ? { color } : {}), ...(icon ? { icon } : {}), ...(logo ? { logo } : {}) }
    : undefined;
}
