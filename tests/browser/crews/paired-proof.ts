/** Browser-side contract: a worker adapter resolves draw only after its sequence ACK. */
export type PairedRenderer<Frame> = {
  draw(frame: Frame, sequence: number): void | Promise<void>;
  capture(): Uint8ClampedArray | Promise<Uint8ClampedArray>;
  png(): string | Promise<string>;
  dispose?(): void | Promise<void>;
};

export async function compareSequence<Frame>(
  reference: PairedRenderer<Frame>,
  candidate: PairedRenderer<Frame>,
  frames: readonly Frame[],
  width: number,
  height: number,
  allowedRegion?: { x: number; y: number; width: number; height: number },
) {
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let nonemptyFrames = 0;
  let outsideRegionPixels = 0;
  let maxRegionPixelsPerFrame = 0;
  let firstFailure:
    | { sequence: number; reference: string; candidate: string; diff: string }
    | undefined;
  try {
    for (const [sequence, frame] of frames.entries()) {
      await reference.draw(frame, sequence);
      await candidate.draw(frame, sequence);
      const a = await reference.capture();
      const b = await candidate.capture();
      if (a.length !== width * height * 4 || b.length !== a.length)
        throw new Error(`Invalid RGBA capture length at sequence ${sequence}`);
      const diff = new Uint8ClampedArray(a.length);
      let changed = 0;
      let inside = 0;
      let nonempty = false;
      for (let offset = 0; offset < a.length; offset += 4) {
        let different = false;
        nonempty ||= a[offset + 3] > 0;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(a[offset + channel] - b[offset + channel]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          different ||= delta !== 0;
          diff[offset + channel] = delta;
        }
        if (different) {
          changed++;
          const x = (offset / 4) % width;
          const y = Math.floor(offset / 4 / width);
          if (
            allowedRegion &&
            x >= allowedRegion.x &&
            x < allowedRegion.x + allowedRegion.width &&
            y >= allowedRegion.y &&
            y < allowedRegion.y + allowedRegion.height
          )
            inside++;
          else outsideRegionPixels++;
          diff[offset + 3] = 255;
        }
      }
      if (nonempty) nonemptyFrames++;
      differingPixels += changed;
      maxRegionPixelsPerFrame = Math.max(maxRegionPixelsPerFrame, inside);
      if (changed && !firstFailure) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.putImageData(new ImageData(diff, width, height), 0, 0);
        firstFailure = {
          sequence,
          reference: await reference.png(),
          candidate: await candidate.png(),
          diff: canvas.toDataURL(),
        };
      }
    }
    return {
      frames: frames.length,
      differingPixels,
      maxChannelDelta,
      nonemptyFrames,
      outsideRegionPixels,
      maxRegionPixelsPerFrame,
      firstFailure,
    };
  } finally {
    await reference.dispose?.();
    await candidate.dispose?.();
  }
}
