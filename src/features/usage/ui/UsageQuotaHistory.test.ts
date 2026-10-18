// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { history } = vi.hoisted(() => ({ history: [] as Record<string, unknown>[] }));
vi.mock("../../providers/model/rateLimitHistory", () => ({ useRateLimitHistory: () => history }));
import { QuotaHistory } from "./UsageQuotaHistory";
const at = (s: string) => Date.parse(s);
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
      [...host.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));
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
