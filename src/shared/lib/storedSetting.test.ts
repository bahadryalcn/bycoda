// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredSetting, storedFlag } from "./storedSetting";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createStoredSetting", () => {
  it("falls back to the default for missing and corrupt values", () => {
    const setting = createStoredSetting({
      key: "test",
      fallback: 3,
      parse: JSON.parse,
      serialize: JSON.stringify,
    });
    expect(setting.load()).toBe(3);
    localStorage.setItem("test", "broken");
    expect(setting.load()).toBe(3);
  });
  it("writes first, notifies in the same tab and clears the subscription", () => {
    const setting = storedFlag("test", false, "setting:test");
    const values: unknown[] = [];
    const stop = setting.subscribe(() => values.push(setting.load()));
    setting.save(true);
    expect(values).toEqual([true]);
    stop();
    setting.save(false);
    expect(values).toEqual([true]);
  });
  it("listens only to its own key in other tabs", () => {
    const setting = createStoredSetting({
      key: "test",
      fallback: "",
      parse: String,
      serialize: String,
      storageEvents: true,
    });
    const listener = vi.fn();
    const stop = setting.subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "test" }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "test", storageArea: sessionStorage }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: "test" }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("keeps the existing record on a quota error", () => {
    const setting = storedFlag("test", false);
    setting.save(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setting.save(false)).not.toThrow();
    expect(setting.load()).toBe(true);
  });
  it("reports failed writes and does not broadcast the unsaved value", () => {
    const setting = storedFlag("test", false, "setting:test", true);
    setting.save(true);
    const listener = vi.fn();
    const stop = setting.subscribe(listener);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(setting.save(false)).toBe(false);
    expect(setting.save(false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(setting.load()).toBe(true);
    stop();
  });
  it("reports successful writes and broadcasts them", () => {
    const setting = storedFlag("test", false, "setting:test");
    const listener = vi.fn();
    const stop = setting.subscribe(listener);
    expect(setting.save(true)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
