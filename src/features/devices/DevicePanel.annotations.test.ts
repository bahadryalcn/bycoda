// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePanel } from "./DevicePanel";
import type { DeviceHostStatus, DevicePanelApi } from "./types";

const status: DeviceHostStatus = {
  running: true,
  installed: true,
  agentInstalled: true,
  platform: "win32",
  platforms: [{ platform: "android", available: true }],
};
const device = {
  id: "emulator",
  name: "Android emulator",
  platform: "android" as const,
  version: "16",
  booted: true,
  physical: false,
};
const makeApi = (): DevicePanelApi => ({
  status: vi.fn().mockResolvedValue(status),
  setup: vi.fn().mockResolvedValue(status),
  start: vi.fn().mockResolvedValue(status),
  stop: vi.fn().mockResolvedValue({ ...status, running: false }),
  list: vi.fn().mockResolvedValue({ devices: [device], errors: [] }),
  boot: vi.fn().mockResolvedValue(device),
  capture: vi.fn().mockResolvedValue({ mime: "image/png", base64: "frame", capturedAt: "now" }),
  action: vi.fn().mockResolvedValue("Done"),
});

let root: Root;
let container: HTMLDivElement;
let scope: string;
// Writes the panel makes to the module-level annotation draft cache, observed
// through the Map it owns (keyed by the unique draft scope).
let cacheSets: Array<Record<string, { document: { marks: unknown[] }; comment: string }>>;
let cacheDeletes: number;
let restoreMap: () => void;

const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === text,
  )!;
const clickButton = async (name: string) => act(async () => button(name).click());
const pins = () => container.querySelectorAll(".image-annotation-canvas-pin text").length;

const renderPanelWith = (api: DevicePanelApi, draftScope: string | undefined) =>
  act(async () =>
    root.render(createElement(StrictMode, null, createElement(DevicePanel, { api, draftScope }))),
  );
const renderPanel = () => renderPanelWith(makeApi(), scope);

async function addPin() {
  await clickButton("Add numbered pin");
  await act(async () =>
    container
      .querySelector<SVGSVGElement>(".image-annotation-canvas-layer")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}

async function remount(draftScope: string = scope) {
  await act(async () => root.render(null));
  await renderPanelWith(makeApi(), draftScope);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scope = `annotation-strict-${crypto.randomUUID()}`;
  cacheSets = [];
  cacheDeletes = 0;
  const originalSet = Map.prototype.set;
  const originalDelete = Map.prototype.delete;
  Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (key === scope) cacheSets.push(value as (typeof cacheSets)[number]);
    return originalSet.call(this, key, value);
  };
  Map.prototype.delete = function (this: Map<unknown, unknown>, key: unknown) {
    if (key === scope) cacheDeletes += 1;
    return originalDelete.call(this, key);
  };
  restoreMap = () => {
    Map.prototype.set = originalSet;
    Map.prototype.delete = originalDelete;
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restoreMap();
  vi.unstubAllGlobals();
});

it("does not touch the draft cache on mount, strict effect replay, or remount", async () => {
  await renderPanel();
  await remount();
  expect(cacheSets).toHaveLength(0);
  expect(cacheDeletes).toBe(0);
});

it("retains the draft once per user action with the value that is rendered", async () => {
  await renderPanel();
  await clickButton("Mark device screen");
  expect(cacheSets).toHaveLength(1);
  expect(cacheDeletes).toBe(1);
  expect(cacheSets[0].emulator.document.marks).toHaveLength(0);
  expect(pins()).toBe(0);

  await addPin();
  expect(pins()).toBe(1);
  expect(cacheSets).toHaveLength(2);
  expect(cacheDeletes).toBe(2);
  expect(cacheSets[1].emulator.document.marks).toHaveLength(1);

  await clickButton("Undo annotation");
  expect(pins()).toBe(0);
  expect(cacheSets).toHaveLength(3);
  expect(cacheSets[2].emulator.document.marks).toHaveLength(0);

  await clickButton("Redo annotation");
  expect(pins()).toBe(1);
  expect(cacheSets).toHaveLength(4);
  expect(cacheSets[3].emulator.document.marks).toHaveLength(1);
});

it("restores the retained annotation after a StrictMode remount with the same scope", async () => {
  await renderPanel();
  await clickButton("Mark device screen");
  await addPin();
  const writes = cacheSets.length;

  await remount();
  expect(cacheSets).toHaveLength(writes);
  await clickButton("Mark device screen");
  expect(pins()).toBe(1);
  expect(button("Undo annotation").disabled).toBe(false);
  // Re-entering marking is one user action: one idempotent write of the same draft.
  expect(cacheSets).toHaveLength(writes + 1);
  expect(cacheSets[writes].emulator.document.marks).toHaveLength(1);
});

it("keeps drafts of different scopes apart", async () => {
  await renderPanel();
  await clickButton("Mark device screen");
  await addPin();
  await remount(`${scope}-other`);
  await clickButton("Mark device screen");
  expect(pins()).toBe(0);
  expect(button("Undo annotation").disabled).toBe(true);
});

it("clears the cache entry once when the draft is discarded and stays cleared after remount", async () => {
  await renderPanel();
  await clickButton("Mark device screen");
  await addPin();
  await clickButton("Annotation note");
  const setsBefore = cacheSets.length;
  const deletesBefore = cacheDeletes;

  await clickButton("Discard annotation");
  expect(cacheDeletes).toBe(deletesBefore + 1);
  expect(cacheSets).toHaveLength(setsBefore);
  expect(container.querySelector(".image-annotation-canvas-layer")).toBeNull();

  await remount();
  await clickButton("Mark device screen");
  expect(pins()).toBe(0);
  expect(button("Undo annotation").disabled).toBe(true);
});

it("without a draft scope it never writes the shared cache", async () => {
  await renderPanelWith(makeApi(), undefined);
  await clickButton("Mark device screen");
  await addPin();
  expect(pins()).toBe(1);
  expect(cacheSets).toHaveLength(0);
  expect(cacheDeletes).toBe(0);
});
