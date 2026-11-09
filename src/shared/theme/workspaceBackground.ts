import { themePalette } from "./palette";

export type WorkspaceBackground = {
  enabled: boolean;
  style: "linear" | "radial" | "mesh" | "solid";
  colors: [string, string, string];
  angle: number;
  strength: number;
};

export const WORKSPACE_BACKGROUND_DEFAULT: WorkspaceBackground = {
  enabled: false,
  style: "linear",
  colors: [themePalette.hex3b82f6, themePalette.hexa78bfa, themePalette.hex2dd4bf],
  angle: 135,
  strength: 45,
};

export const WORKSPACE_BACKGROUND_PRESETS: {
  id: string;
  label: string;
  value: WorkspaceBackground;
}[] = [
  { id: "aurora", label: "Aurora", value: { ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true } },
  {
    id: "ocean",
    label: "Ocean",
    value: {
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: true,
      colors: [themePalette.hex3b82f6, themePalette.hex22d3ee, themePalette.hex2dd4bf],
    },
  },
  {
    id: "dusk",
    label: "Dusk",
    value: {
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: true,
      style: "mesh",
      colors: [themePalette.hex818cf8, themePalette.hexa78bfa, themePalette.hexf472b6],
    },
  },
  {
    id: "forest",
    label: "Forest",
    value: {
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: true,
      style: "mesh",
      colors: [themePalette.hex2dd4bf, themePalette.hex34d399, themePalette.hexa3e635],
    },
  },
  {
    id: "ember",
    label: "Ember",
    value: {
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: true,
      style: "radial",
      colors: [themePalette.hexf97316, themePalette.hexfb7185, themePalette.hexa78bfa],
    },
  },
  {
    id: "rose",
    label: "Rose",
    value: {
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: true,
      style: "radial",
      colors: [themePalette.hexf472b6, themePalette.hexfda4af, themePalette.hexa78bfa],
    },
  },
];

/** Only normalized hex colors and numeric angles enter this CSS serialization. */
export function workspaceBackgroundImage(value: WorkspaceBackground): string {
  const colors =
    Array.isArray(value.colors) &&
    value.colors.length === 3 &&
    value.colors.every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
      ? value.colors
      : WORKSPACE_BACKGROUND_DEFAULT.colors;
  const [a, b, c] = colors;
  const angle = Number.isFinite(value.angle)
    ? Math.min(360, Math.max(0, Math.round(value.angle)))
    : WORKSPACE_BACKGROUND_DEFAULT.angle;
  if (value.style === "solid") return `linear-gradient(${a}, ${a})`;
  if (value.style === "radial") return `radial-gradient(ellipse at center, ${a}, ${b} 55%, ${c})`;
  if (value.style === "mesh")
    return `radial-gradient(ellipse at 15% 20%, ${a}, transparent 65%), radial-gradient(ellipse at 85% 80%, ${b}, transparent 65%), linear-gradient(${angle}deg, ${c}, ${a})`;
  return `linear-gradient(${angle}deg, ${a}, ${b} 50%, ${c})`;
}
