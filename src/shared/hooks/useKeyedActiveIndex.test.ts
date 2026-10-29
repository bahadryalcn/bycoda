// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clampActiveIndex, useKeyedActiveIndex } from "./useKeyedActiveIndex";

type Result = ReturnType<typeof useKeyedActiveIndex>;
let latest: Result;
let root: Root;
let container: HTMLDivElement;

function Probe({ resetKey, count, initial }: { resetKey: string; count: number; initial?: number }) {
  const result = useKeyedActiveIndex(resetKey, count, initial);
  useLayoutEffect(() => {
    latest = result;
  });
  return null;
}
const render = (props: { resetKey: string; count: number; initial?: number }) =>
  act(() => root.render(createElement(Probe, props)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("clamps to the list and treats -1 or an empty list as no active row", () => {
  expect(clampActiveIndex(5, 3)).toBe(2);
  expect(clampActiveIndex(-1, 3)).toBe(-1);
  expect(clampActiveIndex(0, 0)).toBe(-1);
});

it("keeps the chosen row across unrelated renders and restarts when the key changes", () => {
  render({ resetKey: "open:", count: 4, initial: 1 });
  expect(latest[0]).toBe(1);
  act(() => latest[1](3));
  render({ resetKey: "open:", count: 4, initial: 1 });
  expect(latest[0]).toBe(3);
  render({ resetKey: "open:a", count: 4, initial: 1 });
  expect(latest[0]).toBe(1);
});

it("clamps a shrinking list during render and applies functional updates in order", () => {
  render({ resetKey: "k", count: 5 });
  act(() => {
    latest[1]((index) => index + 1);
    latest[1]((index) => index + 1);
  });
  expect(latest[0]).toBe(2);
  render({ resetKey: "k", count: 2 });
  expect(latest[0]).toBe(1);
});
