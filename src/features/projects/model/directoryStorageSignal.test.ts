// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { directoryStorageGeneration } from "./directoryStorageSignal";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const generation = () => directoryStorageGeneration() as number;

describe("directory storage signal", () => {
  it("moves only for watched keys written in this window", () => {
    const start = generation();
    localStorage.setItem("bycoda.somethingElse", "1");
    localStorage.removeItem("bycoda.somethingElse");
    expect(generation()).toBe(start);
    localStorage.setItem("bycoda.sessionOrder", "{}");
    const afterSet = generation();
    expect(afterSet).toBeGreaterThan(start);
    localStorage.removeItem("bycoda:tab-group:logos");
    expect(generation()).toBeGreaterThan(afterSet);
  });

  it("moves when storage is cleared", () => {
    const start = generation();
    localStorage.clear();
    expect(generation()).toBeGreaterThan(start);
  });

  it("moves for watched keys and clears reported by another window", () => {
    const start = generation();
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.other" }));
    expect(generation()).toBe(start);
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.groupLock.settings" }));
    const afterKey = generation();
    expect(afterKey).toBeGreaterThan(start);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(generation()).toBeGreaterThan(afterKey);
  });

  it("reports untracked while another script replaces the writers", () => {
    expect(directoryStorageGeneration()).toBeDefined();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(directoryStorageGeneration()).toBeUndefined();
    vi.restoreAllMocks();
    expect(directoryStorageGeneration()).toBeDefined();
  });
});
