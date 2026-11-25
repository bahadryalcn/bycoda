import { BUNDLED_FONT_FACES, type BundledFontFace } from "./fontFaceSources";

const registered = new Map<BundledFontFace, FontFace>();

/** Register faces for CSS to fetch as visible text needs their weight, style and unicode range. */
export function registerBundledFont(
  family: string | undefined,
  timing: "on-demand" | "preload" = "on-demand",
): void {
  const faces = family ? BUNDLED_FONT_FACES[family] : undefined;
  if (!family || !faces || typeof FontFace !== "function" || typeof document === "undefined")
    return;
  try {
    for (const face of faces) {
      let source = registered.get(face);
      if (source?.status === "error") {
        document.fonts.delete(source);
        registered.delete(face);
        source = undefined;
      }
      if (!source) {
        source = new FontFace(family, `url(${face.src})`, {
          style: face.style,
          weight: face.weight,
          unicodeRange: face.unicodeRange,
          display: "swap",
        });
        document.fonts.add(source);
        registered.set(face, source);
      }
      if (timing === "preload" && source.status === "unloaded") {
        // CSS falls back while unavailable. A later request replaces an errored face.
        void source.load().catch(() => undefined);
      }
    }
  } catch {
    // An unavailable font API leaves the platform fallback active.
  }
}

/** Applied fonts preload all subsets, including faces previously registered for previews. */
export function preloadBundledFont(family: string | undefined): void {
  registerBundledFont(family, "preload");
}
