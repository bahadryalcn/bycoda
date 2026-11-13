// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SocialNav } from "./SocialNav";

const resize = vi.hoisted(() => ({ listeners: new Map<Element, () => void>() }));
vi.mock("../../../../shared/lib/observeResize", () => ({
  observeResize: (element: Element, listener: () => void) => {
    resize.listeners.set(element, listener);
    return () => resize.listeners.delete(element);
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  resize.listeners.clear();
});

it("reveals external selection, container resize and enlarged tab text without scrolling page", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let accountsRight = 600;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const nav = this.closest("nav");
    const scroll = nav?.scrollLeft ?? 0;
    const left =
      this.tagName === "NAV" ? 0 : this.dataset.tabValue === "accounts" ? 400 - scroll : -scroll;
    return {
      left,
      right:
        this.tagName === "NAV"
          ? 300
          : this.dataset.tabValue === "accounts"
            ? accountsRight - scroll
            : 100 - scroll,
    } as DOMRect;
  });
  const onSelect = vi.fn();
  act(() => root.render(createElement(SocialNav, { active: "accounts", onSelect })));
  const nav = element.querySelector("nav")!;
  expect(nav.scrollLeft).toBe(300);
  accountsRight = 700;
  act(() => resize.listeners.get(nav)?.());
  expect(nav.scrollLeft).toBe(400);
  accountsRight = 780;
  const selected = element.querySelector('[aria-selected="true"]')!;
  act(() => resize.listeners.get(selected)?.());
  expect(nav.scrollLeft).toBe(480);
  act(() => root.render(createElement(SocialNav, { active: "command", onSelect })));
  expect(nav.scrollLeft).toBe(0);
  expect(window.scrollY).toBe(0);
  expect(onSelect).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(resize.listeners.size).toBe(0);
  element.remove();
  vi.unstubAllGlobals();
});
