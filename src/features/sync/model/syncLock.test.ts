import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRemoteLockRecords, captureLocalLockChanges } from "./syncLock";
import { markPulled, takeOutbox } from "./syncPeerState";
import {
  getGroupLockView,
  makeGroupLockable,
  setLockPassword,
} from "../../group-lock/model/groupLock";
import type { SyncRecord } from "./syncProtocol";

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

const MACHINE = "host-1";
const VALID_SALT = "A".repeat(12);
const VALID_HASH = "A".repeat(24);

describe("syncLock", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(7),
      subtle: {
        importKey: async () => "key",
        deriveBits: async () => new Uint8Array(32).fill(1),
      },
    });
    applyRemoteLockRecords(MACHINE, [
      { table: "lock", id: "lock", rev: 0, value: { record: null } },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the current password record for the peer", async () => {
    await setLockPassword("correct horse battery staple");
    captureLocalLockChanges(MACHINE);
    const op = takeOutbox(MACHINE).find((entry) => entry.table === "lock");
    expect(op?.value).toMatchObject({ record: { alg: "PBKDF2-SHA256" } });
  });

  it("applying a remote lock record with a password makes the app locked here too", () => {
    applyRemoteLockRecords(MACHINE, [
      {
        table: "lock",
        id: "lock",
        rev: 1,
        value: {
          record: {
            v: 1,
            alg: "PBKDF2-SHA256",
            iterations: 600_000,
            salt: VALID_SALT,
            hash: VALID_HASH,
          },
        },
      },
    ]);
    expect(getGroupLockView().hasPassword).toBe(true);
  });

  it("applying a remote lock record with no password clears it here too", async () => {
    await setLockPassword("correct horse battery staple");
    applyRemoteLockRecords(MACHINE, [
      { table: "lock", id: "lock", rev: 2, value: { record: null } },
    ]);
    expect(getGroupLockView().hasPassword).toBe(false);
  });

  it("ignores a malformed remote record and keeps the existing password", async () => {
    await setLockPassword("correct horse battery staple");
    applyRemoteLockRecords(MACHINE, [
      { table: "lock", id: "lock", rev: 3, value: { record: { v: 1, alg: "bogus" } } },
    ]);
    expect(getGroupLockView().hasPassword).toBe(true);
  });

  it("ignores a malformed remote record when no password is set", () => {
    applyRemoteLockRecords(MACHINE, [
      { table: "lock", id: "lock", rev: 3, value: { record: { v: 1, alg: "bogus" } } },
    ]);
    expect(getGroupLockView().hasPassword).toBe(false);
  });

  it.each([{}, [], { unrelated: true }, { record: undefined }])(
    "keeps the password when a lock payload lacks an explicit record: %j",
    async (value) => {
      await setLockPassword("correct horse battery staple");
      applyRemoteLockRecords(MACHINE, [{ table: "lock", id: "lock", rev: 3, value } as SyncRecord]);
      expect(getGroupLockView().hasPassword).toBe(true);
    },
  );

  it("ignores an unrelated lock id but accepts the canonical tombstone", async () => {
    await setLockPassword("correct horse battery staple");
    applyRemoteLockRecords(MACHINE, [{ table: "lock", id: "other", rev: 3, value: null }]);
    expect(getGroupLockView().hasPassword).toBe(true);
    applyRemoteLockRecords(MACHINE, [{ table: "lock", id: "lock", rev: 4, value: null }]);
    expect(getGroupLockView().hasPassword).toBe(false);
  });

  it("clearing the password resets the unlocked state", async () => {
    await setLockPassword("correct horse battery staple");
    const groupId = "g-1";
    localStorage.setItem(
      "bycoda.projectGroups",
      JSON.stringify([{ id: groupId, name: "G", lockable: true }]),
    );
    makeGroupLockable(groupId);
    applyRemoteLockRecords(MACHINE, [
      { table: "lock", id: "lock", rev: 4, value: { record: null } },
    ]);
    const view = getGroupLockView();
    expect(view.hasPassword).toBe(false);
    expect(view.lock.lockedGroupIds.size).toBe(0);
  });

  it("never pushes a null record for a machine with no known host lock", () => {
    captureLocalLockChanges(MACHINE);
    expect(takeOutbox(MACHINE).some((entry) => entry.table === "lock")).toBe(false);
  });

  it("pushes a null record as a deliberate removal after a lock was known", () => {
    markPulled(MACHINE, [
      {
        table: "lock",
        id: "lock",
        rev: 1,
        value: {
          record: {
            v: 1,
            alg: "PBKDF2-SHA256",
            iterations: 600_000,
            salt: VALID_SALT,
            hash: VALID_HASH,
          },
        },
      },
    ]);
    captureLocalLockChanges(MACHINE);
    expect(takeOutbox(MACHINE).find((entry) => entry.table === "lock")?.value).toEqual({
      record: null,
    });
  });
});
