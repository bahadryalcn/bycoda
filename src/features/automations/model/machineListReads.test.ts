import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../connections/model/protocol";
import { MACHINE_LIST_READ_TIMEOUT_MS, sharedMachineListReads } from "./machineListReads";

const machine: RemoteMachine = {
  id: "machine-a",
  name: "A",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-a",
  ssh: { target: "me@a", remotePort: 3774 },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("shares one request between concurrent readers of the same connection", async () => {
  const reads = sharedMachineListReads<string>();
  const load = vi.fn(async () => ["row"]);
  const [first, second] = await Promise.all([
    reads.read(machine, load),
    reads.read(machine, load),
  ]);
  expect(load).toHaveBeenCalledOnce();
  expect(first).toBe(second);
});

it("never serves a reader that tolerates no age from an earlier answer", async () => {
  const reads = sharedMachineListReads<string>();
  const load = vi.fn(async () => ["row"]);
  await reads.read(machine, load);
  await reads.read(machine, load);
  expect(load).toHaveBeenCalledTimes(2);
});

it("lets a tolerant reader reuse a recent answer until it is too old", async () => {
  const reads = sharedMachineListReads<string>();
  const load = vi.fn(async () => ["row"]);
  await reads.read(machine, load);
  await reads.read(machine, load, 10_000);
  expect(load).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(10_001);
  await reads.read(machine, load, 10_000);
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps a changed connection apart from the Host it replaced", async () => {
  const reads = sharedMachineListReads<string>();
  const load = vi.fn(async (entry: RemoteMachine) => [entry.endpoint]);
  await reads.read(machine, load, 10_000);
  const moved = { ...machine, endpoint: "http://127.0.0.1:42000" };
  expect(await reads.read(moved, load, 10_000)).toEqual([moved.endpoint]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("starts a new read after a write and does not keep the one it overtook", async () => {
  const reads = sharedMachineListReads<string>();
  let releaseOld!: (rows: string[]) => void;
  const old = reads.read(
    machine,
    () =>
      new Promise<string[]>((resolve) => {
        releaseOld = resolve;
      }),
    10_000,
  );
  reads.invalidate(machine.id);
  const load = vi.fn(async () => ["after"]);
  expect(await reads.read(machine, load, 10_000)).toEqual(["after"]);
  releaseOld(["before"]);
  expect(await old).toEqual(["before"]);
  // The overtaken answer did not replace the newer one.
  expect(await reads.read(machine, load, 10_000)).toEqual(["after"]);
  expect(load).toHaveBeenCalledOnce();
});

it("drops a write's machine only, and forgets answers from before it", async () => {
  const reads = sharedMachineListReads<string>();
  const other = { ...machine, id: "machine-b" };
  await reads.read(machine, async () => ["a"], 10_000);
  await reads.read(other, async () => ["b"], 10_000);
  reads.invalidate(machine.id);
  const load = vi.fn(async () => ["a2"]);
  expect(await reads.read(machine, load, 10_000)).toEqual(["a2"]);
  expect(await reads.read(other, load, 10_000)).toEqual(["b"]);
  expect(load).toHaveBeenCalledOnce();
});

it("evicts a read that never answers instead of making later readers join it", async () => {
  const reads = sharedMachineListReads<string>();
  const hung = reads.read(machine, () => new Promise<string[]>(() => {}));
  const failure = expect(hung).rejects.toThrow("Machine list timed out");
  await vi.advanceTimersByTimeAsync(MACHINE_LIST_READ_TIMEOUT_MS + 1);
  await failure;
  const load = vi.fn(async () => ["row"]);
  expect(await reads.read(machine, load)).toEqual(["row"]);
  expect(load).toHaveBeenCalledOnce();
});

it("does not keep a failed read", async () => {
  const reads = sharedMachineListReads<string>();
  await expect(
    reads.read(machine, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  const load = vi.fn(async () => ["row"]);
  expect(await reads.read(machine, load, 10_000)).toEqual(["row"]);
});
