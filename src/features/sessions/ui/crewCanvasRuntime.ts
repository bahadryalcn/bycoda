import { themePalette } from "../../../shared/theme/palette";
import { createCanvasWorkerRuntime } from "../../../shared/lib/canvas-worker/runtime";
import { createCodeArtPainter, type CodeArtPainter } from "./crewCodeArt";
import type { ClassicCrewAssets } from "./crewCanvasAssets";
import type { CrewCanvasFrame } from "./crewCanvasHost";

/** Classic only. Rigged themes keep their existing factories until their own adapters pass parity. */
export function createCrewCanvasRuntime(
  post: Parameters<typeof createCanvasWorkerRuntime<CrewCanvasFrame>>[0],
) {
  let draw: CodeArtPainter | undefined;
  let assets: ClassicCrewAssets | undefined;
  let signLayer: ImageBitmap | undefined;
  return createCanvasWorkerRuntime<CrewCanvasFrame>(
    post,
    (_context, frame) => {
      if (!draw) throw new Error("Crew painter not initialized");
      signLayer = frame.signLayer;
      draw(frame.actions, frame.activity, frame.width, frame.time);
      return { backend: draw.backend, busy: draw.busy?.() ?? false };
    },
    {
      init(canvas, value) {
        assets = value as ClassicCrewAssets;
        if (!assets?.tiles?.length) throw new Error("Crew assets unavailable");
        Object.assign(themePalette, assets.palette);
        const tiles = assets.tiles.map((data) => {
          const tile = new OffscreenCanvas(data.width, data.height);
          const context = tile.getContext("2d");
          if (!context) throw new Error("Worker glyph 2D unavailable");
          context.putImageData(data, 0, 0);
          return tile;
        });
        draw = createCodeArtPainter(canvas, {
          renderer: assets.renderer,
          ...(assets.sign
            ? {
                paintSign(context: CanvasRenderingContext2D) {
                  if (!signLayer) throw new Error("Crew sign layer unavailable");
                  context.save();
                  context.setTransform(1, 0, 0, 1, 0, 0);
                  context.imageSmoothingEnabled = false;
                  context.drawImage(signLayer, 0, 0);
                  context.restore();
                },
              }
            : {}),
          tiles,
          factory: () => new OffscreenCanvas(1, 1),
          sign: assets.sign
            ? {
                image: assets.sign,
                naturalWidth: assets.signWidth,
                naturalHeight: assets.signHeight,
              }
            : null,
        });
      },
      releaseFrame(frame) {
        frame.signLayer?.close();
        signLayer = undefined;
      },
      dispose() {
        draw?.dispose?.();
        draw = undefined;
        assets?.sign?.close();
        assets = undefined;
      },
    },
  );
}
