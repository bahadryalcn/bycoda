// @vitest-environment happy-dom
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadDiffLayoutPreference,
  saveDiffLayoutPreference,
  subscribeDiffLayoutPreference,
} from "./diffLayout";

beforeEach(() => vi.stubGlobal("localStorage", new Storage()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the persisted layout after a failed write and allows an explicit retry", () => {
  expect(saveDiffLayoutPreference("split")).toBe(true);
  const write = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("fixture quota");
  });
  expect(saveDiffLayoutPreference("inline")).toBe(false);
  expect(loadDiffLayoutPreference()).toBe("split");
  write.mockRestore();
  expect(saveDiffLayoutPreference("inline")).toBe(true);
  expect(loadDiffLayoutPreference()).toBe("inline");
});

it("does not mistake the Automatic fallback for a successful save when storage is unavailable", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("fixture storage unavailable");
  });
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("fixture storage unavailable");
  });
  expect(saveDiffLayoutPreference("auto")).toBe(false);
});

it("notifies same-window and sibling-window consumers without subscribing to unrelated preferences", () => {
  const changed = vi.fn();
  const stop = subscribeDiffLayoutPreference(changed);
  try {
    saveDiffLayoutPreference("split");
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(changed).toHaveBeenCalledTimes(1);
    localStorage.setItem("bycoda.diffLayout", "inline");
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.diffLayout" }));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(loadDiffLayoutPreference()).toBe("inline");
  } finally {
    stop();
  }
  window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.diffLayout" }));
  expect(changed).toHaveBeenCalledTimes(2);
});
