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

it("keeps the known section title visible and announces one loading status", async () => {
  await act(async () =>
    root.render(createElement(SettingsLoadingSurface, { section: "appearance" })),
  );
  expect(node.querySelector("h1")?.textContent).toBe("Appearance");
  await act(async () => vi.advanceTimersByTime(500));
  const statuses = node.querySelectorAll('[role="status"]');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.textContent).toBe("Loading Settings…");
});

it("shows settings rows inside the one centred card and no invented values", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  const card = node.querySelector("[data-loading-card]")!;
  expect(card.querySelectorAll(".settings-skeleton-row")).toHaveLength(4);
  expect(node.querySelector('[role="progressbar"]')).toBeNull();
  expect(node.textContent).not.toMatch(/\d+\s?%/);
});

it("explains a slow load inside the card and stops its timers when the dialog closes", async () => {
  await act(async () => root.render(createElement(SettingsLoadingSurface, { section: "general" })));
  expect(node.textContent).not.toContain("taking longer");
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(node.querySelector("[data-loading-card]")?.textContent).toContain(
    "Settings is taking longer to load. You can return to the workspace.",
  );
  await act(async () => root.render(createElement("div")));
  expect(vi.getTimerCount()).toBe(0);
});
