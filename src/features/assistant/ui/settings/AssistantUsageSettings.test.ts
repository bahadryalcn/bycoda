// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { AssistantRetentionField, AssistantUsageSummary } from "./AssistantUsageSettings";

let root: Root | undefined, container: HTMLDivElement;
async function mount(usage: Partial<AssistantSnapshot["usage"]>, dailyBudget?: number) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AssistantUsageSummary, {
        dailyBudget,
        usage: {
          day: "2026-01-01",
          chiefTokens: 10,
          workerTokens: 1000,
          total: 1010,
          estimated: false,
          mode: "run",
          ...usage,
        },
      }),
    ),
  );
  return container.textContent ?? "";
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

const cache = (over: object) => ({
  scope: "worker-turns" as const,
  measuredTurns: 2,
  totalTurns: 2,
  percentageTurns: 2,
  cacheReadTokens: 900,
  cacheWriteTokens: 5,
  cacheHitPercent: 90,
  complete: true,
  ...over,
});

it("shows unavailable usage when no snapshot usage was received", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AssistantRetentionField, { value: 30, disabled: false, onChange: vi.fn() }),
    ),
  );
  expect(container.textContent).toContain("Today's usage");
  expect(container.textContent).toContain("Unavailable");
});

async function openDetails() {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Usage details"]')!;
  await act(async () => trigger.click());
  return document.body.textContent ?? "";
}

it("shows the budget total and keeps worker and raw cache counts in details", async () => {
  const text = await mount({ cacheUsage: cache({}) }, 2000);
  expect(text).toContain("1,010 of 2,000 tokens");
  expect(text).not.toContain("Cache read tokens:");
  const details = await openDetails();
  expect(details).toContain("Supervisor tokens: 10");
  expect(details).toContain("Worker tokens: 1,000");
  expect(details).toContain("Cache read tokens: 900");
});

it("keeps the total when cache reads are partial or missing", async () => {
  expect(await mount({ cacheUsage: cache({ complete: false }) })).toContain("1,010 tokens");
  await act(async () => root?.unmount());
  container.remove();
  expect(await mount({})).toContain("1,010 tokens");
});

it("never derives worker tokens from cache reads", async () => {
  expect(await mount({ cacheUsage: cache({ cacheReadTokens: 5000 }) })).toContain("1,010 tokens");
});

it("shows one missing-usage message and does not turn missing cache facts into zero", async () => {
  const text = await mount({
    workerUsageIncomplete: true,
    cacheUsage: cache({
      complete: false,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      cacheHitPercent: undefined,
    }),
  });
  expect(text.match(/Some usage is unavailable\./g)).toHaveLength(1);
  expect(text).toContain("1,010 tokens");
  expect(text).not.toContain("Cache usage unavailable");
  const details = await openDetails();
  expect(details).toContain("Cache read tokens: Unavailable");
  expect(details).toContain("Cache write tokens: Unavailable");
});
