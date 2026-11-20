// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { UsageBudget, BudgetReading } from "../model/usageBudgets";
const readings = vi.hoisted(() => ({
  budgets: [] as UsageBudget[],
  reading: null as BudgetReading | null,
  ruleReads: 0,
  groupReads: 0,
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => ({
  useLockSnapshot: () => ({ lockedGroupIds: new Set(), lockedPaths: [] }),
}));
vi.mock("../../group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
vi.mock("../../projects/model/recents", () => ({ loadRecents: () => [] }));
vi.mock("../../projects/model/projectGroups", () => ({
  loadProjectGroups: () => {
    readings.groupReads++;
    return [];
  },
}));
vi.mock("../../providers/model/providerAccounts", () => ({ providerAccounts: () => [] }));
vi.mock("../../sessions/model/sessionsStore", () => ({
  useShellSessions: () => [],
  getSessions: () => [],
}));
vi.mock("../model/usageBudgetStore", () => ({
  loadUsageBudgets: () => {
    readings.ruleReads++;
    return readings.budgets;
  },
  subscribeUsageBudgets: () => () => {},
  saveUsageBudget: vi.fn(),
  deleteUsageBudget: vi.fn(),
}));
vi.mock("../model/usageBudgetReadings", () => ({
  createBudgetReader: () => vi.fn(async () => readings.reading),
}));
import { UsageBudgets } from "./UsageBudgets";

// jsdom has no ResizeObserver; the help popover measures its placement with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

it("retains empty numeric drafts and native token/percentage constraints in the actual budget editor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(UsageBudgets)));
    const add = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Add budget"),
    )!;
    await act(async () => add.click());
    const [capacity, percent] =
      container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(capacity.value).toBe("1000000");
    expect(capacity.min).toBe("1");
    expect(capacity.step).toBe("1");
    expect(percent.max).toBe("100");
    expect(percent.step).toBe("any");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(capacity, "");
      capacity.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(capacity.value).toBe("");
    expect(capacity.validity.valueMissing).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        percent,
        "100.5",
      );
      percent.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(percent.value).toBe("100.5");
    expect(percent.validity.rangeOverflow).toBe(true);
    expect(capacity.value).toBe("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("localizes threshold comparisons and shows the known reset without changing its reading", async () => {
  const { setLanguagePreference } = await import("../../../shared/i18n");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const reset = Date.UTC(2027, 2, 19, 14, 35, 0);
  readings.budgets = [
    {
      id: "threshold",
      scope: "project",
      target: "/project",
      label: "Research budget",
      metric: "accountPercent",
      period: "weekly",
      capacity: 100,
      percent: 50,
      provider: "codex",
      accountId: "default",
      action: "monitor",
    },
  ];
  readings.reading = { used: 19.25, limit: 50, state: "ok", resetsAt: reset };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await setLanguagePreference("en");
    await act(async () => root.render(createElement(UsageBudgets)));
    expect(host.textContent).toContain("19.3% / 50.0%");
    await act(async () => {
      await setLanguagePreference("tr");
    });
    expect(host.textContent).toContain("%19,3 / %50,0");
    expect(host.querySelector("time[datetime]")?.getAttribute("datetime")).not.toBeNull();
    expect(
      [...host.querySelectorAll("time")].some(
        (time) =>
          time.dateTime === new Date(reset).toISOString() && time.textContent?.includes("2027"),
      ),
    ).toBe(true);
    expect(readings.reading).toEqual({ used: 19.25, limit: 50, state: "ok", resetsAt: reset });
  } finally {
    act(() => root.unmount());
    host.remove();
    readings.budgets = [];
    readings.reading = null;
    await setLanguagePreference("en");
    vi.unstubAllGlobals();
  }
});

it("skips minute re-reads while the tab is hidden and re-reads once when it becomes visible", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(UsageBudgets)));
    const mountedRuleReads = readings.ruleReads;
    hidden = true;
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(readings.ruleReads).toBe(mountedRuleReads);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readings.ruleReads).toBe(mountedRuleReads + 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("lists blocking limits as short bullets in the budget help popover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(UsageBudgets)));
    const help = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    await act(async () => help.click());
    const bullets = Array.from(document.querySelectorAll("li"), (item) => item.textContent);
    expect(bullets).toContain("Running turns can exceed a budget.");
    expect(bullets).toContain(
      "Missing or stale data blocks new turns only when blocking is enabled.",
    );
    expect(document.body.textContent).not.toContain("Token budgets include input");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
