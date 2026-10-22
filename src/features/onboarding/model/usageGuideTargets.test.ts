// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findUsageGuideTarget } from "./usageGuideTargets";
let surface: HTMLDivElement;
beforeEach(() => {
  surface = document.createElement("div");
  document.body.append(surface);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 200, height: 40 },
  ] as unknown as DOMRectList);
});
afterEach(() => {
  surface.remove();
  vi.restoreAllMocks();
});
it("chooses the active visible composer and never a neighboring session's stop button", () => {
  surface.innerHTML = `<div data-usage-guide="composer"><button data-usage-guide="stop-button">other session</button></div><div data-usage-guide="composer" data-usage-guide-active="true"><div data-usage-guide="send-controls"></div></div>`;
  const composer = surface.querySelector<HTMLElement>('[data-usage-guide-active="true"]')!;
  expect(findUsageGuideTarget(["composer"])).toBe(composer);
  expect(findUsageGuideTarget(["stop-button", "send-controls", "composer"])).toBe(
    composer.querySelector('[data-usage-guide="send-controls"]'),
  );
});
it("uses composer fallback for absent or hidden queue controls", () => {
  surface.innerHTML = `<div hidden data-usage-guide="composer" data-usage-guide-active="true"></div><div data-usage-guide="composer"><button hidden data-usage-guide="queue-button"></button></div>`;
  const composer = surface.querySelector<HTMLElement>(
    '[data-usage-guide="composer"]:not([hidden])',
  )!;
  expect(findUsageGuideTarget(["queue-button", "queue", "composer"])).toBe(composer);
  expect(findUsageGuideTarget(["stop-button"])).toBeNull();
});
it("selects visible global navigation without requiring a project or chat", () => {
  surface.innerHTML = `<nav data-usage-guide="project-navigation"></nav><button hidden data-usage-guide="changes"></button><button data-usage-guide="changes"></button>`;
  expect(findUsageGuideTarget(["project-navigation"])).toBe(surface.querySelector("nav"));
  expect(findUsageGuideTarget(["changes"])).toBe(surface.lastElementChild);
  expect(findUsageGuideTarget(["composer"])).toBeNull();
});
