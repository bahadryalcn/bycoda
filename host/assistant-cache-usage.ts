import type { TurnMetrics } from "../src/features/sessions/model/session";
import type { AssistantCacheUsage } from "../src/shared/model/host-contracts/assistant";

export type AssistantCacheMeasurement = Pick<
  TurnMetrics,
  "cacheReadTokens" | "cacheWriteTokens" | "cacheHitPercent"
>;
export function assistantCacheMeasurement(
  metrics: AssistantCacheMeasurement | undefined,
): AssistantCacheMeasurement | undefined {
  if (!metrics) return;
  const result: AssistantCacheMeasurement = {};
  for (const key of ["cacheReadTokens", "cacheWriteTokens"] as const) {
    const value = metrics[key];
    if (value !== undefined && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  const percent = metrics.cacheHitPercent;
  if (percent !== undefined && Number.isFinite(percent) && percent >= 0 && percent <= 100)
    result.cacheHitPercent = percent;
  return Object.keys(result).length ? result : undefined;
}

/** Summation never fills an absent provider counter with a fabricated zero.
 * Only the existing canonical root-turn ledger is included; Chief utility
 * adapters expose no per-turn cache breakdown, so this scope is explicit. */
export function assistantCacheUsage(
  turns: readonly {
    cacheMetrics?: AssistantCacheMeasurement;
    cacheTimeKnown?: boolean;
    settled: boolean;
  }[],
  incomplete: boolean,
): AssistantCacheUsage | undefined {
  let measuredTurns = 0,
    percentageTurns = 0,
    percentTotal = 0;
  let cacheReadTokens: number | undefined, cacheWriteTokens: number | undefined;
  for (const turn of turns) {
    const metrics =
      turn.cacheTimeKnown === true ? assistantCacheMeasurement(turn.cacheMetrics) : undefined;
    if (!metrics) continue;
    measuredTurns++;
    if (metrics.cacheReadTokens !== undefined)
      cacheReadTokens = (cacheReadTokens ?? 0) + metrics.cacheReadTokens;
    if (metrics.cacheWriteTokens !== undefined)
      cacheWriteTokens = (cacheWriteTokens ?? 0) + metrics.cacheWriteTokens;
    if (metrics.cacheHitPercent !== undefined) {
      percentTotal += metrics.cacheHitPercent;
      percentageTurns++;
    }
  }
  if (!measuredTurns) return;
  return {
    scope: "worker-turns",
    measuredTurns,
    totalTurns: turns.length,
    percentageTurns,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(percentageTurns ? { cacheHitPercent: percentTotal / percentageTurns } : {}),
    complete: !incomplete && measuredTurns === turns.length && turns.every((turn) => turn.settled),
  };
}
