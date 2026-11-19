// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { UsageBudget, BudgetReading } from "../model/usageBudgets";
const readings = vi.hoisted(() => ({
  budgets: [] as UsageBudget[],
  reading: null as BudgetReading | null,
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => ({
  useLockSnapshot: () => ({ lockedGroupIds: new Set(), lockedPaths: [] }),
}));
vi.mock("../../group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
vi.mock("../../projects/model/recents", () => ({ loadRecents: () => [] }));
vi.mock("../../projects/model/projectGroups", () => ({ loadProjectGroups: () => [] }));
vi.mock("../../providers/model/providerAccounts", () => ({ providerAccounts: () => [] }));
vi.mock("../../sessions/model/sessionsStore", () => ({
  useShellSessions: () => [],
  getSessions: () => [],
}));
vi.mock("../model/usageBudgetStore", () => ({
  loadUsageBudgets: () => readings.budgets,
  subscribeUsageBudgets: () => () => {},
  saveUsageBudget: vi.fn(),
  deleteUsageBudget: vi.fn(),
}));
vi.mock("../model/usageBudgetReadings", () => ({
  createBudgetReader: () => vi.fn(async () => readings.reading),
}));
import { UsageBudgets } from "./UsageBudgets";

class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const budget = (id: string, action: UsageBudget["action"]): UsageBudget => ({
  id,
  scope: "project",
  target: "/project",
  label: `Budget ${id}`,
  metric: "tokens",
  period: "daily",
  capacity: 1000,
  action,
});

// #584: the list states how many rules block and how many only monitor, outside the help popover.
it("summarizes blocking and monitor-only rules in visible badges and per card", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", Stub);
  vi.stubGlobal("IntersectionObserver", Stub);
  readings.budgets = [budget("a", "block"), budget("b", "block"), budget("c", "monitor")];
  readings.reading = { used: 10, limit: 1000, state: "ok" };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(UsageBudgets)));
    const text = host.textContent ?? "";
    expect(text).toContain("2 blocking");
    expect(text).toContain("1 monitor only");
    expect(text.match(/Block new turns/g)?.length).toBe(2);
    expect(text.match(/Monitor only/g)?.length).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
