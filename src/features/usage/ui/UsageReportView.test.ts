// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsageReport, UsageReportRow } from "../model/usageReport";

const openUsageDashboard = vi.hoisted(() => vi.fn(async () => ({ filtersApplied: true })));
vi.mock("../data/openUsageDashboard", () => ({ openUsageDashboard }));
const { default: UsageReportView } = await import("./UsageReportView");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  openUsageDashboard.mockClear();
});

const item = (key: string, label: string, tokens: number, extra: Partial<UsageReportRow> = {}) => ({
  key,
  label,
  cost: tokens / 100,
  tokens,
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  durationMs: 0,
  unpricedTokens: 0,
  share: null,
  ...extra,
});
const report = (patch: Partial<UsageReport> = {}): UsageReport => ({
  period: "monthly-history",
  metric: "tokens",
  costBasis: "api-equivalent-estimate",
  timeZone: "UTC",
  window: { startMs: 10, endMs: 20, start: "", end: "" },
  filters: { provider: "codex" },
  totals: {
    cost: 3,
    tokens: 300,
    input: 300,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    durationMs: 0,
    unpricedTokens: 0,
  },
  providers: [item("codex", "codex", 300)],
  models: [item("gpt-5", "GPT-5", 200), item("other", "Other", 100, { grouped: 3 })],
  projects: [],
  months: [
    { key: "2026-10", startMs: 0, endMs: 1, partial: false, cost: 1, tokens: 100, durationMs: 0 },
    { key: "2026-11", startMs: 1, endMs: 2, partial: true, cost: 2, tokens: 200, durationMs: 0 },
  ],
  coverage: {
    partial: true,
    accounts: { read: 1, failed: 0 },
    sessionTurns: "available",
    notes: [],
  },
  ...patch,
});
const render = (value: UsageReport) =>
  act(async () => root.render(createElement(UsageReportView, { report: value })));

it("draws provider, model and month charts from the report, with a single provider and a bounded tail", async () => {
  await render(report());
  const text = container.textContent ?? "";
  for (const label of ["codex", "GPT-5", "2026-10", "2026-11", "Partial"])
    expect(text).toContain(label);
  // The tail names how many models it groups.
  expect(text).toContain("Other · 3");
  expect(container.querySelectorAll("figure, [role='img']").length).toBeGreaterThanOrEqual(3);
});

it("reopens the dashboard with the report's exact window, filter, metric and granularity", async () => {
  await render(report());
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Open",
  );
  await act(async () => button?.click());
  expect(openUsageDashboard).toHaveBeenCalledOnce();
  expect(openUsageDashboard).toHaveBeenCalledWith(
    expect.objectContaining({
      preset: "custom",
      window: { start: 10, end: 20 },
      filters: expect.objectContaining({ provider: ["codex"], model: [], project: [] }),
      metric: "tokens",
      resolution: "week",
    }),
  );
});

it("shows an empty report as no records", async () => {
  await render(report({ providers: [], models: [], months: undefined, period: "month-to-date" }));
  expect(container.textContent).toContain("No records");
});
