// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarSessionSearch } from "./SidebarSessionSearch";

let root: Root;
let container: HTMLDivElement;
let setParentQuery: (query: string) => void;
const committed: string[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  committed.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A Sidebar stand-in whose committed query only changes when the test says so, like a slow transition. */
function Harness() {
  const [query, setQuery] = useState("");
  setParentQuery = setQuery;
  return createElement(SidebarSessionSearch, {
    query,
    onQueryChange: (next: string) => committed.push(next),
    onExpandedChange: () => {},
  });
}

async function type(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

async function open() {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => container.querySelector("button")!.click());
}

it("keeps typed text while an older committed query comes back, and reports every change upward", async () => {
  await open();
  await type("a");
  const input = await type("ab");
  expect(committed).toEqual(["a", "ab"]);
  // The Sidebar renders the older transition first; that echo must not rewind the field.
  await act(async () => setParentQuery("a"));
  expect(input.value).toBe("ab");
  await act(async () => setParentQuery("ab"));
  expect(input.value).toBe("ab");
});

it("replaces the draft when the Sidebar resets the query from outside", async () => {
  await open();
  await type("abc");
  await act(async () => setParentQuery("abc"));
  await act(async () => setParentQuery(""));
  expect(container.querySelector("input")?.value ?? "").toBe("");
});
