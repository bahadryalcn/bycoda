// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
  loadUsageBudgets: () => [],
  subscribeUsageBudgets: () => () => {},
  saveUsageBudget: vi.fn(),
  deleteUsageBudget: vi.fn(),
}));
vi.mock("../model/usageBudgetReadings", () => ({ createBudgetReader: () => vi.fn() }));
import { UsageBudgets } from "./UsageBudgets";

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
