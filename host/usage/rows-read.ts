import {
  USAGE_ROWS_MAX_DAYS,
  USAGE_ROWS_SLOT_SECONDS,
  UsageRowsParamsSchema,
  type UsageRowsAccount,
  type UsageRowsResult,
  type UsageRowsRow,
} from "../../src/shared/model/host-contracts/usage-rows";
import { scanLogs, type Provider } from "./cost-scan";

export type UsageRowsDeps = {
  environmentId: string;
  /** One entry per provider account profile on this Host. */
  accounts: () => Promise<
    { provider: Provider; accountId: string; label: string; roots: string[] }[]
  >;
  now?: () => number;
};

const CACHE_MS = 60_000;
const SLOT_MS = USAGE_ROWS_SLOT_SECONDS * 1000;
const MAX_ROWS = 60_000;
const cache = new Map<string, { at: number; value: Promise<UsageRowsResult> }>();
export const clearUsageRowsCache = () => cache.clear();

export async function readUsageRows(deps: UsageRowsDeps, value: unknown): Promise<UsageRowsResult> {
  const params = UsageRowsParamsSchema.parse(value);
  const now = (deps.now ?? Date.now)();
  const sinceMs = Math.max(params.sinceMs, now - USAGE_ROWS_MAX_DAYS * 86_400_000);
  const key = `${deps.environmentId}:${Math.floor(sinceMs / SLOT_MS)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const result = (async (): Promise<UsageRowsResult> => {
    let filesScanned = 0;
    let truncated = false;
    const accounts: UsageRowsAccount[] = [];
    for (const account of await deps.accounts()) {
      const scan = await scanLogs(account.roots, account.provider, sinceMs);
      filesScanned += scan.files;
      truncated ||= scan.truncated;
      const rows = new Map<string, UsageRowsRow>();
      for (const request of scan.requests) {
        if (request.ts * 1000 < sinceMs) continue;
        const slot = Math.floor(request.ts / USAGE_ROWS_SLOT_SECONDS) * USAGE_ROWS_SLOT_SECONDS;
        const rowKey = `${slot}\0${request.model}\0${request.project}`;
        const row = rows.get(rowKey);
        if (row) {
          row.input += request.input;
          row.cacheRead += request.cacheRead;
          row.cacheWrite5m += request.cacheWrite5m;
          row.cacheWrite1h += request.cacheWrite1h;
          row.output += request.output;
        } else {
          rows.set(rowKey, {
            slot,
            model: request.model,
            project: request.project,
            input: request.input,
            cacheRead: request.cacheRead,
            cacheWrite5m: request.cacheWrite5m,
            cacheWrite1h: request.cacheWrite1h,
            output: request.output,
          });
        }
      }
      accounts.push({
        provider: account.provider,
        accountId: account.accountId,
        label: account.label,
        rows: [...rows.values()].sort((a, b) => a.slot - b.slot),
      });
    }
    // Bound the payload: drop the oldest slots across all accounts.
    const total = accounts.reduce((sum, account) => sum + account.rows.length, 0);
    if (total > MAX_ROWS) {
      truncated = true;
      const slots = accounts.flatMap((account) => account.rows.map((row) => row.slot));
      slots.sort((a, b) => b - a);
      const cutoff = slots[MAX_ROWS - 1];
      for (const account of accounts)
        account.rows = account.rows.filter((row) => row.slot >= cutoff);
    }
    return {
      environmentId: deps.environmentId,
      sampledAt: now,
      sinceMs,
      accounts,
      coverage: { filesScanned, truncated },
    };
  })();
  if (cache.size > 16) cache.clear();
  cache.set(key, { at: now, value: result });
  result.catch(() => cache.delete(key));
  return result;
}
