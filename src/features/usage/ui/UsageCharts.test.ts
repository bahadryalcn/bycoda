// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContinuousUsageTable, formatMetric } from "./UsageCharts";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { HARNESS_ICONS } from "../../../shared/ui/identity/HarnessIcon";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRetainedState();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const rows = Array.from({ length: 1000 }, (_, index) => ({
  key: String(index),
  label: `Account ${index}`,
  tokens: index,
  cost: index / 10,
}));

it("provides full records through a bounded table without page controls", async () => {
  await act(async () =>
    root.render(
      createElement(ContinuousUsageTable, { rows, caption: "Accounts", metric: "tokens" }),
    ),
  );
  expect(container.querySelector("table")?.getAttribute("aria-rowcount")).toBe("1001");
  expect(container.querySelectorAll("tbody tr").length).toBeLessThan(64);
  expect(container.textContent).toContain("Account 999");
  expect(container.textContent).not.toContain("Next");
  expect(container.textContent).not.toContain("Previous");
});

it("preserves table identity and scroll when rows append and sort changes", async () => {
  const render = (count: number) =>
    act(async () =>
      root.render(
        createElement(ContinuousUsageTable, {
          rows: rows.slice(0, count),
          caption: "Accounts",
          metric: "tokens",
          stateKey: "usage:account-filter",
        }),
      ),
    );
  await render(30);
  const table = container.querySelector("table")!;
  const scroll = table.parentElement!;
  scroll.scrollTop = 100;
  scroll.dispatchEvent(new Event("scroll"));
  await render(40);
  expect(container.querySelector("table")).toBe(table);
  expect(scroll.scrollTop).toBe(100);
  const nameHeader = [...container.querySelectorAll<HTMLElement>("th")].find((node) =>
    node.textContent?.includes("Name"),
  )!;
  await act(async () => nameHeader.click());
  expect(container.querySelector("table")).toBe(table);
  expect(container.querySelector("th[aria-sort]")?.getAttribute("aria-sort")).toBeDefined();
});

it("keeps provider marks separate from session titles", async () => {
  await act(async () =>
    root.render(
      createElement(ContinuousUsageTable, {
        caption: "Recorded sessions",
        metric: "tokens",
        rows: [{ key: "session", label: "Review changes", provider: "claude", tokens: 10 }],
      }),
    ),
  );
  expect(container.querySelector("tbody")?.textContent).toContain("Review changes");
  expect(container.querySelector("tbody img")?.getAttribute("src")).toBe(HARNESS_ICONS.claude);
});

it("displays canonical provider names without duplicating their marks", async () => {
  await act(async () =>
    root.render(
      createElement(ContinuousUsageTable, {
        caption: "Providers",
        metric: "tokens",
        rows: [{ key: "codex", label: "codex", providers: ["codex"], tokens: 10 }],
      }),
    ),
  );
  expect(container.querySelector("tbody")?.textContent).toContain("Codex");
  expect(container.querySelectorAll("tbody img")).toHaveLength(1);
});

it("localizes duration units without changing the chart rounding contract", async () => {
  const { setLanguagePreference } = await import("../../../shared/i18n");
  await setLanguagePreference("en");
  expect(
    [499, 59999, 60000, 119999, 3905000].map((value) => formatMetric(value, "duration")),
  ).toEqual(["0s", "60s", "1m", "1m", "1h 5m"]);
  await setLanguagePreference("tr");
  try {
    expect(
      [499, 59999, 60000, 119999, 3905000].map((value) => formatMetric(value, "duration")),
    ).toEqual(["0 sn", "60 sn", "1 dk", "1 dk", "1 sa 5 dk"]);
  } finally {
    await setLanguagePreference("en");
  }
});
