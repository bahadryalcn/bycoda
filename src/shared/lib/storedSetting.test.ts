// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredSetting, storedFlag } from "./storedSetting";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createStoredSetting", () => {
  it("eksik ve bozuk değerlerde varsayılana döner", () => {
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
  it("önce yazar, aynı sekmede bildirir ve aboneliği temizler", () => {
    const setting = storedFlag("test", false, "setting:test");
    const values: unknown[] = [];
    const stop = setting.subscribe(() => values.push(setting.load()));
    setting.save(true);
    expect(values).toEqual([true]);
    stop();
    setting.save(false);
    expect(values).toEqual([true]);
  });
  it("diğer sekmede yalnız kendi anahtarını dinler", () => {
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
  it("kota hatasında mevcut kayıt korunur", () => {
    const setting = storedFlag("test", false);
    setting.save(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setting.save(false)).not.toThrow();
    expect(setting.load()).toBe(true);
  });
});
