import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { newRequestId } from "../../src/shared/lib/id/requestId";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");

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

async function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "command-replay-horizon-"));
  return { directory, store: new HostStore(join(directory, "host.db")) };
}

const receiptFor = (commandId: string) => ({ commandId, sessionId: "session", revision: 1 });

it("compacts large request bytes while preserving exact results and fences through restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "command-compaction-"));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  const signature = "private request ".repeat(10_000);
  const receipt = {
    commandId: "original",
    sessionId: "session",
    revision: 4,
    runId: "original-run",
  };
  const scope = "workspace-policy:project:environment";
  const request = { revision: 1, content: signature };
  try {
    await store.recordReceipt(signature, receipt);
    await store.saveWorkspaceReceipt(scope, "key", request, { revision: 2 });
    await store.pruneReceipts(Date.now() + 365 * 86400000);
    expect(
      await store.db.prepare("SELECT id FROM receipts WHERE id=?").get("original"),
    ).toBeUndefined();
    expect(
      await store.db
        .prepare("SELECT signature_hash FROM compact_command_receipts WHERE id=?")
        .get("original"),
    ).toMatchObject({ signature_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await store.close();
    store = new HostStore(path);
    expect(await store.receipt("original", signature)).toEqual(receipt);
    expect(await store.receiptStatus("original")).toEqual(receipt);
    await expect(store.receipt("original", "other")).rejects.toThrow(/different payload/);
    expect(await store.workspaceReceipt(scope, "key", request)).toEqual({ revision: 2 });
    await expect(store.workspaceReceipt(scope, "key", { revision: 9 })).rejects.toMatchObject({
      code: "WORKSPACE_IDEMPOTENCY_CONFLICT",
    });
    await expect(store.recordReceipt(signature, receipt)).rejects.toThrow(/already used/);
    await expect(
      store.saveWorkspaceReceipt(scope, "key", request, { revision: 3 }),
    ).rejects.toThrow(/already used/);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it(
  "keeps an unexpired compact fence through compaction and it still blocks reuse",
  withClock(async (setNow) => {
    const { directory, store } = await openStore();
    try {
      const id = newRequestId();
      await store.recordReceipt("signature-a", receiptFor(id));
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 29 * DAY_MS);
      await store.pruneReceipts();
      expect(
        await store.db.prepare("SELECT issued_at FROM compact_command_receipts WHERE id=?").get(id),
      ).toMatchObject({ issued_at: T0 });
      expect(await store.receipt(id, "signature-a")).toEqual(receiptFor(id));
      await expect(store.receipt(id, "signature-b")).rejects.toThrow(/different payload/);
      await expect(store.recordReceipt("signature-a", receiptFor(id))).rejects.toThrow(
        /already used/,
      );
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

it(
  "deletes an expired v7 fence and refuses a retry of that id with REQUEST_EXPIRED",
  withClock(async (setNow) => {
    const { directory, store } = await openStore();
    try {
      const id = newRequestId();
      await store.recordReceipt("signature-a", receiptFor(id));
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 33 * DAY_MS);
      await store.pruneReceipts();
      expect(
        await store.db.prepare("SELECT id FROM compact_command_receipts WHERE id=?").get(id),
      ).toBeUndefined();
      await expect(store.receipt(id, "signature-a")).rejects.toMatchObject({
        code: "REQUEST_EXPIRED",
      });
      // Status is a read, not an admission: it reports no receipt instead of refusing.
      expect(await store.receiptStatus(id)).toBeUndefined();
      await expect(store.recordReceipt("signature-a", receiptFor(id))).resolves.toBeUndefined();
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

it(
  "refuses an expired v7 id that never had a receipt, and accepts a future-dated id",
  withClock(async (setNow) => {
    const { directory, store } = await openStore();
    try {
      const old = newRequestId();
      const future = newRequestId();
      setNow(T0 + 31 * DAY_MS);
      await expect(store.receipt(old, "signature-a")).rejects.toMatchObject({
        code: "REQUEST_EXPIRED",
      });
      setNow(T0);
      expect(await store.receipt(future, "signature-a")).toBeUndefined();
      setNow(T0 + 30 * DAY_MS);
      expect(await store.receipt(old, "signature-a")).toBeUndefined();
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

it(
  "keeps a legacy v4 fence regardless of age",
  withClock(async (setNow) => {
    const { directory, store } = await openStore();
    try {
      const id = randomUUID();
      await store.recordReceipt("signature-a", receiptFor(id));
      setNow(T0 + 8 * DAY_MS);
      await store.pruneReceipts();
      setNow(T0 + 400 * DAY_MS);
      await store.pruneReceipts();
      expect(
        await store.db.prepare("SELECT issued_at FROM compact_command_receipts WHERE id=?").get(id),
      ).toMatchObject({ issued_at: null });
      expect(await store.receipt(id, "signature-a")).toEqual(receiptFor(id));
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

it(
  "never deletes an uncompacted receipt by age: its id still replays after the horizon",
  withClock(async (setNow) => {
    const { directory, store } = await openStore();
    try {
      const id = newRequestId();
      await store.recordReceipt("signature-a", receiptFor(id));
      setNow(T0 + 40 * DAY_MS);
      expect(await store.receipt(id, "signature-a")).toEqual(receiptFor(id));
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);
