import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { idleRateLimits } from "../../providers/model/rateLimits";
import {
  accountBudgetReading,
  budgetMatches,
  budgetReading,
  budgetSince,
  normalizeBudget,
  sessionBudgetTokens,
  type UsageBudget,
} from "./usageBudgets";

const rule: UsageBudget = {
  id: "p",
  scope: "project",
  target: "C:/work/app",
  label: "App",
  metric: "tokens",
  period: "weekly",
  capacity: 1000,
  percent: 25,
  provider: "codex",
  accountId: "default",
  action: "monitor",
};
const now = 1_800_000_000_000;
const session = (extra: Partial<Session> = {}): Session =>
  ({ id: "s", cwd: "C:\\work\\app", harness: "codex", blocks: [], ...extra }) as Session;

describe("usage budget semantics", () => {
  it("normalizes Windows scope identity and rejects unsafe settings", () => {
    expect(normalizeBudget(rule)?.target).toBe("c:/work/app");
    for (const patch of [
      { percent: 0 },
      { percent: 101 },
      { capacity: NaN },
      { capacity: 1.5 },
      { action: "send" },
      { target: "" },
      { metric: "accountPercent", period: "all" },
    ])
      expect(normalizeBudget({ ...rule, ...patch })).toBeNull();
    expect(normalizeBudget({ ...rule, scope: "session", target: "s" })).toBeNull();
  });
  it("matches sessions, exact projects and workspace membership independently", () => {
    expect(budgetMatches(rule, session(), () => undefined)).toBe(true);
    expect(budgetMatches(rule, session({ cwd: "C:/work/app/other" }), () => undefined)).toBe(false);
    expect(
      budgetMatches({ ...rule, scope: "session", target: "s" }, session(), () => undefined),
    ).toBe(true);
    expect(
      budgetMatches({ ...rule, scope: "workspace", target: "group" }, session(), () => "group"),
    ).toBe(true);
    expect(
      budgetMatches({ ...rule, scope: "workspace", target: "other" }, session(), () => "group"),
    ).toBe(false);
  });
  it("calculates the allocation, approaching and exceeded states without clamping overage", () => {
    expect(budgetReading(rule, 200)).toMatchObject({ limit: 250, state: "warning" });
    expect(budgetReading(rule, 300)).toMatchObject({ used: 300, limit: 250, state: "exceeded" });
    expect(budgetReading(rule, null).state).toBe("unknown");
    expect(budgetSince("weekly", now)).toBe(now - 7 * 24 * 3_600_000);
    expect(budgetSince("fiveHour", now)).toBe(now - 5 * 3_600_000);
  });
  it("requires fresh provider windows of the requested duration and honors reset", () => {
    const b = {
      ...rule,
      metric: "accountPercent",
      capacity: 100,
      percent: 30,
      period: "fiveHour",
    } as UsageBudget;
    const limits = {
      ...idleRateLimits("codex"),
      status: "ok" as const,
      updatedAt: now,
      session: { usedPercent: 35, windowMinutes: 300, resetsAt: now + 1000 },
    };
    expect(accountBudgetReading(b, limits, now).state).toBe("exceeded");
    expect(accountBudgetReading(b, limits, now + 1000).state).toBe("unknown");
    expect(accountBudgetReading(b, { ...limits, status: "error" }, now).state).toBe("unknown");
    expect(
      accountBudgetReading(b, { ...limits, session: { ...limits.session, windowMinutes: 60 } }, now)
        .state,
    ).toBe("unknown");
    expect(accountBudgetReading(b, { ...limits, updatedAt: now - 300_000 }, now).state).toBe(
      "unknown",
    );
    expect(accountBudgetReading({ ...b, period: "weekly" }, limits, now).state).toBe("unknown");
  });
  it("counts Codex cached input once and Claude cached input separately", () => {
    const blocks = [
      {
        id: "u",
        role: "user",
        text: "Hi",
        startedAt: now - 1000,
        turnMetrics: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 60,
          cacheWriteTokens: 10,
        },
      },
    ] as Session["blocks"];
    expect(sessionBudgetTokens(session({ blocks }), "weekly", now)).toBe(130);
    expect(sessionBudgetTokens(session({ harness: "claude", blocks }), "weekly", now)).toBe(190);
    expect(sessionBudgetTokens(session({ blocks, historyPartial: true }), "all", now)).toBeNull();
    expect(
      sessionBudgetTokens(
        session({ blocks: [{ id: "x", role: "user", text: "missing" }] }),
        "all",
        now,
      ),
    ).toBeNull();
    expect(
      sessionBudgetTokens(
        session({ blocks: blocks.map((b) => ({ ...b, startedAt: now - 6 * 3_600_000 })) }),
        "fiveHour",
        now,
      ),
    ).toBe(0);
  });
});
