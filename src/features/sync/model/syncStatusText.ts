import type { SyncStatus } from "./syncClient";

function clock(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export function describeSyncStatus(status: SyncStatus, _now: number): string {
  const pending = status.pendingOps > 0 ? ` · ${status.pendingOps} pending` : "";
  switch (status.state) {
    case "syncing":
      return `Sync: syncing…${pending}`;
    case "ok":
      return `Sync: up to date${status.lastSyncAt ? ` · ${clock(status.lastSyncAt)}` : ""}${pending}`;
    case "error":
      return `Sync failed: ${status.lastError || "unknown error"}${pending}`;
    case "unsupported":
      return "Sync unavailable: update the host on this machine";
    case "unlinked":
      return `Sync: not linked${status.lastError ? ` (${status.lastError})` : ""}`;
    default:
      return `Sync: not started yet${pending}`;
  }
}
