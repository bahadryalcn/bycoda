// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  deleteUsageBudget,
  loadUsageBudgets,
  saveUsageBudget,
  subscribeUsageBudgets,
} from "./usageBudgetStore";
import type { UsageBudget } from "./usageBudgets";

const rule: UsageBudget = {
  id: "one",
  scope: "project",
  target: "C:/app",
  label: "App",
  metric: "tokens",
  period: "weekly",
  capacity: 1000,
  percent: 25,
  provider: "codex",
  accountId: "default",
  action: "monitor",
};
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("keeps independent rules, updates an existing rule and notifies changes", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeUsageBudgets(listener);
  saveUsageBudget(rule);
  saveUsageBudget({ ...rule, id: "two" });
  saveUsageBudget({ ...rule, percent: 50 });
  expect(loadUsageBudgets().map((b) => b.percent)).toEqual([50, 25]);
  deleteUsageBudget("two");
  expect(loadUsageBudgets()).toHaveLength(1);
  expect(listener).toHaveBeenCalledTimes(4);
  unsubscribe();
});
it("does not erase malformed or inaccessible settings", () => {
  localStorage.setItem("bycoda.usageBudgets.v1", "{broken");
  expect(() => saveUsageBudget(rule)).toThrow();
  expect(localStorage.getItem("bycoda.usageBudgets.v1")).toBe("{broken");
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("denied");
    },
  });
  expect(() => loadUsageBudgets()).toThrow("denied");
});
