/**
 * Appearance font catalog. Stored values are the catalog `id`s, so records saved before the
 * catalog existed (Arial, Verdana, Menlo, Courier New, ...) keep resolving. Bundled entries carry
 * the CSS family their @fontsource package declares; system entries have no family and use the
 * operating system's copy. Bundled faces load on demand through fontFaceLoader.ts.
 */
export const FONT_CATEGORIES = ["readable", "modern", "characterful", "system"] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];
export type FontTag = "accessible" | "ligatures" | "italic";

export type FontEntry = {
  id: string;
  category: FontCategory;
  tag?: FontTag;
  /** CSS font-family name. Absent for "System" (the platform's default monospace or sans). */
  family?: string;
  /** Bundled from an OFL-1.1 @fontsource package; system fonts are not bundled. */
  bundled: boolean;
};

const system = (id: string): FontEntry => ({
  id,
  category: "system",
  bundled: false,
});
const bundled = (id: string, family: string, category: FontCategory, tag?: FontTag): FontEntry => ({
  id,
  family,
  category,
  tag,
  bundled: true,
});

export const INTERFACE_FONT_CATALOG: readonly FontEntry[] = [
  system("System"),
  system("Segoe UI"),
  system("Arial"),
  system("Verdana"),
  bundled("Inter", "Inter Variable", "modern"),
  bundled("Geist", "Geist Variable", "modern"),
  bundled("IBM Plex Sans", "IBM Plex Sans", "readable"),
  bundled("Atkinson Hyperlegible", "Atkinson Hyperlegible", "readable", "accessible"),
  bundled("Lexend", "Lexend Variable", "readable"),
  bundled("Source Sans 3", "Source Sans 3 Variable", "readable"),
  bundled("Manrope", "Manrope Variable", "modern"),
  bundled("Figtree", "Figtree Variable", "modern"),
  bundled("DM Sans", "DM Sans Variable", "modern"),
  bundled("Nunito Sans", "Nunito Sans Variable", "characterful"),
  bundled("Space Grotesk", "Space Grotesk Variable", "characterful"),
  bundled("Outfit", "Outfit Variable", "characterful"),
];

export const CODE_FONT_CATALOG: readonly FontEntry[] = [
  system("System"),
  system("Cascadia Code"),
  system("Consolas"),
  system("Menlo"),
  system("Courier New"),
  bundled("JetBrains Mono", "JetBrains Mono Variable", "readable", "ligatures"),
  bundled("Geist Mono", "Geist Mono Variable", "readable"),
  bundled("Fira Code", "Fira Code Variable", "readable", "ligatures"),
  bundled("IBM Plex Mono", "IBM Plex Mono", "readable"),
  bundled("Source Code Pro", "Source Code Pro Variable", "readable"),
  bundled("Atkinson Hyperlegible Mono", "Atkinson Hyperlegible Mono", "readable", "accessible"),
  bundled("Commit Mono", "Commit Mono", "readable"),
  bundled("Victor Mono", "Victor Mono Variable", "characterful", "italic"),
  bundled("Space Mono", "Space Mono", "characterful"),
  bundled("Red Hat Mono", "Red Hat Mono Variable", "readable"),
];

/** Interface + code pairings offered as one-click presets. */
export const FONT_PAIRINGS: readonly {
  interfaceFont: string;
  codeFont: string;
}[] = [
  { interfaceFont: "Inter", codeFont: "JetBrains Mono" },
  { interfaceFont: "Geist", codeFont: "Geist Mono" },
  { interfaceFont: "IBM Plex Sans", codeFont: "IBM Plex Mono" },
  {
    interfaceFont: "Atkinson Hyperlegible",
    codeFont: "Atkinson Hyperlegible Mono",
  },
  { interfaceFont: "Space Grotesk", codeFont: "Space Mono" },
  { interfaceFont: "Lexend", codeFont: "Commit Mono" },
];

export function findFont(catalog: readonly FontEntry[], id: string): FontEntry | undefined {
  return catalog.find((entry) => entry.id === id);
}

/** Returns the stored id when the catalog knows it, otherwise the catalog's default ("System"). */
export function normalizeFontId(catalog: readonly FontEntry[], value: unknown): string {
  return typeof value === "string" && findFont(catalog, value) ? value : "System";
}

export function fontsInCategory(
  catalog: readonly FontEntry[],
  category: FontCategory | "all",
): readonly FontEntry[] {
  return category === "all" ? catalog : catalog.filter((entry) => entry.category === category);
}

/** CSS family to put in font-family; undefined keeps the platform default. */
export function fontFamilyValue(catalog: readonly FontEntry[], id: string): string | undefined {
  const entry = findFont(catalog, id);
  if (!entry || entry.id === "System") return undefined;
  return entry.family ?? entry.id;
}

export function randomFontPairing(random: () => number = Math.random) {
  return FONT_PAIRINGS[Math.floor(random() * FONT_PAIRINGS.length)]!;
}
