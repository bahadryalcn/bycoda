// @vitest-environment happy-dom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RETAINED_STATE_CAPACITY, RetainedStateCapacityError, resetRetainedState, useRetainedState } from "./useRetainedState";

let root: Root;
let host: HTMLDivElement;
let change!: ReturnType<typeof useRetainedState<number>>[1];
function Harness({ scope }: { scope: string }) {
  const [value, setValue] = useRetainedState(scope, 0);
  useLayoutEffect(() => {
    change = setValue;
  }, [setValue]);
  return createElement("span", null, value);
}
beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const render = (scope: string) => act(() => root.render(createElement(Harness, { scope })));

it("restores on remount, changes scope synchronously and binds deferred setters to their original scope", () => {
  render("a");
  act(() => change((value) => value + 1));
  const oldSetter = change;
  render("b");
  expect(host.textContent).toBe("0");
  act(() => oldSetter((value) => value + 1));
  expect(host.textContent).toBe("0");
  render("a");
  expect(host.textContent).toBe("2");
  act(() => root.unmount());
  root = createRoot(host);
  render("a");
  expect(host.textContent).toBe("2");
});


it("bounds pristine entries while preserving a dirty unmounted draft", () => {
  render("protected");
  act(() => change(42));
  for (let index = 0; index < 1000; index++) render(`pristine:${index}`);
  render("protected");
  expect(host.textContent).toBe("42");
});

it("rejects admission when every entry holds a dirty draft", () => {
  for (let index = 0; index < RETAINED_STATE_CAPACITY; index++) {
    render(`draft:${index}`);
    act(() => change(1));
  }
  expect(() => render("overflow")).toThrow(RetainedStateCapacityError);
  root = createRoot(host);
  render("draft:0");
  expect(host.textContent).toBe("1");
});

it("ignores a stale setter after a pristine key is evicted and recreated", () => {
  render("old");
  const stale = change;
  for (let index = 0; index < 1000; index++) render(`other:${index}`);
  render("old");
  act(() => stale(99));
  expect(host.textContent).toBe("0");
});

it("keeps the canonical draft through StrictMode remount and ignores retired setters", () => {
  act(() => root.render(createElement(StrictMode, null, createElement(Harness, { scope: "strict" }))));
  act(() => change(7));
  const setter = change;
  render("other");
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(createElement(StrictMode, null, createElement(Harness, { scope: "strict" }))));
  expect(host.textContent).toBe("7");
  act(() => setter(8));
  expect(host.textContent).toBe("8");
});

it("does not retire a draft edited after save began", () => {
  let set!: (value: string) => void;
  let retire!: (expected: string, replacement: string) => boolean;
  function Draft() {
    const [value, update, finish] = useRetainedState("comment", "");
    set = update;
    retire = finish;
    return createElement("span", null, value);
  }
  act(() => root.render(createElement(Draft)));
  act(() => set("sent"));
  act(() => set("new draft"));
  act(() => { expect(retire("sent", "")).toBe(false); });
  expect(host.textContent).toBe("new draft");
  act(() => { expect(retire("new draft", "")).toBe(true); });
  expect(host.textContent).toBe("");
});

