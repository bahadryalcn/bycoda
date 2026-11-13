// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { AssistantUsageChips } from "./AssistantUsageSettings";

let root: Root | undefined, container: HTMLDivElement;
async function mount(usage: Partial<AssistantSnapshot["usage"]>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AssistantUsageChips, {
        usage: { day: "2026-01-01", chiefTokens: 10, workerTokens: 1000, ...usage } as never,
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

it("shows budget-counted worker tokens and raw cache reads as separate facts", async () => {
  const text = await mount({ cacheUsage: cache({}) });
  expect(text).toContain("Supervisor tokens: 10");
  expect(text).toContain("Worker tokens: 1,000");
  expect(text).toContain("Cache read tokens: 900");
  expect(text).not.toContain("Chief tokens");
});

it("keeps the total when cache reads are partial or missing", async () => {
  expect(await mount({ cacheUsage: cache({ complete: false }) })).toContain("Worker tokens: 1,000");
  await act(async () => root?.unmount());
  container.remove();
  expect(await mount({})).toContain("Worker tokens: 1,000");
});

it("never derives worker tokens from cache reads", async () => {
  expect(await mount({ cacheUsage: cache({ cacheReadTokens: 5000 }) })).toContain(
    "Worker tokens: 1,000",
  );
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
  expect(text).toContain("Worker tokens: 1,000");
  expect(text).not.toContain("Cache read tokens: 0");
  expect(text).not.toContain("Cache write tokens: 0");
  expect(text).not.toContain("Cache usage unavailable");
});
