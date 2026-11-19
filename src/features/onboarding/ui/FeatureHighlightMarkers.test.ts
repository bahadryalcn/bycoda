// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeatureHighlightMarkers } from "./FeatureHighlightMarkers";

const pending = vi.hoisted(() => ({ items: [] as { id: string; target: string }[] }));

vi.mock("../model/useFeatureHighlights", () => ({
  usePendingHighlights: () => pending.items,
}));
vi.mock("../model/usageGuideTargets", () => ({
  findUsageGuideTarget: (names: readonly string[]) =>
    document.querySelector<HTMLElement>(`[data-usage-guide="${names[0]}"]`),
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: Root;
let container: HTMLDivElement;
let target: HTMLButtonElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  pending.items = [{ id: "new-session", target: "new-session" }];
  target = document.createElement("button");
  target.dataset.usageGuide = "new-session";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  target.remove();
  vi.restoreAllMocks();
});

it("reads no layout while a pending highlight waits and nothing changes", async () => {
  document.body.append(target);
  const rect = vi.spyOn(target, "getBoundingClientRect");
  await act(async () => root.render(createElement(FeatureHighlightMarkers)));
  await act(async () => wait(50));
  expect(rect).toHaveBeenCalled();

  rect.mockClear();
  await act(async () => wait(1500));
  expect(rect).not.toHaveBeenCalled();
});

it("measures a pending control that mounts after the marker", async () => {
  const rect = vi.spyOn(target, "getBoundingClientRect");
  await act(async () => root.render(createElement(FeatureHighlightMarkers)));
  await act(async () => wait(50));
  expect(rect).not.toHaveBeenCalled();

  await act(async () => document.body.append(target));
  await act(async () => wait(50));
  expect(rect).toHaveBeenCalled();
});
