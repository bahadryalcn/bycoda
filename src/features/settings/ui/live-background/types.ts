/**
 * Per-frame signal from the chat. `presence` is the scene's 0-1 visibility: it rises
 * with the first output of a turn, holds for a while (also through tool waits and after the
 * reply ends), fades out, rests and returns with later output. It does not depend on provider
 * chunk size or token rate.
 */
export type LiveSignal = {
  presence: number;
  /** Eased 0-1 energy from newly streamed reply/reasoning/tool progress. */
  energy?: number;
  /** Eased 0-1: output is arriving right now. Mouths move only while it is up; absent means
   * a still or demo frame that speaks at full presence. */
  speaking?: number;
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
