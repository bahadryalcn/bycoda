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
