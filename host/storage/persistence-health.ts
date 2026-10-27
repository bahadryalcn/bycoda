import type { HostPersistenceStatus as PersistenceHealth } from "../../src/shared/model/host-contracts/persistence";
export type { HostPersistenceStatus as PersistenceHealth } from "../../src/shared/model/host-contracts/persistence";

export class PersistenceAdmissionError extends Error {
  readonly code = "HOST_PERSISTENCE_UNAVAILABLE";
  constructor(readonly health: PersistenceHealth) {
    super("Host persistence is unavailable; reconcile storage before accepting new work.");
    this.name = "PersistenceAdmissionError";
  }
}

export function storageFailure(error: unknown): PersistenceHealth | undefined {
  const value = error as { errcode?: number; code?: string; message?: string };
  const base = typeof value?.errcode === "number" ? value.errcode & 255 : undefined;
  if (
    base === 5 ||
    base === 6 ||
    /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(value?.message ?? "")
  )
    return { state: "temporarily-blocked", reason: "busy" };
  if (base === 13 || /SQLITE_FULL|database or disk is full/i.test(value?.message ?? ""))
    return { state: "temporarily-blocked", reason: "full" };
  if (base === 10 || /SQLITE_IOERR|disk I\/O error/i.test(value?.message ?? ""))
    return { state: "recovery-required", reason: "io" };
  if (
    base === 11 ||
    base === 26 ||
    /SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed/i.test(value?.message ?? "")
  )
    return { state: "recovery-required", reason: "corrupt" };
  return undefined;
}
