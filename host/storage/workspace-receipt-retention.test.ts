import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { newRequestId } from "../../src/shared/lib/id/requestId";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const SCOPE = "workspace-policy:repository:environment";

/** Freezes Date only, so HostStore's async I/O keeps running on real timers. */
function withClock(run: (setNow: (time: number) => void) => Promise<void>) {
  return async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    try {
      await run((time) => vi.setSystemTime(time));
    } finally {
      vi.useRealTimers();
    }
  };
}

it("retains an unfenced workspace mutation receipt regardless of age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-receipt-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    await store.saveWorkspaceReceipt(
      "workspace-policy:repository:environment",
      "key",
      { revision: 1 },
      { revision: 2 },
    );
    await store.pruneReceipts(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(
      await store.workspaceReceipt("workspace-policy:repository:environment", "key", {
        revision: 1,
      }),
    ).toEqual({ revision: 2 });
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it(
  "keeps an unexpired compact workspace fence and it still blocks key reuse",
  withClock(async (setNow) => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-replay-horizon-"));
    const store = new HostStore(join(dir, "host.db"));
    try {
      const key = newRequestId();
      await store.saveWorkspaceReceipt(SCOPE, key, { revision: 1 }, { revision: 2 });
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 29 * DAY_MS);
      await store.pruneReceipts();
      expect(await store.workspaceReceipt(SCOPE, key, { revision: 1 }, { admit: true })).toEqual({
        revision: 2,
      });
      await expect(
        store.workspaceReceipt(SCOPE, key, { revision: 9 }, { admit: true }),
      ).rejects.toMatchObject({ code: "WORKSPACE_IDEMPOTENCY_CONFLICT" });
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }),
);

it(
  "deletes an expired v7 workspace fence and refuses its retry with REQUEST_EXPIRED",
  withClock(async (setNow) => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-replay-horizon-"));
    const store = new HostStore(join(dir, "host.db"));
    try {
      const key = newRequestId();
      await store.saveWorkspaceReceipt(SCOPE, key, { revision: 1 }, { revision: 2 });
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 33 * DAY_MS);
      await store.pruneReceipts();
      expect(
        await store.db
          .prepare("SELECT idempotency_key FROM compact_workspace_receipts WHERE idempotency_key=?")
          .get(key),
      ).toBeUndefined();
      await expect(
        store.workspaceReceipt(SCOPE, key, { revision: 1 }, { admit: true }),
      ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
      // Without admission the lookup stays a read and reports no receipt.
      expect(await store.workspaceReceipt(SCOPE, key, { revision: 1 })).toBeNull();
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }),
);

it(
  "keeps a legacy non-v7 workspace fence regardless of age",
  withClock(async (setNow) => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-replay-horizon-"));
    const store = new HostStore(join(dir, "host.db"));
    try {
      const key = randomUUID();
      await store.saveWorkspaceReceipt(SCOPE, key, { revision: 1 }, { revision: 2 });
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 400 * DAY_MS);
      await store.pruneReceipts();
      expect(await store.workspaceReceipt(SCOPE, key, { revision: 1 }, { admit: true })).toEqual({
        revision: 2,
      });
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }),
);
