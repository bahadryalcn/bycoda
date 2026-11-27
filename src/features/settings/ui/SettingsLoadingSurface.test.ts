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

it("announces one loading status for the destination after the delay", async () => {
  await act(async () =>
    root.render(createElement(SettingsLoadingSurface, { section: "appearance" })),
  );
  // The dialog header owns the visible page identity; the placeholder shows shapes only.
  expect(node.querySelector("h2")).toBeNull();
  expect(node.textContent).not.toContain("Appearance");
  expect(node.querySelector('[role="status"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(500));
  const statuses = node.querySelectorAll('[role="status"]');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.getAttribute("aria-label")).toBe("Appearance");
});

it("mirrors the workbench with a category rail and framed topic rows, no invented values", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  const card = node.querySelector("[data-settings-loading]")!;
  const rail = card.querySelector(".settings-skeleton-rail")!;
  expect(rail.getAttribute("aria-hidden")).toBe("true");
  expect(rail.querySelectorAll('[data-shape="square"]').length).toBeGreaterThan(8);
  expect(
    card.querySelectorAll('.settings-skeleton-content [data-surface-separator="block"]'),
  ).toHaveLength(7);
  expect(node.querySelector('[role="progressbar"]')).toBeNull();
  expect(node.textContent).not.toMatch(/\d+\s?%/);
});

it("keeps a single loading state during a slow load and clears timers on unmount", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(node.querySelectorAll('[role="status"]')).toHaveLength(1);
  await act(async () => root.render(createElement("div")));
  expect(vi.getTimerCount()).toBe(0);
});
