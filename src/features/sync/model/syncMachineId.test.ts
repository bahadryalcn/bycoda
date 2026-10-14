import { beforeEach, describe, expect, it, vi } from "vitest";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

describe("localMachineId", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.resetModules();
  });

  it("returns the same id on repeated calls", async () => {
    const { localMachineId } = await import("./syncMachineId");
    expect(localMachineId()).toBe(localMachineId());
  });

  it("persists the id so a fresh module load would see the same one", async () => {
    const { localMachineId } = await import("./syncMachineId");
    const id = localMachineId();
    expect(localStorage.getItem("bycoda.sync.machineId")).toBe(id);
  });
});
