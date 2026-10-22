import { describe, expect, it } from "vitest";
import { describeSyncStatus } from "./syncStatusText";

describe("describeSyncStatus", () => {
  it("describes every state", () => {
    const at = new Date(2026, 9, 2, 12, 3, 41).getTime();
    expect(describeSyncStatus({ state: "idle", pendingOps: 0 }, at)).toBe("Sync: not started yet");
    expect(describeSyncStatus({ state: "syncing", pendingOps: 0 }, at)).toBe("Sync: syncing…");
    expect(describeSyncStatus({ state: "ok", lastSyncAt: at, pendingOps: 0 }, at)).toBe(
      "Sync: up to date · 12:03:41",
    );
    expect(describeSyncStatus({ state: "ok", lastSyncAt: at, pendingOps: 3 }, at)).toBe(
      "Sync: up to date · 12:03:41 · 3 pending",
    );
    expect(describeSyncStatus({ state: "error", lastError: "boom", pendingOps: 2 }, at)).toBe(
      "Sync failed: boom · 2 pending",
    );
    expect(describeSyncStatus({ state: "unsupported", pendingOps: 0 }, at)).toBe(
      "Sync unavailable: update the host on this machine",
    );
    expect(describeSyncStatus({ state: "unlinked", pendingOps: 0 }, at)).toBe("Sync: not linked");
  });
});
