// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LANGUAGES, setLanguagePreference } from "../../../shared/i18n";
import { ComposerTips, COMPOSER_TIPS, COMPOSER_TIP_INTERVAL } from "./ComposerTips";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await setLanguagePreference("en");
});
const render = (active = true) => act(() => root.render(createElement(ComposerTips, { active })));
const icon = () => container.querySelector<HTMLButtonElement>("button")!;
const open = () => act(() => icon().click());
const close = () =>
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const text = () => document.querySelector(".composer-tips-text")?.getAttribute("aria-label");
const advance = () => act(() => vi.advanceTimersByTime(COMPOSER_TIP_INTERVAL));

it("only opens by activation, updates its label and stays closed after Escape", () => {
  render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(icon().getAttribute("aria-label")).toBe("Tip");
  expect(icon().getAttribute("aria-expanded")).toBe("false");
  expect(icon().hasAttribute("aria-controls")).toBe(false);
  act(() => icon().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  act(() => icon().focus());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  open();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  expect(icon().textContent).toBe("Next tip");
  expect(icon().getAttribute("aria-label")).toBe("Next tip");
  expect(icon().getAttribute("aria-expanded")).toBe("true");
  expect(icon().getAttribute("aria-controls")).toBe(document.querySelector('[role="dialog"]')!.id);
  close();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(icon().getAttribute("aria-expanded")).toBe("false");
  expect(icon().hasAttribute("aria-controls")).toBe(false);
  act(() => icon().blur());
  act(() => icon().focus());
  act(() => icon().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  open();
  expect(text()).toBe(COMPOSER_TIPS[0]);
});

it("stays open when the pointer or focus leaves and dismisses on an outside click", () => {
  render();
  act(() => icon().focus());
  open();
  act(() => icon().dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  act(() => icon().blur());
  act(() => vi.advanceTimersByTime(150));
  expect(text()).toBe(COMPOSER_TIPS[0]);
  act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(vi.getTimerCount()).toBe(1);
});

it("keeps the open tip still for as long as the popover stays open", () => {
  render();
  open();
  const shown = text();
  for (let i = 0; i < 3; i++) advance();
  expect(text()).toBe(shown);
  act(() => icon().focus());
  advance();
  expect(text()).toBe(shown);
  expect(vi.getTimerCount()).toBe(0);
});

it("rotates only while closed, keeps inactive sessions still and clears timers", () => {
  render();
  const seen = new Set<string | null | undefined>();
  for (let i = 0; i < COMPOSER_TIPS.length; i++) {
    advance();
    open();
    seen.add(text());
    close();
  }
  expect(seen.size).toBe(COMPOSER_TIPS.length);
  render(false);
  expect(vi.getTimerCount()).toBe(0);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("advances manually by click and animates the complete new tip", () => {
  render();
  open();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  act(() => icon().click());
  expect(text()).toBe(COMPOSER_TIPS[1]);
  expect(document.querySelector("[data-tip-fold-animate]")).not.toBeNull();
  expect(document.querySelector("[data-tip-fold]")!.textContent!.replaceAll(" ", " ")).toBe(
    COMPOSER_TIPS[1],
  );
  act(() => icon().focus());
  advance();
  expect(text()).toBe(COMPOSER_TIPS[1]);
  act(() => icon().click());
  expect(text()).toBe(COMPOSER_TIPS[2]);
});

it("does not rotate while the document is hidden and resumes when visible again", () => {
  render();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(0);
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(1);
  advance();
  open();
  expect(text()).toBe(COMPOSER_TIPS[1]);
  close();
  expect(vi.getTimerCount()).toBe(1);
});

it("translates the help panel and manual action in every supported language", async () => {
  render();
  for (const { value } of LANGUAGES) {
    await act(async () => setLanguagePreference(value));
    for (let index = 0; index < COMPOSER_TIPS.length; index++) {
      open();
      expect(text()).toBeTruthy();
      if (value !== "en") expect(text()).not.toBe(COMPOSER_TIPS[index]);
      close();
      advance();
    }
  }
}, 20_000);
