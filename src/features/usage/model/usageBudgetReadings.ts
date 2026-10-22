import { pathKey } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import {
  loadProjectGroups,
  loadProjectGroupAssignments,
  projectGroupIdForPath,
  projectGroupWorkspaceRoot,
} from "../../projects/model/projectGroups";
import { providerAccounts, sessionProviderAccountId } from "../../providers/model/providerAccounts";
import { fetchProviderUsage } from "../../providers/model/providerUsage";
import { loadFreshRateLimits } from "../../providers/model/rateLimitsCache";
import { getSession } from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { loadUsageBudgets } from "./usageBudgetStore";
import {
  accountBudgetReading,
  budgetMatches,
  budgetReading,
  budgetSince,
  rowTokens,
  sessionBudgetTokens,
  type BudgetReading,
  type UsageBudget,
} from "./usageBudgets";

async function withReadTimeout<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Usage read timed out")), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function budgetGroupLookup(): (cwd: string) => string | undefined {
  const groups = loadProjectGroups();
  const assignments = loadProjectGroupAssignments(groups);
  return (cwd) =>
    groups.find((group) => {
      const root = projectGroupWorkspaceRoot(group);
      return root != null && pathKey(root) === pathKey(cwd);
    })?.id ?? projectGroupIdForPath(cwd, assignments);
}

/** Each refresh shares transcript/report reads across all rules. Nothing is fetched without a rule. */
export function createBudgetReader(sessions: readonly Session[], now = Date.now()) {
  const groupFor = budgetGroupLookup();
  const reports = new Map<string, ReturnType<typeof fetchProviderUsage>>();
  const histories = new Map<string, ReturnType<typeof getSession>>();
  const read = async (budget: UsageBudget): Promise<BudgetReading> => {
    try {
      if (budget.metric === "accountPercent") {
        const exists = providerAccounts(budget.provider).some((a) => a.id === budget.accountId);
        if (!exists) return budgetReading(budget, null);
        return accountBudgetReading(
          budget,
          await loadFreshRateLimits(budget.provider, budget.accountId, 60_000),
          Date.now(),
        );
      }
      if (budget.scope === "session") {
        let session = sessions.find((s) => s.id === budget.target);
        if (!session || session.historyPartial || session.historyLoading) {
          let history = histories.get(budget.target);
          if (!history) {
            history = getSession(budget.target);
            histories.set(budget.target, history);
          }
          const stored = await history;
          if (!stored) return budgetReading(budget, null);
          // Live metrics win over persisted versions of the same user turn.
          const liveBlocks = new Map(session?.blocks.map((b) => [b.id, b]) ?? []);
          const storedIds = new Set(stored.blocks.map((b) => b.id));
          session = {
            ...stored,
            blocks: [
              ...stored.blocks.map((b) => liveBlocks.get(b.id) ?? b),
              ...(session?.blocks.filter((b) => !storedIds.has(b.id)) ?? []),
            ],
          };
        }
        return budgetReading(budget, sessionBudgetTokens(session, budget.period, now));
      }
      if (budget.scope === "workspace" && !loadProjectGroups().some((g) => g.id === budget.target))
        return budgetReading(budget, null);
      if (budget.scope === "project" && budget.target.startsWith("remote://"))
        return budgetReading(budget, null);
      const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
      if (!accounts.length) return budgetReading(budget, null);
      const since = Math.floor(budgetSince(budget.period, now) / 900_000) * 900_000;
      const results = await Promise.all(
        accounts.map((account) => {
          const key = `${account.provider}:${account.id}:${since}`;
          let report = reports.get(key);
          if (!report) {
            report = fetchProviderUsage(account.provider, account.id, since);
            reports.set(key, report);
          }
          return report;
        }),
      );
      // Native usage records are 15-minute buckets. Include the boundary bucket conservatively.
      const firstSlot = Math.floor(since / 900_000) * 900;
      let total = 0;
      for (const report of results)
        for (const row of report.rows) {
          if (row.slot < firstSlot || row.slot * 1000 > now) continue;
          if (budgetMatches(budget, { id: "", cwd: row.project }, groupFor))
            total += rowTokens(row);
        }
      return budgetReading(budget, total);
    } catch {
      return budgetReading(budget, null);
    }
  };
  return (budget: UsageBudget): Promise<BudgetReading> =>
    withReadTimeout(read(budget)).catch(() => budgetReading(budget, null));
}

/** A local dispatch gate, not a provider-side quota or an in-flight token ceiling. */
export async function assertUsageBudgets(session: Session): Promise<void> {
  const matching = blockingUsageBudgets(session);
  if (!matching.length) return;
  const reader = createBudgetReader([session]);
  const readings = await Promise.all(matching.map(async (b) => ({ b, reading: await reader(b) })));
  const blocked = readings.find(
    ({ reading }) => reading.state === "exceeded" || reading.state === "unknown",
  );
  if (blocked)
    throw new Error(
      `${t("Usage budget")}: ${blocked.b.label}. ${t(
        blocked.reading.state === "unknown"
          ? "Usage could not be verified. Refresh or edit the budget in Usage settings."
          : "Budget reached. Edit or remove the budget in Usage settings to continue.",
      )}`,
    );
}

export function blockingUsageBudgets(session: Session): UsageBudget[] {
  const groupFor = budgetGroupLookup();
  return loadUsageBudgets().filter(
    (b) =>
      b.action === "block" &&
      budgetMatches(b, session, groupFor) &&
      (b.metric === "tokens" ||
        (session.harness === b.provider &&
          sessionProviderAccountId(b.provider, session) === b.accountId)),
  );
}
