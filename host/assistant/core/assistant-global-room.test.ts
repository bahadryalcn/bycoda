import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";

it("creates one canonical projectless Room when enabled and retains it across Host restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-global-room-"));
  let store = new HostStore(join(dir, "host.db"));
  let assistant = new HostAssistant(store);
  try {
    await assistant.ready;
    const before = await assistant.request({ op: "snapshot" }, "owner");
    expect(before.snapshot!.threads).toHaveLength(0);
    await assistant.request(
      {
        op: "profile.update",
        expectedVersion: before.snapshot!.profile.version,
        patch: { enabled: true, setupComplete: true, name: "Assistant", dailyTokenBudget: 20000 },
      },
      "owner",
    );
    const after = await assistant.request({ op: "snapshot" }, "owner");
    expect(after.snapshot!.threads).toHaveLength(1);
    const id = after.snapshot!.threads[0].id;
    expect(after.snapshot!.threads[0].projectId).toBeUndefined();
    expect((await assistant.request({ op: "threads.open" }, "owner")).thread!.id).toBe(id);
    await assistant.close();
    await store.close();
    store = new HostStore(join(dir, "host.db"));
    assistant = new HostAssistant(store);
    await assistant.ready;
    expect((await assistant.request({ op: "threads.open" }, "owner")).thread!.id).toBe(id);
    expect((await assistant.request({ op: "snapshot" }, "owner")).snapshot!.threads).toHaveLength(
      1,
    );
  } finally {
    await assistant.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
