import { BUNDLED_FONT_FACES } from "./fontFaceSources";

const loads = new Map<string, Promise<void>>();

/**
 * Registers the bundled @font-face sources of one font family with the document, once. Callers
 * only request the font; a failed load is dropped and requested again later, and without FontFace
 * support the platform's fallback font stays in use.
 */
export function preloadBundledFont(family: string | undefined): void {
  const faces = family ? BUNDLED_FONT_FACES[family] : undefined;
  if (!family || !faces || loads.has(family)) return;
  if (typeof FontFace !== "function" || typeof document === "undefined") return;
  const forget = () => {
    loads.delete(family);
  };
  try {
    const load = Promise.all(
      faces.map((face) => {
        const source = new FontFace(family, `url(${face.src})`, {
          style: face.style,
          weight: face.weight,
          unicodeRange: face.unicodeRange,
          display: "swap",
        });
        document.fonts.add(source);
        return source.load();
      }),
    ).then(() => undefined, forget);
    loads.set(family, load);
  } catch {
    forget();
  }
}
