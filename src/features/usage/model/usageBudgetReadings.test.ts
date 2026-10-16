// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { idleRateLimits } from "../../providers/model/rateLimits";
import { createBudgetReader, assertUsageBudgets } from "./usageBudgetReadings";
import { saveUsageBudget } from "./usageBudgetStore";
import type { UsageBudget } from "./usageBudgets";

const mocks = vi.hoisted(() => ({ report: vi.fn(), limits: vi.fn(), history: vi.fn() }));
vi.mock("../../providers/model/providerUsage", () => ({ fetchProviderUsage: mocks.report }));
vi.mock("../../providers/model/rateLimitsCache", () => ({ loadFreshRateLimits: mocks.limits }));
vi.mock("../../sessions/data/sessionStore", () => ({ getSession: mocks.history }));
vi.mock("../../providers/model/providerAccounts", () => ({
  providerAccounts: (provider: string) => [{ provider, id: "default" }],
  sessionProviderAccountId: (_: string, s: Session) => s.providerAccountId ?? "default",
}));
vi.mock("../../projects/model/projectGroups", () => ({
  loadProjectGroups: () => [{ id: "g" }],
  loadProjectGroupAssignments: () => ({}),
  projectGroupWorkspaceRoot: () => null,
  projectGroupIdForPath: () => "g",
}));
const rule: UsageBudget = {
  id: "p",
  scope: "project",
  target: "C:/app",
  label: "App",
  metric: "tokens",
  period: "weekly",
  capacity: 1000,
  percent: 25,
  provider: "codex",
  accountId: "default",
  action: "block",
};
const session = { id: "s", cwd: "C:/app", harness: "codex", blocks: [] } as unknown as Session;
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  mocks.report.mockResolvedValue({ rows: [], found: false });
});
it("shares native scans, filters projects and sums cache tokens across accounts", async () => {
  const now = Date.now();
  mocks.report.mockResolvedValue({
    rows: [
      {
        slot: Math.floor(now / 1000) - 100,
        project: "c:/app",
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite5m: 3,
        cacheWrite1h: 4,
      },
      { slot: Math.floor(now / 1000), project: "C:/other", input: 999 },
    ],
  });
  const read = createBudgetReader([], now);
  const [p, g] = await Promise.all([
    read(rule),
    read({ ...rule, scope: "workspace", target: "g" }),
  ]);
  expect(p.used).toBe(48);
  expect(g.state).toBe("unknown"); // malformed input must not become a valid meter
  expect(mocks.report).toHaveBeenCalledTimes(2);
});
it("fails closed on a report error and permits monitoring-only rules", async () => {
  saveUsageBudget(rule);
  mocks.report.mockRejectedValue(new Error("offline"));
  await expect(assertUsageBudgets(session)).rejects.toThrow("Usage could not be verified");
  saveUsageBudget({ ...rule, action: "monitor" });
  await expect(assertUsageBudgets(session)).resolves.toBeUndefined();
});
it("blocks at the configured allocation and leaves unrelated projects usable", async () => {
  saveUsageBudget(rule);
  mocks.report.mockResolvedValue({
    rows: [
      {
        slot: Math.floor(Date.now() / 1000),
        project: "C:/app",
        input: 200,
        output: 0,
        cacheRead: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
      },
    ],
  });
  await expect(assertUsageBudgets(session)).rejects.toThrow("Budget reached");
  await expect(assertUsageBudgets({ ...session, cwd: "C:/other" })).resolves.toBeUndefined();
});
it("reads complete closed session history and does not assume zero when it is missing", async () => {
  const b = { ...rule, scope: "session", target: "s", project: session.cwd } as UsageBudget;
  const read = createBudgetReader([]);
  mocks.history.mockResolvedValue(null);
  expect((await read(b)).state).toBe("unknown");
  const readAgain = createBudgetReader([]);
  mocks.history.mockResolvedValue({
    ...session,
    blocks: [
      {
        id: "u",
        role: "user",
        text: "",
        startedAt: Date.now(),
        turnMetrics: { inputTokens: 100, outputTokens: 20 },
      },
    ],
  });
  expect((await readAgain(b)).used).toBe(120);
});

it("keeps live turns not yet persisted when completing partial history", async () => {
  const block = (id: string, inputTokens: number) => ({
    id,
    role: "user" as const,
    text: "",
    startedAt: Date.now(),
    turnMetrics: { inputTokens, outputTokens: 0 },
  });
  mocks.history.mockResolvedValue({ ...session, blocks: [block("stored", 100)] });
  const live = { ...session, historyPartial: true, blocks: [block("new", 50)] };
  const reading = await createBudgetReader([live])({
    ...rule,
    scope: "session",
    target: "s",
    project: session.cwd,
  });
  expect(reading.used).toBe(150);
});
it("applies account rules only to the selected provider/account", async () => {
  saveUsageBudget({ ...rule, metric: "accountPercent", capacity: 100 });
  mocks.limits.mockResolvedValue({
    ...idleRateLimits("codex"),
    status: "ok",
    updatedAt: Date.now(),
    weekly: { usedPercent: 50, windowMinutes: 10_080, resetsAt: null },
  });
  await expect(assertUsageBudgets(session)).rejects.toThrow("Budget reached");
  await expect(assertUsageBudgets({ ...session, harness: "claude" })).resolves.toBeUndefined();
  await expect(
    assertUsageBudgets({ ...session, providerAccountId: "other" }),
  ).resolves.toBeUndefined();
});

it("returns unknown after a bounded wait when a native report never responds", async () => {
  vi.useFakeTimers();
  mocks.report.mockReturnValue(new Promise(() => {}));
  const result = createBudgetReader([])(rule);
  await vi.advanceTimersByTimeAsync(20_000);
  expect((await result).state).toBe("unknown");
});
