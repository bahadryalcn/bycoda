import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../storage/atomic-write";
import { DelegationStore, MAX_DELEGATION_RECORDS, type DelegationRecord } from "./store";

vi.mock("../storage/atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/atomic-write")>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});
const write = vi.mocked(writeFileAtomic);

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

  it("creates a chat-only child's scratch folder once and removes it with its evicted record", async () => {
    const store = new DelegationStore(directory);
    const scratch = await store.scratchDir("run-1");
    writeFileSync(join(scratch, "note.txt"), "x");
    expect(await store.scratchDir("run-1")).toBe(scratch);
    expect(readdirSync(scratch)).toEqual(["note.txt"]);
    await store.add({ ...record(1), chatOnly: true });
    for (let index = 2; index <= MAX_DELEGATION_RECORDS + 1; index++)
      await store.add(record(index));
    expect(await store.find("run-1")).toBeUndefined();
    expect(existsSync(scratch)).toBe(false);
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

  it("skips the rewrite for a patch that repeats stored values or targets a missing run", async () => {
    const store = new DelegationStore(directory);
    await store.add(record(1));
    write.mockClear();
    await store.patch("run-1", { status: "succeeded", finishedAt: 2 });
    await store.patch("run-missing", { status: "failed" });
    expect(write).not.toHaveBeenCalled();
    await store.patch("run-1", { status: "failed" });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("writes queued changes once, and each change is durable when its promise settles", async () => {
    const store = new DelegationStore(directory);
    await store.add(record(1, false));
    write.mockClear();
    await Promise.all([
      store.add(record(2, false)),
      store.patch("run-1", { childRunId: "turn-2" }),
      store.patch("run-2", { childRunId: "turn-3" }),
    ]);
    expect(write).toHaveBeenCalledTimes(1);
    const onDisk = JSON.parse(readFileSync(join(directory, "delegation", "runs.json"), "utf8"));
    expect(onDisk).toMatchObject([
      { runId: "run-1", childRunId: "turn-2" },
      { runId: "run-2", childRunId: "turn-3" },
    ]);
  });

  it("rejects every change in a failed group and keeps it for the next successful write", async () => {
    const store = new DelegationStore(directory);
    await store.add(record(1, false));
    write.mockClear();
    write.mockRejectedValueOnce(new Error("disk full"));
    const settled = await Promise.allSettled([
      store.add(record(2, false)),
      store.patch("run-1", { childRunId: "turn-2" }),
    ]);
    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await store.patch("run-1", { ownerFollowUp: true });
    const onDisk = JSON.parse(readFileSync(join(directory, "delegation", "runs.json"), "utf8"));
    expect(onDisk).toMatchObject([
      { runId: "run-1", childRunId: "turn-2", ownerFollowUp: true },
      { runId: "run-2" },
    ]);
  });
});
