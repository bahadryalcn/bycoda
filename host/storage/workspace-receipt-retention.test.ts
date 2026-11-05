import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";

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
