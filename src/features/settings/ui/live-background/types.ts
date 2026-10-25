/**
 * Per-frame signal from the chat. `presence` is the "AI is replying" fade: it
 * rises when a reply starts, stays while it streams and eases out afterwards.
 * Its value is 0-1 and does not depend on provider chunk size or token rate.
 */
export type LiveSignal = {
  presence: number;
  /** Eased 0-1 energy from newly streamed reply/reasoning/tool progress. */
  energy?: number;
};

/** Colors are resolved theme tokens for the Canvas 2D artwork. */
export type LiveBackgroundPalette = {
  content: string;
  accent: string;
  monoFont: string;
};

export type LiveBackgroundScene = {
  resize(width: number, height: number): void;
  /**
   * Draws one frame into the pane's 2D canvas. `time` and `delta` are seconds;
   * drawing happens in CSS pixels. Reduced motion calls this once with a still time.
   */
  draw(ctx: CanvasRenderingContext2D, time: number, delta: number, signal: LiveSignal): void;
  /** Releases cached resources; called before a scene is replaced or unmounted. */
  dispose?(): void;
};
