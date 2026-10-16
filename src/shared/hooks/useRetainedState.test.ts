// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState, useRetainedState } from "./useRetainedState";

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
