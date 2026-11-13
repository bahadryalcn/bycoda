import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { HostLimits } from "../limits";
import { WorkStorage } from "../work/storage";
import { refuseSingleSlotChild } from "./capacity";
import type { DelegationRecord } from "./store";

const stores: HostStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it.each(["absent", "waiting", "unknown", "retired"])(
  "refuses only an undispatched child of the exact live one-slot parent (%s)",
  async (scenario) => {
    const directory = mkdtempSync(join(tmpdir(), "delegation-capacity-"));
    directories.push(directory);
    const store = new HostStore(join(directory, "host.db"));
    stores.push(store);
    await new HostLimits(store).save({ maxRunningTasks: 1 });
    const storage = new WorkStorage(store, Date.now);
    const parent = await storage.submit({
      source: { kind: "task.worker", id: "task", occurrence: "one" },
      projectId: "p",
      rootWorkId: "task:task",
      payload: {},
    });
    await storage.save({
      ...parent,
      state: "running",
      reserved: true,
      dispatchStarted: true,
      receipt: { sessionId: "parent", runId: "turn" },
    });
    vi.spyOn(store, "session").mockResolvedValue({
      status: scenario === "retired" ? "idle" : "running",
      runId: "turn",
    } as never);
    const record = {
      runId: "child",
      kind: "advisor",
      parentSessionId: "parent",
      childSessionId: "",
      rootWorkId: "task:task",
      requestKey: "request",
    } as DelegationRecord;
    let child;
    if (scenario === "waiting" || scenario === "unknown") {
      child = await storage.submit({
        source: { kind: "delegation.advisor", id: "child", occurrence: "request" },
        projectId: "p",
        rootWorkId: "task:task",
        payload: {},
      });
      if (scenario === "unknown")
        await storage.save({ ...child, state: "unknown", reserved: true, dispatchStarted: true });
    }
    expect(await refuseSingleSlotChild(store, record)).toBe(
      scenario === "absent" || scenario === "waiting",
    );
    if (child)
      expect((await storage.get(child.id)).state).toBe(
        scenario === "waiting" ? "completed" : "unknown",
      );
  },
);
