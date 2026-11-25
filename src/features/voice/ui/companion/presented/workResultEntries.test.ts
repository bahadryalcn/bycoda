// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkRecord } from "../../../model/voiceWorkResultBlocks";
import { WorkRecordsProvider, WorkResultsRenderer, workResultEntries } from "./workResultEntries";

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
});

const records: WorkRecord[] = [
  { id: "first", title: "Review patch", status: "done", source: "Command" },
  { id: "next", title: "Build package", status: "failed", source: "Voice" },
  { id: "last", title: "Check results", status: "done", source: "Command" },
];

const program = (sections: string) =>
  [
    'all = WorkStatusFilter("all")',
    'done = WorkStatusFilter("done")',
    'failed = WorkStatusFilter("failed")',
    'running = WorkStatusFilter("running")',
    "counts = WorkStatusCounts([all, done, failed, running])",
    "chart = WorkResultDistribution()",
    "source = WorkResultSourceComparison()",
    'table = WorkResultTable("activity")',
    `root = WorkResults([${sections}])`,
  ].join("\n");

async function render(response: string, live: WorkRecord[] = records, selectedId?: string) {
  await act(async () =>
    root.render(
      createElement(WorkRecordsProvider, {
        value: { records: live, selectedId, onSelect: onSelectSpy },
        children: createElement(WorkResultsRenderer, { program: response }),
      }),
    ),
  );
}

const onSelectSpy = vi.fn();

function button(prefix: string) {
  const found = Array.from(container.querySelectorAll("button")).find((element) =>
    element.textContent?.trim().startsWith(prefix),
  );
  expect(found, `button starting with ${prefix}`).toBeDefined();
  return found as HTMLButtonElement;
}

function recordTable() {
  const table = container.querySelector("tbody tr[data-row-key]")?.closest("table");
  expect(table).not.toBeNull();
  return table as HTMLTableElement;
}

function displayedRecords() {
  return Array.from(container.querySelectorAll("tbody tr[data-row-key]"), (row) =>
    row.getAttribute("data-row-key"),
  );
}

it("strip counts come from the live records; empty statuses stay hidden", async () => {
  await render(program("counts, table"));
  expect(button("All · 3").getAttribute("aria-pressed")).toBe("true");
  expect(button("Completed · 2")).toBeDefined();
  expect(button("Failed · 1")).toBeDefined();
  expect(container.textContent).not.toContain("Working");
  expect(displayedRecords()).toEqual(["first", "next", "last"]);
  expect(recordTable().querySelector("caption")?.textContent).toContain("Results");
});

it("a strip filter narrows the visible records and is pressed", async () => {
  await render(program("counts, table"));
  await act(async () => button("Failed · 1").click());
  expect(displayedRecords()).toEqual(["next"]);
  expect(button("Failed · 1").getAttribute("aria-pressed")).toBe("true");
  expect(button("All · 3").getAttribute("aria-pressed")).toBe("false");

  await act(async () => button("All · 3").click());
  expect(displayedRecords()).toEqual(["first", "next", "last"]);
});

it("the filter applies to the table through the shared root state", async () => {
  await render(program("counts, chart, table"));
  await act(async () => button("Completed · 2").click());
  expect(displayedRecords()).toEqual(["first", "last"]);
});

it("table sort from the program reorders the visible records", async () => {
  await render(
    program("table").replace('WorkResultTable("activity")', 'WorkResultTable("status")'),
  );
  expect(displayedRecords()).toEqual(["first", "last", "next"]);
});

it("row activation reports the chosen id and marks the selected row", async () => {
  await render(program("table"), records, "first");
  expect(container.querySelector('[data-row-key="first"]')?.getAttribute("aria-current")).toBe(
    "true",
  );
  await act(async () => {
    container
      .querySelector('[data-row-key="next"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(onSelectSpy).toHaveBeenCalledWith("next");
});

it("a source comparison renders only when there are two sources", async () => {
  const chartLabel = '[aria-label*="explore by source"]';
  await render(program("source, table"));
  expect(container.querySelector(chartLabel)).not.toBeNull();
  expect(displayedRecords()).toHaveLength(3);

  const oneSource = records.map((record) => ({ ...record, source: "Command" }));
  await render(program("source, table"), oneSource);
  expect(container.querySelector(chartLabel)).toBeNull();
  expect(displayedRecords()).toHaveLength(3);
});

it("an empty record set shows an empty table and an All count of zero", async () => {
  await render(program("counts, table"), []);
  expect(displayedRecords()).toEqual([]);
  expect(container.textContent).toContain("No records");
  expect(button("All · 0")).toBeDefined();
});

it("the presented entries are unique, observed, and reject invented props", () => {
  const names = workResultEntries.map((entry) => entry.spec.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names.sort()).toEqual([
    "WorkResultDistribution",
    "WorkResultSourceComparison",
    "WorkResultTable",
    "WorkResults",
    "WorkStatusCounts",
    "WorkStatusFilter",
  ]);
  for (const entry of workResultEntries) expect(entry.spec.group).toBe("observed");

  const spec = (name: string) => workResultEntries.find((entry) => entry.spec.name === name)!.spec;
  expect(spec("WorkResultTable").props.safeParse({ sort: "status" }).success).toBe(true);
  expect(spec("WorkResultTable").props.safeParse({ sort: "bogus" }).success).toBe(false);
  expect(spec("WorkResultTable").props.safeParse({ sort: "status", rows: [] }).success).toBe(false);
  expect(spec("WorkStatusFilter").props.safeParse({ filter: "done" }).success).toBe(true);
  expect(spec("WorkStatusFilter").props.safeParse({ filter: "done", count: 99 }).success).toBe(
    false,
  );
  expect(spec("WorkResults").props.safeParse({ sections: [] }).success).toBe(false);
  expect(spec("WorkResultDistribution").props.safeParse({ label: "invented" }).success).toBe(false);
});
