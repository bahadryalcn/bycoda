// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsLoadingSurface } from "./SettingsLoadingSurface";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("announces one loading status for the destination", async () => {
  await act(async () =>
    root.render(createElement(SettingsLoadingSurface, { section: "appearance" })),
  );
  expect(node.querySelector("h2")).toBeNull();
  await act(async () => vi.advanceTimersByTime(500));
  const statuses = node.querySelectorAll('[role="status"]');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.getAttribute("aria-label")).toBe("Appearance");
});

it("shows one set of settings rows without manufactured progress", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  const card = node.querySelector("[data-settings-loading]")!;
  expect(card.querySelectorAll(".settings-skeleton-row")).toHaveLength(4);
  expect(node.querySelector('[role="progressbar"]')).toBeNull();
  expect(node.textContent).not.toMatch(/\d+\s?%/);
});

it("keeps a single loading state during a slow load and clears timers on unmount", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  expect(node.textContent).not.toContain("taking longer");
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(node.querySelectorAll('[role="status"]')).toHaveLength(1);
  await act(async () => root.render(createElement("div")));
  expect(vi.getTimerCount()).toBe(0);
});
