import type { Block } from "./session";

export type CompletedResponseSpeed = {
  outputTokens: number;
  durationMs: number;
  tps: number;
};

/** Provider-reported output / completed turn duration, including tool and wait time. */
export function completedResponseSpeed(blocks: readonly Block[]): CompletedResponseSpeed | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role !== "user" || block.durationMs === undefined) continue;
    const outputTokens = block.turnMetrics?.outputTokens;
    const durationMs = block.durationMs;
    if (
      outputTokens === undefined ||
      !Number.isFinite(outputTokens) ||
      outputTokens < 0 ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    )
      return null;
    return { outputTokens, durationMs, tps: outputTokens / (durationMs / 1000) };
  }
  return null;
}

export function formatResponseSpeed(tps: number): string {
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}k`;
  return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
}

/** Visual bands for the completed turn's average TPS; no reading means no fill. */
export function responseSpeedFill(tps: number | null | undefined): number {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return 0;
  if (tps < 10) return 0.25;
  if (tps < 30) return 0.5;
  if (tps < 60) return 0.75;
  return 1;
}
