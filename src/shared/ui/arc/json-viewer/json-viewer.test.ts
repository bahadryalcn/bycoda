// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonViewer } from "./json-viewer";

// Assert the current page independently of motion's exit frames.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

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
  const value = row.querySelector("[data-tooltip-owner]")!;
  expect(value.hasAttribute("title")).toBe(false);
  vi.useFakeTimers();
  try {
    act(() => {
      value.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      vi.advanceTimersByTime(450);
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(long);
  } finally {
    vi.useRealTimers();
  }
  const copy = row.querySelector<HTMLButtonElement>('button[aria-label="Copy value"]')!;
  // Row actions are revealed with the row, not in the tab order of every row.
  expect(copy.tabIndex).toBe(-1);
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith(long);
});

it("builds no search index until a query settles and keeps the search input element", async () => {
  const reads = { count: 0 };
  const hidden: Record<string, unknown> = {};
  Object.defineProperty(hidden, "label", {
    enumerable: true,
    get() {
      reads.count += 1;
      return "Bravo";
    },
  });
  const data = { hidden };
  const render = (query: string) =>
    act(async () => root.render(createElement(JsonViewer, { data, query, defaultExpandDepth: 0 })));
  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Search JSON"]')!;
  await render("");
  const field = input();
  // A collapsed branch is never read while nobody searches.
  expect(reads.count).toBe(0);
  await render("bra");
  await act(async () => vi.advanceTimersByTime(149));
  expect(reads.count).toBe(0);
  await act(async () => vi.advanceTimersByTime(1));
  expect(reads.count).toBeGreaterThan(0);
  expect(container.querySelector("mark")?.textContent).toBe("Bra");
  const branch = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((item) =>
    item.getAttribute("aria-label")?.startsWith("hidden,"),
  )!;
  expect(branch.getAttribute("aria-expanded")).toBe("true");
  expect(input()).toBe(field);
  expect(field.value).toBe("bra");
});

it("keeps long arrays paged and reaches a late match without building the index first", async () => {
  const data = Array.from({ length: 5000 }, (_, index) => `v${index}x`);
  const items = () => container.querySelectorAll('[role="treeitem"]').length;
  const render = (query: string) =>
    act(async () => root.render(createElement(JsonViewer, { data, query, defaultExpandDepth: 1 })));
  await render("");
  // Root, one page of children and the "show more" row.
  expect(items()).toBe(52);
  await render("V60X");
  await act(async () => vi.advanceTimersByTime(150));
  expect(container.textContent).toContain("1/1");
  expect(container.querySelector("mark")?.textContent).toBe("v60x");
  // The page grows only as far as the match: root, 61 children and the "show more" row.
  expect(items()).toBe(63);
  await render("");
  await act(async () => vi.advanceTimersByTime(150));
  expect(items()).toBe(52);
});

it("keeps one copy action per row, none on the root row when the host copies everything, and none in the footer", async () => {
  await act(async () =>
    root.render(createElement(JsonViewer, { data: { a: { b: 1 } }, copyRoot: false })),
  );
  const names = (row: Element) =>
    [...row.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
  const rows = [...container.querySelectorAll('[role="treeitem"]')];
  expect(names(rows[0]!)).toEqual([]);
  expect(names(rows[1]!)).toEqual(["Copy value", "Copy path"]);
  // Only row actions remain: the path footer carries no copy button.
  expect(container.querySelectorAll('button[aria-label^="Copy"]')).toHaveLength(2);
});

it("offers value copy but no path copy on the root row by default", async () => {
  await act(async () => root.render(createElement(JsonViewer, { data: { a: 1 } })));
  const root0 = container.querySelector('[role="treeitem"]')!;
  expect([...root0.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
    "Copy value",
  ]);
});

it("hides search and expand controls when the toolbar is off", async () => {
  await act(async () =>
    root.render(createElement(JsonViewer, { data: { a: { b: 1 } }, toolbar: false })),
  );
  expect(container.querySelector('input[aria-label="Search JSON"]')).toBeNull();
  expect(container.querySelector('button[aria-label="Expand all"]')).toBeNull();
});
