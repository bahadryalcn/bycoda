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

it("keeps the compact working dot decorative and on the shared offscreen observer", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(WorkingIndicator, { variant: "dot" })));
  const indicator = container.querySelector<HTMLElement>('[data-working-variant="dot"]')!;
  expect(indicator).not.toBeNull();
  expect(indicator.getAttribute("aria-hidden")).toBe("true");
  expect(indicator.className).toContain("working-dot");
  expect(indicator.children).toHaveLength(0);
  expect(observers[0].observed.has(indicator)).toBe(true);
  act(() => observers[0].callback([{ target: indicator, isIntersecting: false }]));
  expect(indicator.getAttribute("data-offscreen")).toBe("true");
});

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

it("is decorative by default and one polite status when it carries a label", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(WorkingIndicator)));
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  act(() => root.render(createElement(WorkingIndicator, { label: "Running checks" })));
  const status = container.querySelector('[role="status"]')!;
  expect(status.getAttribute("aria-hidden")).toBeNull();
  expect(status.textContent).toBe("Running checks");
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  // The bars stay hidden from assistive technology.
  expect(status.querySelector("span[aria-hidden='true']")).not.toBeNull();
});

it("owns its size variant and keeps consumer classes for placement only", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(WorkingIndicator)));
  const element = container.firstElementChild!;
  // Default follows the icon-xs slot that status icons use.
  expect(element.getAttribute("data-size")).toBe("xs");
  act(() => root.render(createElement(WorkingIndicator, { size: "md", className: "ml-1" })));
  expect(element.getAttribute("data-size")).toBe("md");
  expect(element.classList.contains("ml-1")).toBe(true);
});

it("uses one agent-work implementation for labels and compact marks", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  act(() =>
    root.render(createElement(WorkingIndicator, { children: "Thinking…", label: "Agent working" })),
  );
  expect(container.querySelectorAll('[data-size="xs"]')).toHaveLength(1);
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("Thinking…");
  act(() => root.render(createElement(WorkingIndicator, { children: "Running", glyph: false })));
  expect(container.querySelector('[data-size="xs"]')).toBeNull();
  expect(container.textContent).toBe("Running");
});
