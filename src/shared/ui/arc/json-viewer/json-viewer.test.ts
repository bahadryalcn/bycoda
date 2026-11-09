// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonViewer } from "./json-viewer";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("coalesces controlled searches and finds mixed-case values in collapsed branches", async () => {
  const data = { hidden: { label: "BraVo" }, other: "unrelated" };
  const render = (query: string) =>
    act(async () =>
      root.render(
        createElement(JsonViewer, {
          data,
          query,
          defaultExpandDepth: 0,
        }),
      ),
    );
  await render("");
  await render("BRA");
  await act(async () => vi.advanceTimersByTime(100));
  await render("BRAVO");
  await act(async () => vi.advanceTimersByTime(149));
  expect(container.querySelector("mark")).toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  expect(container.querySelector("mark")?.textContent).toBe("BraVo");
  expect(container.textContent).toContain("1/1");
  await render("");
  await act(async () => vi.advanceTimersByTime(150));
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Search JSON"]')?.value).toBe(
    "",
  );
});

it("rebuilds the search index when data changes and cancels work on unmount", async () => {
  await act(async () =>
    root.render(createElement(JsonViewer, { data: { value: "old" }, query: "NEW" })),
  );
  expect(container.textContent).toContain("0/0");
  await act(async () =>
    root.render(createElement(JsonViewer, { data: { value: "new" }, query: "NEW" })),
  );
  expect(container.querySelector("mark")?.textContent).toBe("new");
  await act(async () => root.render(createElement(JsonViewer, { data: {}, query: "pending" })));
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => vi.advanceTimersByTime(200));
  expect(container.textContent).toBe("");
});

it("uses shared icon Buttons for the toolbar and toggles a branch from the keyboard", async () => {
  await act(async () =>
    root.render(
      createElement(JsonViewer, { data: { user: { name: "Ada" } }, defaultExpandDepth: 1 }),
    ),
  );
  for (const name of ["Expand all", "Collapse all"]) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    expect(button.getAttribute("data-button-hierarchy")).toBe("ghost");
  }
  const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
  const rootRow = container.querySelector<HTMLElement>('[role="treeitem"][aria-level="1"]')!;
  expect(rootRow.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    rootRow.focus();
    tree.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(rootRow.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    tree.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
  });
  expect(rootRow.getAttribute("aria-expanded")).toBe("true");
});

it("truncates a long string in the row but copies and exposes its full value", async () => {
  const long = `${"segment-".repeat(12)}end`;
  const writeText = vi.fn(async () => {});
  await act(async () =>
    root.render(
      createElement(JsonViewer, { data: { text: long }, writeText, defaultExpandDepth: 1 }),
    ),
  );
  const row = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((item) =>
    item.getAttribute("aria-label")?.startsWith("text:"),
  )!;
  expect(row.querySelector("[title]")?.getAttribute("title")).toBe(long);
  const copy = row.querySelector<HTMLButtonElement>('button[aria-label="Copy value"]')!;
  // Row actions are revealed with the row, not in the tab order of every row.
  expect(copy.tabIndex).toBe(-1);
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith(long);
});
