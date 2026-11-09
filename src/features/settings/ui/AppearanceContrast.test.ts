// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceContrast } from "./AppearanceContrast";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { acceptAppearanceStorageChange } from "../model/appearancePersistence";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: vi.fn() }) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("../model/newThreadBackgroundEffects", () => ({
  applyPreparedNewThreadBackground: vi.fn(),
  clearPreparedNewThreadBackground: vi.fn(),
}));
vi.mock("../../projects/model/chatBackground", () => ({
  pickAndSaveChatBackground: vi.fn(),
  removeChatBackground: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
function Probe() {
  const appearance = useAppearanceSettings();
  return createElement(
    "div",
    null,
    createElement(AppearanceContrast, { appearance }),
    createElement(
      "output",
      { "data-dirty": appearance.preferencesDirty },
      String(appearance.preferences.contrast),
    ),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
  acceptAppearanceStorageChange(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Appearance contrast", () => {
  it("commits contrast once on release and discards a cancelled drag", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const thumb = container.querySelector<HTMLElement>(
      '#setting-interface-contrast [role="slider"]',
    )!;
    expect(thumb).toBeTruthy();
    const writes = vi.spyOn(localStorage, "setItem");
    const key = "bycoda.appearancePreferences.v1";
    const events = vi.fn();
    window.addEventListener("bycoda.appearancePreferencesChanged", events);
    const pointer = async (type: string, clientX: number) =>
      act(async () => {
        thumb.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            clientX,
            bubbles: true,
          }),
        );
      });
    await pointer("pointerdown", 33);
    await pointer("pointermove", 65);
    await pointer("pointermove", 90);
    expect(writes.mock.calls.filter(([name]) => name === key)).toHaveLength(0);
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBeGreaterThan(100);
    await pointer("pointerup", 90);
    expect(writes.mock.calls.filter(([name]) => name === key)).toHaveLength(1);
    expect(events).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(localStorage.getItem(key)!).contrast;
    expect(saved).toBeGreaterThan(100);
    await pointer("pointerdown", 90);
    await pointer("pointermove", 20);
    await pointer("pointercancel", 20);
    expect(writes.mock.calls.filter(([name]) => name === key)).toHaveLength(1);
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBe(saved);
    await act(async () =>
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(writes.mock.calls.filter(([name]) => name === key)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(key)!).contrast).toBe(saved - 1);
    window.removeEventListener("bycoda.appearancePreferencesChanged", events);
  });

  it("keeps newer external contrast and merges independent edits during a drag", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const thumb = container.querySelector<HTMLElement>(
      '#setting-interface-contrast [role="slider"]',
    )!;
    const key = "bycoda.appearancePreferences.v1";
    const pointer = async (type: string, clientX: number) =>
      act(async () => {
        thumb.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            clientX,
            bubbles: true,
          }),
        );
      });
    await pointer("pointerdown", 33);
    await pointer("pointermove", 80);
    await act(async () => {
      localStorage.setItem(key, JSON.stringify({ contrast: 120, interfaceFont: "Verdana" }));
      window.dispatchEvent(new Event("bycoda.appearancePreferencesChanged"));
    });
    await pointer("pointerup", 80);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      contrast: 120,
      interfaceFont: "Verdana",
    });
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBe(120);
    await pointer("pointerdown", 60);
    await pointer("pointermove", 90);
    await act(async () => {
      localStorage.setItem(key, JSON.stringify({ contrast: 120, interfaceFont: "Arial" }));
      window.dispatchEvent(new Event("bycoda.appearancePreferencesChanged"));
    });
    await pointer("pointerup", 90);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ interfaceFont: "Arial" });
    expect(JSON.parse(localStorage.getItem(key)!).contrast).toBeGreaterThan(120);
  });

  it("does not let an active drag undo reset", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const thumb = container.querySelector<HTMLElement>('[role="slider"]')!;
    const pointer = async (type: string, clientX: number) =>
      act(async () =>
        thumb.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            clientX,
            bubbles: true,
          }),
        ),
      );
    await act(async () =>
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    await pointer("pointerdown", 33);
    await pointer("pointermove", 90);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Restore default"]')!.click(),
    );
    await pointer("pointerup", 90);
    expect(JSON.parse(localStorage.getItem("bycoda.appearancePreferences.v1")!).contrast).toBe(100);
    expect(thumb.getAttribute("aria-valuenow")).toBe("100");
  });
  it("retains failed contrast intent and saves a later correction", async () => {
    const thumb = container.querySelector<HTMLElement>('[role="slider"]')!;
    const original = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage full");
    });
    await act(async () =>
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(thumb.getAttribute("aria-valuenow")).toBe("101");
    expect(container.querySelector("output")?.dataset.dirty).toBe("true");
    expect(localStorage.getItem("bycoda.appearancePreferences.v1")).toBeNull();
    write.mockImplementation(original);
    await act(async () =>
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(JSON.parse(localStorage.getItem("bycoda.appearancePreferences.v1")!).contrast).toBe(102);
    expect(container.querySelector("output")?.dataset.dirty).toBe("false");
  });
});
