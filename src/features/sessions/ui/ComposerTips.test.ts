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
const text = () => container.querySelector("p")!.getAttribute("aria-label");
const advance = () => act(() => vi.advanceTimersByTime(COMPOSER_TIP_INTERVAL));

it("cycles through every tip without repeats and clears its timer on unmount", () => {
  render();
  const seen = new Set<string | null>();
  for (let i = 0; i < COMPOSER_TIPS.length; i++) {
    seen.add(text());
    advance();
  }
  expect(seen.size).toBe(COMPOSER_TIPS.length);
  expect(text()).toBe(COMPOSER_TIPS[0]);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the full tip accessible from its label and keeps inactive sessions still", () => {
  render();
  expect(container.querySelector(".composer-tips-label")!.textContent).toBe("Hint");
  expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Chat tips");
  expect(container.querySelector(".composer-tips-count")).toBeNull();
  render(false);
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  render(true);
  advance();
  expect(text()).toBe(COMPOSER_TIPS[1]);
});

it("opens the full tip, holds it while reading, and restores focus on Escape", () => {
  render();
  const button = container.querySelector("button")!;
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const dialog = document.querySelector('[role="dialog"][aria-label="Chat tips"]')!;
  expect(dialog.textContent).toBe(COMPOSER_TIPS[0]);
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
});

it("holds the text while hovered or hidden and resumes afterwards", () => {
  render();
  const area = container.querySelector("aside")!;
  act(() => area.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  act(() => area.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  advance();
  expect(text()).toBe(COMPOSER_TIPS[0]);
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  advance();
  expect(text()).toBe(COMPOSER_TIPS[1]);
});

it("updates the tip and label when the app language changes", async () => {
  render();
  await act(async () => setLanguagePreference("tr"));
  expect(text()).toBe(
    "Mesaj kutusuna @ yazıp proje dosyasını seçin; ajan hangi dosyayı okuyacağını doğrudan görsün.",
  );
  expect(container.querySelector(".composer-tips-label")!.textContent).toBe("İpucu");
});

it("remounts the typed text when the tip changes", () => {
  render();
  const previous = container.querySelector("p");
  advance();
  expect(container.querySelector("p")).not.toBe(previous);
});

it("types characters with a cursor and reveals the full tip when reading", () => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  render();
  const typed = () => container.querySelector("[data-tip-typed]")!.textContent;
  expect(typed()).toBe("");
  expect(text()).toBe(COMPOSER_TIPS[0]);
  expect(container.querySelector(".composer-tips-cursor")).not.toBeNull();
  act(() => vi.advanceTimersByTime(64));
  expect(typed()).toBe(COMPOSER_TIPS[0].slice(0, 2));
  act(() => container.querySelector("button")!.click());
  expect(typed()).toBe(COMPOSER_TIPS[0]);
  expect(container.querySelector(".composer-tips-cursor")).toBeNull();
});

it("shows complete text without typing timers for reduced motion", () => {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const result = matchMedia(query);
    Object.defineProperty(result, "matches", { value: false });
    return result;
  });
  render();
  expect(container.querySelector("[data-tip-typed]")!.textContent).toBe(COMPOSER_TIPS[0]);
  expect(container.querySelector(".composer-tips-cursor")).toBeNull();
  expect(vi.getTimerCount()).toBe(1);
});

it("translates every tip in every supported language", async () => {
  render();
  for (const { value } of LANGUAGES) {
    await act(async () => setLanguagePreference(value));
    for (let index = 0; index < COMPOSER_TIPS.length; index++) {
      expect(text()).toBeTruthy();
      if (value !== "en") expect(text()).not.toBe(COMPOSER_TIPS[index]);
      advance();
    }
  }
});
