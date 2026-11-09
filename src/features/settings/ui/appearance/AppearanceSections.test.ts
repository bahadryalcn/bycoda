// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppearancePage } from "../AppearanceSettings";
import { RevealedSetting } from "../settingsControls";
import type { AppearanceSettings } from "../useAppearanceSettings";

vi.mock("./sections/ThemeSection", () => ({
  ThemeSection: () => createElement("div", { id: "setting-theme" }, "Theme setting"),
}));
vi.mock("./sections/BackgroundSection", () => ({
  BackgroundSection: () =>
    createElement("div", { id: "setting-chat-background" }, "Background setting"),
}));
vi.mock("./sections/InterfaceSection", () => ({
  InterfaceSection: () =>
    createElement("div", { id: "setting-interface-scale" }, "Interface setting"),
}));
vi.mock("./sections/TypographySection", () => ({
  TypographySection: () => {
    const [value, setValue] = useState("initial");
    return createElement(
      "button",
      { id: "setting-terminal-font", onClick: () => setValue("edited") },
      value,
    );
  },
}));
vi.mock("./sections/MotionSection", () => ({
  MotionSection: () => createElement("div", { id: "setting-tab-animations" }, "Motion setting"),
}));

let container: HTMLDivElement;
let root: Root;
const appearance = {} as AppearanceSettings;
function render(revealed: string | null = null, revealRequest = 0) {
  act(() =>
    root.render(
      createElement(
        RevealedSetting.Provider,
        { value: revealed },
        createElement(AppearancePage, { appearance, revealRequest }),
      ),
    ),
  );
}
function tab(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (element) => element.textContent === name,
  )!;
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("renders five sections and keeps hidden controls mounted across tab switches", () => {
  render();
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(5);
  act(() => tab("Typography").click());
  const input = container.querySelector<HTMLButtonElement>("#setting-terminal-font")!;
  act(() => input.click());
  act(() => tab("Theme").click());
  expect(input.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(true);
  act(() => tab("Typography").click());
  expect(container.querySelector("#setting-terminal-font")).toBe(input);
  expect(input.textContent).toBe("edited");
});

it("switches to a search target in a hidden section", () => {
  render();
  act(() => tab("Theme").click());
  render("chat-background", 1);
  expect(tab("Background").getAttribute("aria-selected")).toBe("true");
  expect(
    container
      .querySelector("#setting-chat-background")
      ?.closest('[role="tabpanel"]')
      ?.hasAttribute("hidden"),
  ).toBe(false);
});
