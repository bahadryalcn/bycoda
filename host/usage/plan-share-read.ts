import { rowCost, rowTokens } from "../../src/features/providers/model/usagePricing";
import {
  PlanShareParamsSchema,
  type PlanShareResult,
} from "../../src/shared/model/host-contracts/usage-plan-share";
import { loadPricing } from "./cost-report";
import { scanLogs, type Provider } from "./cost-scan";
import { computePlanShare, type PlanShareTurn } from "./plan-share";

export type PlanShareDeps = {
  environmentId: string;
  /** Log directories per provider account, keyed `provider:accountId`. */
  accountRoots: () => Promise<Record<string, { provider: Provider; roots: string[] }>>;
  now?: () => number;
};

const DAY_MS = 86_400_000;
const MAX_HISTORY_MS = 30 * DAY_MS;
const SINCE_FALLBACK_MS = { fiveHour: DAY_MS, weekly: 8 * DAY_MS } as const;
const SESSION_LABEL_MAX = 120;

const folderName = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? "";

/**
 * `usage.planShare.read`: reads each account's provider logs (never another account's), prices
 * every request and attributes the supplied quota observations to sessions. Observations come from
 * the caller because only the desktop keeps quota history.
 */
export async function readPlanShare(deps: PlanShareDeps, value: unknown): Promise<PlanShareResult> {
  const params = PlanShareParamsSchema.parse(value);
  const now = (deps.now ?? Date.now)();
  const earliest = params.observations.reduce((min, entry) => Math.min(min, entry.at), now);
  const sinceMs = Math.max(
    now - MAX_HISTORY_MS,
    Math.min(earliest, now - SINCE_FALLBACK_MS[params.window]),
  );
  const roots = await deps.accountRoots();
  const wanted = Object.entries(roots).filter(
    ([account]) => !params.accounts || params.accounts.includes(account),
  );
  const { pricing, source } = await loadPricing(now);
  const turns: PlanShareTurn[] = [];
  let files = 0;
  let truncated = false;
  for (const [account, { provider, roots: dirs }] of wanted) {
    const scan = await scanLogs(dirs, provider, sinceMs);
    files += scan.files;
    truncated ||= scan.truncated;
    for (const request of scan.requests) {
      const row = { ...request, slot: request.ts };
      turns.push({
        account,
        at: request.ts * 1000,
        sessionId: request.session ?? "unknown",
        label: folderName(request.project).slice(0, SESSION_LABEL_MAX) || undefined,
        tokens: rowTokens(row),
        costUsd: rowCost(row, pricing),
      });
    }
  }
  return {
    environmentId: deps.environmentId,
    sampledAt: now,
    window: params.window,
    estimate: true,
    coverage: { pricing: source, filesScanned: files, truncated },
    accounts: computePlanShare({
      window: params.window,
      now,
      observations: params.observations,
      turns,
      accounts: params.accounts,
      sessionIds: params.sessionIds,
      taskIds: params.taskIds,
      limit: params.limit,
    }),
  };
}
