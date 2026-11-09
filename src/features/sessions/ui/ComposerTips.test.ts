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
const text = () => document.querySelector(".composer-tips-text")?.getAttribute("aria-label");
const advance = () => act(() => vi.advanceTimersByTime(COMPOSER_TIP_INTERVAL));

it("only opens by activation, updates its label and stays closed after Escape", () => {
  render();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(icon().getAttribute("aria-label")).toBe("Tip");
  expect(icon().getAttribute("aria-expanded")).toBe("false");
  expect(icon().hasAttribute("aria-describedby")).toBe(false);
  act(() => icon().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  act(() => icon().focus());
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  open();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  expect(icon().textContent).toBe("Next tip");
  expect(icon().getAttribute("aria-label")).toBe("Next tip");
  expect(icon().getAttribute("aria-expanded")).toBe("true");
  expect(icon().getAttribute("aria-describedby")).toBe(
    document.querySelector('[role="tooltip"]')!.id,
  );
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(icon().getAttribute("aria-expanded")).toBe("false");
  expect(icon().hasAttribute("aria-describedby")).toBe(false);
  act(() => icon().blur());
  act(() => icon().focus());
  act(() => icon().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
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
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(icon().textContent).toBe("Tip");
  expect(vi.getTimerCount()).toBe(0);
});

it("cycles while visible, keeps inactive sessions still and clears timers", () => {
  render();
  open();
  const seen = new Set<string | null | undefined>();
  for (let i = 0; i < COMPOSER_TIPS.length; i++) {
    seen.add(text());
    advance();
  }
  expect(seen.size).toBe(COMPOSER_TIPS.length);
  expect(text()).toBe(COMPOSER_TIPS[0]);
  render(false);
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
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
  expect(document.querySelector("[data-tip-fold]")!.textContent!.replaceAll("\u00a0", " ")).toBe(
    COMPOSER_TIPS[1],
  );
  act(() => icon().focus());
  advance();
  expect(text()).toBe(COMPOSER_TIPS[1]);
  act(() => icon().click());
  expect(text()).toBe(COMPOSER_TIPS[2]);
});

it("pauses while the document is hidden and does no cycling after closing", () => {
  render();
  open();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  advance();
  expect(text()).toBe(COMPOSER_TIPS[1]);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(text()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("translates the tooltip and manual action in every supported language", async () => {
  render();
  open();
  for (const { value } of LANGUAGES) {
    await act(async () => setLanguagePreference(value));
    for (let index = 0; index < COMPOSER_TIPS.length; index++) {
      expect(text()).toBeTruthy();
      if (value !== "en") expect(text()).not.toBe(COMPOSER_TIPS[index]);
      advance();
    }
  }
}, 20_000);
