import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DelegationStore, MAX_DELEGATION_RECORDS, type DelegationRecord } from "./store";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "delegation-store-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const record = (index: number, finished = true): DelegationRecord => ({
  runId: `run-${index}`,
  kind: "subagent",
  parentSessionId: "parent",
  childSessionId: `child-${index}`,
  model: { harness: "codex", model: "codex:gpt-6.1" },
  title: `Task ${index}`,
  requestKey: `agents:parent:req-${index}`,
  payloadHash: `hash-${index}`,
  startedAt: index,
  ...(finished ? { finishedAt: index + 1, status: "succeeded" as const } : {}),
});

describe("DelegationStore", () => {
  it("keeps at most the record cap by dropping the oldest finished rows first", async () => {
    const store = new DelegationStore(directory);
    await store.add(record(0, false));
    for (let index = 1; index <= MAX_DELEGATION_RECORDS; index++) {
      await store.add(record(index));
    }
    const rows = await store.list();
    expect(rows).toHaveLength(MAX_DELEGATION_RECORDS);
    // The running row is never evicted; the oldest finished row (run-1) goes first.
    expect(rows[0]).toMatchObject({ runId: "run-0" });
    expect(rows[0]!.finishedAt).toBeUndefined();
    expect(await store.find("run-1")).toBeUndefined();
    expect(await store.find(`run-${MAX_DELEGATION_RECORDS}`)).toBeDefined();
  });

  it("reads the same rows after a restart and resolves them by run and request key", async () => {
    const first = new DelegationStore(directory);
    await first.add(record(1));
    await first.patch("run-1", { childRunId: "turn-2", ownerFollowUp: true });

    const restarted = new DelegationStore(directory);
    expect(await restarted.find("run-1")).toMatchObject({
      childSessionId: "child-1",
      childRunId: "turn-2",
      ownerFollowUp: true,
    });
    expect(await restarted.findByRequestKey("agents:parent:req-1")).toMatchObject({
      runId: "run-1",
    });
    expect(await restarted.isChild("child-1")).toBe(true);
    expect(await restarted.isChild("parent")).toBe(false);
  });

  it("treats a corrupt state file as empty, keeps evidence, and does not throw", async () => {
    mkdirSync(join(directory, "delegation"), { recursive: true });
    const file = join(directory, "delegation", "runs.json");
    writeFileSync(file, "{ not json");

    const store = new DelegationStore(directory);
    expect(await store.list()).toEqual([]);
    expect(await store.find("run-1")).toBeUndefined();
    const evidence = readdirSync(join(directory, "delegation")).filter((name) =>
      name.startsWith("runs.json.corrupt-"),
    );
    expect(evidence).toHaveLength(1);
    expect(existsSync(file)).toBe(true);
  });

  it("treats a non-array state file as no rows", async () => {
    mkdirSync(join(directory, "delegation"), { recursive: true });
    writeFileSync(join(directory, "delegation", "runs.json"), JSON.stringify({ runs: 1 }));
    expect(await new DelegationStore(directory).list()).toEqual([]);
  });
});
