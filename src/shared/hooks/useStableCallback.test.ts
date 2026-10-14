// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useStableCallback } from "./useStableCallback";
import { useStableValue } from "./useStableValue";

function mount<P>(hook: (props: P) => unknown, initial: P) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const seen: unknown[] = [];
  function Probe(props: { value: P }) {
    seen.push(hook(props.value));
    return null;
  }
  const render = (value: P) => act(() => root.render(createElement(Probe, { value })));
  render(initial);
  return { seen, render, unmount: () => act(() => root.unmount()) };
}

it("keeps one identity but calls the latest function", () => {
  const first = vi.fn(() => "first");
  const second = vi.fn(() => "second");
  const view = mount((fn: (() => string) | undefined) => useStableCallback(fn), first);
  view.render(second);
  const [a, b] = view.seen as Array<() => string>;
  expect(b).toBe(a);
  expect(b()).toBe("second");
  expect(first).not.toHaveBeenCalled();
  view.unmount();
});

it("returns undefined while given undefined and recovers", () => {
  const fn = vi.fn((x: number) => x * 2);
  const view = mount(
    (value: ((x: number) => number) | undefined) => useStableCallback(value),
    undefined,
  );
  view.render(fn);
  const live = view.seen[1] as ((x: number) => number) | undefined;
  expect(live?.(4)).toBe(8);
  view.render(undefined);
  const [none, , none2] = view.seen as Array<((x: number) => number) | undefined>;
  expect(none).toBeUndefined();
  expect(none2).toBeUndefined();
  view.unmount();
});

it("useStableValue keeps the previous reference while content is equal", () => {
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const view = mount((value: number[]) => useStableValue(value, same), [1, 2]);
  view.render([1, 2]);
  view.render([1, 3]);
  const [a, b, c] = view.seen as number[][];
  expect(b).toBe(a);
  expect(c).toEqual([1, 3]);
  expect(c).not.toBe(a);
  view.unmount();
});
