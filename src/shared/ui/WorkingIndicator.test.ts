// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { WorkingIndicator } from "./WorkingIndicator";

type Entry = { target: Element; isIntersecting: boolean };
const observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  readonly observed = new Set<Element>();
  constructor(readonly callback: (entries: Entry[]) => void) {
    observers.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
}

const mounted: Root[] = [];

function render(container: HTMLElement) {
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(WorkingIndicator)));
  return container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
}

beforeAll(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
});

it("uses one shared observer and toggles only the root's offscreen attribute", () => {
  const first = render(document.createElement("div"));
  const second = render(document.createElement("div"));

  // Created lazily on first mount and shared by every indicator.
  expect(observers).toHaveLength(1);
  const [observer] = observers;
  expect(observer.observed.has(first)).toBe(true);
  expect(observer.observed.has(second)).toBe(true);

  observer.callback([{ target: first, isIntersecting: false }]);
  expect(first.getAttribute("data-offscreen")).toBe("true");
  expect(second.hasAttribute("data-offscreen")).toBe(false);

  observer.callback([{ target: first, isIntersecting: true }]);
  expect(first.hasAttribute("data-offscreen")).toBe(false);
  // The bar markup and className contract are unchanged.
  expect(first.parentElement!.querySelectorAll('[aria-hidden="true"] span span')).toHaveLength(4);
});

it("unobserves and clears the attribute when the indicator unmounts", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(WorkingIndicator)));
  const element = container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
  const [observer] = observers;
  observer.callback([{ target: element, isIntersecting: false }]);

  act(() => root.unmount());

  expect(observer.observed.has(element)).toBe(false);
  expect(element.hasAttribute("data-offscreen")).toBe(false);
});
