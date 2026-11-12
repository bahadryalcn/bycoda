import { crewSignImage, loadCrewSignLogo, glyphTile, type CodeArtOptions } from "./crewCodeArt";
import { GLYPH_BANDS, canvas2D } from "./crewCodeArtCompositor";
import { themePalette } from "../../../shared/theme/palette";

export type ClassicCrewAssets = {
  tiles: ImageData[];
  sign: ImageBitmap | null;
  signWidth: number;
  signHeight: number;
  palette: typeof themePalette;
  renderer: CodeArtOptions["renderer"];
};
/** System Consolas/Courier glyphs have no bundled URL. Preserve their exact main raster;
 * worker never rasterizes text or substitutes a worker fallback font. */
export async function prepareClassicCrewAssets(
  renderer: CodeArtOptions["renderer"] = "auto",
): Promise<ClassicCrewAssets> {
  await document.fonts.ready;
  await loadCrewSignLogo();
  const logo = crewSignImage();
  return {
    tiles: GLYPH_BANDS.map((band) => {
      const tile = glyphTile(band);
      return canvas2D(tile)!.getImageData(0, 0, tile.width, tile.height);
    }),
    sign: logo ? await createImageBitmap(logo) : null,
    signWidth: logo?.naturalWidth ?? 0,
    signHeight: logo?.naturalHeight ?? 0,
    palette: themePalette,
    renderer,
  };
}
