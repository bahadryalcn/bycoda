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
