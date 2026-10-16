/**
 * Per-frame signal from the chat. `presence` is the "AI is replying" fade: it
 * rises when a reply starts, stays while it streams and eases out afterwards.
 * `open` is how far the lips part right now; `energy` is the decaying speech
 * energy of the streamed text. All three are 0-1.
 */
export type LiveSignal = {
  presence: number;
  open: number;
  energy: number;
};

/** Colors are resolved theme tokens; channels are 0-255 for ImageData scenes. */
export type LiveBackgroundPalette = {
  content: string;
  accent: string;
  contentRgb: readonly [number, number, number];
  accentRgb: readonly [number, number, number];
  monoFont: string;
};

export type LiveBackgroundScene = {
  resize(width: number, height: number): void;
  /**
   * Draws one frame into the pane's 2D canvas. `time` and `delta` are seconds;
   * drawing happens in CSS pixels. Reduced motion calls this once with a still time.
   */
  draw(ctx: CanvasRenderingContext2D, time: number, delta: number, signal: LiveSignal): void;
  /** Releases GPU or cached resources; called before a scene is replaced or unmounted. */
  dispose?(): void;
};
