// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExpandingSearch } from "./ExpandingSearch";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
async function type(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

it("uses external result order unchanged and keeps IME Enter separate from result activation", async () => {
  const select = vi.fn();
  function Search() {
    const [query, setQuery] = useState("");
    return createElement(ExpandingSearch, {
      label: "Search settings",
      query,
      onQueryChange: setQuery,
      items: [],
      results: [
        { id: "z", title: "Zulu", group: "Second" },
        { id: "a", title: "Alpha", group: "First" },
      ],
      onSelect: select,
    });
  }
  await act(async () => root.render(createElement(Search)));
  await act(async () => container.querySelector("button")!.click());
  const input = await type("unrelated external query");
  expect([...document.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual(
    ["Zulu", "Alpha"],
  );
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    ),
  );
  expect(select).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(container.querySelector("button"));
});

it("clears through the controlled owner and lets the shared overlay dismiss Escape once", async () => {
  const changed = vi.fn();
  function Search() {
    const [query, setQuery] = useState("");
    return createElement(ExpandingSearch, {
      label: "Search",
      query,
      onQueryChange: (value) => {
        changed(value);
        setQuery(value);
      },
      items: [{ id: "a", title: "Alpha" }],
    });
  }
  await act(async () => root.render(createElement(Search)));
  await act(async () => container.querySelector("button")!.click());
  const input = await type("Alpha");
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click(),
  );
  expect(changed).toHaveBeenLastCalledWith("");
  expect(document.activeElement).toBe(input);
  await type("Alpha");
  changed.mockClear();
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith("");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});
