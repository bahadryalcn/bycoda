// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initAppearance, saveSidebarOpacity } from "../model/appearance";
import { applyUiScale, loadUiScale, saveUiScale, zoomInUiScale } from "../model/uiScale";
import { useAppearanceSettings, type AppearanceSettings } from "./useAppearanceSettings";

const mocks = vi.hoisted(() => ({
  zoom: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(undefined),
  background: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: mocks.zoom }) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => `asset:${path}`,
}));
vi.mock("../model/newThreadBackgroundEffects", () => ({
  applyPreparedNewThreadBackground: mocks.background,
  clearPreparedNewThreadBackground: mocks.clear,
}));
vi.mock("../../projects/model/chatBackground", () => ({
  pickAndSaveChatBackground: vi.fn(),
  removeChatBackground: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let states: AppearanceSettings[];
function Probe({ index }: { index: number }) {
  states[index] = useAppearanceSettings();
  return createElement("output", null, `${states[index].uiScale}/${states[index].opacity}`);
}
async function storage(key: string | null, value?: string) {
  await act(async () => {
    if (key === null) localStorage.clear();
    else if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
  });
}
beforeEach(async () => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  vi.clearAllMocks();
  mocks.zoom.mockResolvedValue(undefined);
  initAppearance();
  states = [];
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Probe, { index: 0 }),
        createElement(Probe, { index: 1 }),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("mounted shared appearance preferences", () => {
  it("applies sibling native scale, consecutive shortcuts, removal and reset without writing back", async () => {
    const writes = vi.spyOn(localStorage, "setItem");
    await storage("bycoda.uiScale", "1.5");
    expect(mocks.zoom).toHaveBeenLastCalledWith(1.5);
    expect(states.map((s) => s.uiScale)).toEqual([1.5, 1.5]);
    await act(async () => {
      await applyUiScale(saveUiScale(zoomInUiScale()));
      await applyUiScale(saveUiScale(zoomInUiScale()));
    });
    expect(mocks.zoom).toHaveBeenLastCalledWith(1.7);
    expect(states.map((s) => s.uiScale)).toEqual([1.7, 1.7]);
    await storage("bycoda.uiScale");
    expect(mocks.zoom).toHaveBeenLastCalledWith(1);
    await storage("bycoda.uiScale", "1.8");
    await storage(null);
    expect(loadUiScale()).toBe(1);
    expect(states[0].uiScale).toBe(1);
    expect(writes.mock.calls.filter(([key]) => key === "bycoda.uiScale")).toHaveLength(4);
    writes.mockRestore();
  });

  it("uses CSS zoom when native zoom is unavailable and ignores stale completion", async () => {
    mocks.zoom.mockRejectedValue(new Error("browser"));
    await storage("bycoda.uiScale", "1.4");
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.4");
    let rejectOld!: (error: Error) => void;
    mocks.zoom.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    const older = applyUiScale(1.2);
    await applyUiScale(1.6);
    rejectOld(new Error("old browser result"));
    await older;
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.6");
  });

  it("refreshes all mounted controls, CSS/native effects and resets while keeping layout local", async () => {
    await storage("bycoda.sidebarOpacity", "0.7");
    await storage("bycoda.mainOpacity", "0.8");
    await storage("bycoda.sidebarBlur", "31");
    await storage("bycoda.bodyGlass", "1");
    await storage("bycoda.chatBackgroundPath", "wallpaper.png");
    await storage("bycoda.chatBackgroundEmptyOpacity", "0.3");
    await storage("bycoda.chatBackgroundSessionOpacity", "0.4");
    await storage("bycoda.chatBackgroundScope", "empty");
    await storage("bycoda.chatBackgroundBlur", "8");
    await storage("bycoda.diffPalette", "colorblind");
    await storage("bycoda.newThreadBackgroundEffect", "ascii");
    await storage("bycoda.colorScheme", "light");
    expect(states[1]).toMatchObject({
      opacity: 0.7,
      mainOpacity: 0.8,
      blur: 31,
      bodyGlass: true,
      chatBackgroundPath: "wallpaper.png",
      chatBackgroundEmptyOpacity: 0.3,
      chatBackgroundSessionOpacity: 0.4,
      chatBackgroundScope: "empty",
      chatBackgroundBlur: 8,
      diffPalette: "colorblind",
      newThreadBackgroundEffect: "ascii",
      themePreference: "light",
    });
    expect(document.documentElement.style.getPropertyValue("--sidebar-opacity")).toBe("0.7");
    expect(document.documentElement.style.getPropertyValue("--main-opacity")).toBe("0.8");
    expect(document.documentElement.style.getPropertyValue("--chat-background-blur")).toBe("8px");
    expect(mocks.invoke).toHaveBeenCalledWith("set_window_background_blur", { radius: 31 });
    expect(mocks.background).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      "ascii",
      true,
    );
    await storage("bycoda.colorScheme", "dark");
    expect(mocks.background).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      "ascii",
      false,
    );
    await storage("bycoda.chatBackgroundPath");
    expect(states[0].chatBackgroundPath).toBeNull();
    expect(mocks.clear).toHaveBeenCalled();
    expect(document.documentElement.classList.contains("has-chat-background")).toBe(false);
    await act(async () => saveSidebarOpacity(0.6));
    expect(states.map((s) => s.opacity)).toEqual([0.6, 0.6]);
    const calls = mocks.invoke.mock.calls.length;
    await storage("bycoda.projectRailWidth", "90");
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    await storage(null);
    expect(states[1]).toMatchObject({
      opacity: 1,
      mainOpacity: 1,
      blur: 24,
      bodyGlass: false,
      chatBackgroundPath: null,
      diffPalette: "default",
      newThreadBackgroundEffect: "none",
    });
    expect(document.documentElement.classList.contains("diff-palette-colorblind")).toBe(false);
  });
});
