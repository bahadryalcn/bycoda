import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";

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
