import { describe, expect, it, vi } from "vitest";
import { boundedSet, createStore, createWindowStore } from "./store";

describe("createStore", () => {
  it("can retain an explicit server-rendering subscription guard", () => {
    const listener = vi.fn();
    const store = createWindowStore({ event: "test", storageKeys: ["key"], guardWindow: true });
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
  it("deduplicates listeners and removes them on unsubscribe", () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.subscribe(listener);
    expect(store.size).toBe(1);
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(store.size).toBe(0);
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("retains live Set iteration during subscriptions and removals", () => {
    const store = createStore<[string]>();
    const seen: string[] = [];
    const late = (value: string) => seen.push(`late:${value}`);
    let removeSecond = () => {};
    store.subscribe((value) => {
      seen.push(`first:${value}`);
      removeSecond();
      store.subscribe(late);
    });
    removeSecond = store.subscribe(() => seen.push("second"));
    store.notify("value");
    expect(seen).toEqual(["first:value", "late:value"]);
    store.clear();
    expect(store.size).toBe(0);
  });

  it("can retain snapshot iteration and isolated callback errors", () => {
    const onError = vi.fn();
    const store = createStore({ snapshot: true, onError });
    const later = vi.fn();
    const error = new Error("listener failed");
    store.subscribe(() => {
      store.subscribe(later);
      throw error;
    });
    const next = vi.fn();
    store.subscribe(next);
    store.notify();
    expect(onError).toHaveBeenCalledWith(error);
    expect(next).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
  });

  it("propagates errors and stops notification by default", () => {
    const store = createStore();
    const error = new Error("listener failed");
    store.subscribe(() => {
      throw error;
    });
    const later = vi.fn();
    store.subscribe(later);
    expect(() => store.notify()).toThrow(error);
    expect(later).not.toHaveBeenCalled();
  });
});

describe("boundedSet", () => {
  it("refreshes insertion order and evicts the oldest entries", () => {
    const cache = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    boundedSet(cache, "a", 3, 2);
    boundedSet(cache, "c", 4, 2);
    expect([...cache]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });
  it("retains the default 64-entry capacity and zero-capacity eviction", () => {
    const cache = new Map<number, number>();
    for (let key = 0; key < 65; key++) boundedSet(cache, key, key);
    expect(cache.size).toBe(64);
    expect(cache.has(0)).toBe(false);
    boundedSet(cache, 65, 65, 0);
    expect(cache.size).toBe(0);
  });
});
