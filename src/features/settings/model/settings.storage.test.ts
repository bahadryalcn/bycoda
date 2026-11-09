// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  loadKeepAwakeEnabled,
  saveKeepAwakeEnabled,
  subscribeKeepAwakeEnabled,
  loadDiffLayout,
  saveDiffLayout,
  subscribeDiffLayout,
  DIFF_LAYOUT_CHANGE_EVENT,
} from "./settings";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("the cross-tab owner receives same-key and clear events but not sessionStorage events", () => {
  const callback = vi.fn();
  const unsubscribe = subscribeKeepAwakeEnabled(callback);
  try {
    saveKeepAwakeEnabled(true);
    expect(loadKeepAwakeEnabled()).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bycoda.keepAwakeWhileAgentsWork",
        storageArea: sessionStorage,
      }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bycoda.keepAwakeWhileAgentsWork",
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(callback).toHaveBeenCalledTimes(3);
  } finally {
    unsubscribe();
  }
  window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  expect(callback).toHaveBeenCalledTimes(3);
});
it("keeps enum normalization and the event detail/load split after a failed save", () => {
  saveDiffLayout("split");
  const callback = vi.fn();
  const unsubscribe = subscribeDiffLayout(callback);
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent).detail);
  window.addEventListener(DIFF_LAYOUT_CHANGE_EVENT, listener);
  try {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveDiffLayout("invalid" as "inline");
    expect(details).toEqual(["auto"]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(loadDiffLayout()).toBe("split");
  } finally {
    unsubscribe();
    window.removeEventListener(DIFF_LAYOUT_CHANGE_EVENT, listener);
  }
});
