// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createWindowStore } from "./store";

describe("window store subscriptions", () => {
  it("preserves local events, filtered storage, side-effect order and cleanup", () => {
    const seen: string[] = [];
    const store = createWindowStore({
      event: "store:test",
      storageKeys: ["setting"],
      onStorage: () => seen.push("storage"),
    });
    const unsubscribe = store.subscribe(() => seen.push("listener"));
    window.dispatchEvent(new Event("store:test"));
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "setting" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(seen).toEqual(["listener", "storage", "listener", "storage", "listener"]);
    unsubscribe();
    window.dispatchEvent(new Event("store:test"));
    window.dispatchEvent(new StorageEvent("storage", { key: "setting" }));
    expect(seen).toHaveLength(5);
  });

  it("retains native duplicate local listeners and per-subscription storage listeners", () => {
    const store = createWindowStore({
      event: "store:duplicate",
      acceptStorage: (event) => event.key === null || event.key.startsWith("prefix."),
    });
    const listener = vi.fn();
    const removeFirst = store.subscribe(listener);
    const removeSecond = store.subscribe(listener);
    window.dispatchEvent(new Event("store:duplicate"));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "prefix.key" }));
    expect(listener).toHaveBeenCalledTimes(3);
    removeFirst();
    window.dispatchEvent(new Event("store:duplicate"));
    expect(listener).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(4);
    removeSecond();
  });
});
