import {
  aggregateCost,
  loadPricing,
  windowStart,
  type CostParams,
  type CostReport,
} from "./cost-report";
import { scanLogs, type LogRequest, type Provider } from "./cost-scan";

export type CostDeps = {
  environmentId: string;
  /** Log directories per provider, one set per account profile on this Host. */
  roots: () => Promise<Record<Provider, string[]>>;
  now?: () => number;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<CostReport> }>();
export const clearCostCache = () => cache.clear();

export async function readUsageCost(deps: CostDeps, params: CostParams): Promise<CostReport> {
  const now = (deps.now ?? Date.now)();
  const key = `${deps.environmentId}:${params.days}:${params.utcOffsetMinutes}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = (async () => {
    const sinceMs = windowStart(now, params);
    const roots = await deps.roots();
    const requests: { provider: Provider; request: LogRequest }[] = [];
    let files = 0;
    let truncated = false;
    for (const provider of ["claude", "codex"] as const) {
      const scan = await scanLogs(roots[provider], provider, sinceMs);
      files += scan.files;
      truncated ||= scan.truncated;
      for (const request of scan.requests) requests.push({ provider, request });
    }
    const { pricing, source } = await loadPricing(now);
    return aggregateCost(requests, now, params, pricing, {
      environmentId: deps.environmentId,
      pricing: source,
      filesScanned: files,
      truncated,
    });
  })();
  if (cache.size > 16) cache.clear();
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}
