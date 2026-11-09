import { type CSSProperties } from "react";
import { ACCENT_COLOR_DEFAULT, type ThemePreference } from "../model/appearance";
import "./AppearancePreviews.css";

export { matchThemePalette } from "../model/themePalettes";

/** True while the accent is the app default (no override, or the default value itself). */
export function isDefaultAccent(accentColor: string | null) {
  return !accentColor || accentColor.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase();
}

export type Tint = { hue: number; saturation: number; lightness: number; accent: string };

/**
 * A tone's own surface values for a sample; these show a selectable option (a mode or a palette in
 * light or dark), not live UI, so they are computed from the option instead of the current theme.
 * With the Pure background the ground is the shared pure role and the card keeps the palette tint.
 */
function toneStyle(p: Tint, light: boolean, pure: boolean): CSSProperties {
  const saturation = light ? Math.round(p.saturation * 0.2) : p.saturation;
  const tinted = (lightness: number) => `hsl(${p.hue} ${saturation}% ${lightness}%)`;
  const base = pure
    ? `var(${light ? "--palette-canvasPureLight" : "--palette-canvasPureDark"})`
    : tinted(light ? 94 : p.lightness + 5);
  const raised = light ? tinted(pure ? 93 : 100) : tinted(p.lightness + 13);
  return {
    "--palette-base": base,
    "--palette-raised": raised,
    "--palette-accent": p.accent,
  } as CSSProperties;
}

function ToneSample({ tint, tone, pure }: { tint: Tint; tone: "light" | "dark"; pure: boolean }) {
  return (
    <span
      className="appearance-tone"
      data-tone={tone}
      aria-hidden="true"
      style={toneStyle(tint, tone === "light", pure)}
    >
      <i />
      <b />
    </span>
  );
}

/** The sample inside a mode tile: one tone, or both side by side for System. */
export function ModePreview({
  mode,
  tint,
  pure,
}: {
  mode: ThemePreference;
  tint: Tint;
  pure: boolean;
}) {
  return (
    <span className="appearance-mode-preview" data-split={mode === "system" || undefined}>
      {mode === "dark" ? null : <ToneSample tint={tint} tone="light" pure={pure} />}
      {mode === "light" ? null : <ToneSample tint={tint} tone="dark" pure={pure} />}
    </span>
  );
}
