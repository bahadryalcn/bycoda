// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { GlassControl } from "./GlassControl";

const saved = vi.hoisted(() => ({ live: [] as string[] }));
vi.mock("../../../model/liveBackground", () => ({
  saveLiveBackground: (value: string) => saved.live.push(value),
}));
vi.mock("../../WindowGlassFeedback", () => ({ WindowGlassFeedback: () => null }));
vi.mock("../../../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../platform/tauri/platform")>()),
  IS_LINUX: false,
  IS_MAC: true,
}));

const appearance = {
  opacity: 0.7,
  mainOpacity: 0.5,
  blur: 8,
  bodyGlass: false,
  windowGlass: true,
  onOpacity: vi.fn(),
  onMainOpacity: vi.fn(),
  onBlur: vi.fn(),
  onBodyGlass: vi.fn(),
  onWindowGlass: vi.fn(),
} as unknown as AppearanceSettings;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saved.live.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: { light: boolean; covered: boolean }) {
  act(() => root.render(createElement(GlassControl, { appearance, ...props })));
}
function sliders() {
  return [...container.querySelectorAll<HTMLElement>('[role="slider"]')];
}

it("explains the cover and disables the controls while live covers the window", () => {
  render({ light: false, covered: true });
  expect(container.textContent).toContain(
    "Window glass is hidden while the live background is on.",
  );
  const turnOff = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Turn off Live",
  )!;
  act(() => turnOff.click());
  expect(saved.live).toEqual(["none"]);
  expect(sliders().length).toBeGreaterThan(0);
  for (const slider of sliders()) expect(slider.closest("[inert]")).not.toBeNull();
});

it("keeps the controls enabled when glass applies", () => {
  render({ light: false, covered: false });
  expect(container.textContent).not.toContain("Window glass is hidden");
  expect(container.textContent).not.toContain("Turn off Live");
  expect(sliders().length).toBeGreaterThan(0);
  for (const slider of sliders()) expect(slider.closest("[inert]")).toBeNull();
});

it("shows the light-mode reason instead of an empty panel", () => {
  render({ light: true, covered: false });
  expect(container.textContent).toContain("Window glass is unavailable in light mode.");
  expect(sliders().length).toBeGreaterThan(0);
});

it("names the platform limit under Blur radius off macOS instead of a bare disabled row", async () => {
  vi.resetModules();
  vi.doMock("../../../../../platform/tauri/platform", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../../platform/tauri/platform")>()),
    IS_LINUX: false,
    IS_MAC: false,
  }));
  try {
    const { GlassControl: Control } = await import("./GlassControl");
    act(() => root.render(createElement(Control, { appearance, light: false, covered: false })));
    const blur = container.querySelector("#setting-blur")!;
    expect(blur.textContent).toContain("Adjustable on macOS only.");
    expect(blur.hasAttribute("data-disabled")).toBe(true);
    expect(container.querySelector("#setting-sidebar-opacity")?.hasAttribute("data-disabled")).toBe(
      false,
    );
  } finally {
    vi.doUnmock("../../../../../platform/tauri/platform");
  }
});
