// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { history } = vi.hoisted(() => ({ history: [] as Record<string, unknown>[] }));
vi.mock("../../providers/model/rateLimitHistory", () => ({ useRateLimitHistory: () => history }));
import { QuotaHistory } from "./UsageQuotaHistory";
const at = (s: string) => Date.parse(s);
it("shows distinct accounts together by default and obeys provider/account filters", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  history.splice(
    0,
    history.length,
    { at: 100, account: "codex:default", kind: "session", used: 10, minutes: 300, resetsAt: null },
    { at: 100, account: "claude:work", kind: "session", used: 80, minutes: 300, resetsAt: null },
    { at: 100, account: "claude:work", kind: "weekly", used: 35, minutes: 10080, resetsAt: null },
    { at: 300, account: "claude:work", kind: "session", used: 99, minutes: 300, resetsAt: null },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const accounts = [
    { id: "default", provider: "codex" as const, label: "Personal", color: "pink" as const },
    { id: "work", provider: "claude" as const, label: "Work", color: "teal" as const },
    { id: "empty", provider: "claude" as const, label: "Unused" },
  ];
  const render = (provider: string[] = [], account: string[] = []) =>
    act(async () =>
      root.render(
        createElement(QuotaHistory, {
          window: { start: 0, end: 200 },
          filters: { provider, account, project: [], model: [], group: [] },
          accounts,
        }),
      ),
    );
  try {
    await render();
    expect(host.textContent).toContain("All accounts");
    expect(host.querySelectorAll(".usage-quota-point")).toHaveLength(2);
    expect(
      [...host.querySelectorAll(".usage-quota-legend-item")].map((node) => node.textContent),
    ).toEqual([
      "Codex · Personal10.0%",
      "Claude Code · Work80.0%",
      "Claude Code · UnusedNo records",
    ]);
    expect(
      new Set(
        [...host.querySelectorAll("tbody tr")].map((row) =>
          row.getAttribute("data-row-key")?.replace(/^codex:default:session:/, ""),
        ),
      ).size,
    ).toBe(2);
    expect(host.querySelector("tbody")?.textContent).toContain("Claude Code · Work");
    await render(["claude"]);
    expect(host.querySelectorAll(".usage-quota-point")).toHaveLength(1);
    expect(host.textContent).not.toContain("Codex · Personal10.0%");
    await render([], ["codex:default"]);
    expect(host.querySelectorAll(".usage-quota-point")).toHaveLength(1);
    expect(host.querySelector("tbody")?.textContent).toContain("Codex · Personal");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
it("sorts Time and Reset chronologically over year boundaries, with missing resets last", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const old = at("2025-12-31T12:00:00Z"),
    recent = at("2026-01-01T12:00:00Z");
  history.splice(
    0,
    history.length,
    {
      at: old,
      account: "codex:default",
      kind: "session",
      used: 10,
      minutes: 300,
      resetsAt: recent,
    },
    {
      at: recent,
      account: "codex:default",
      kind: "session",
      used: 20,
      minutes: 300,
      resetsAt: old,
    },
    {
      at: recent + 1000,
      account: "codex:default",
      kind: "session",
      used: 30,
      minutes: 300,
      resetsAt: null,
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(QuotaHistory, {
          window: { start: old - 1000, end: recent + 2000 },
          filters: { provider: [], account: [], project: [], model: [], group: [] },
          accounts: [{ id: "default", provider: "codex", label: "Default", color: "pink" }],
        }),
      ),
    );
    const order = () =>
      [...host.querySelectorAll("tbody tr")].map((row) =>
        row.getAttribute("data-row-key")?.replace(/^codex:default:session:/, ""),
      );
    const sort = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === `Sort by ${label}`,
      )!;
      expect(button).toBeTruthy();
      await act(async () => button.click());
    };
    await sort("Time");
    expect(order()).toEqual([String(old), String(recent), String(recent + 1000)]);
    await sort("Time");
    expect(order()).toEqual([String(recent + 1000), String(recent), String(old)]);
    await sort("Reset");
    expect(order()).toEqual([String(recent), String(old), String(recent + 1000)]);
    await sort("Reset");
    expect(order()).toEqual([String(old), String(recent), String(recent + 1000)]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
