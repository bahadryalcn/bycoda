import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../storage/atomic-write";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCommunication } from "./communication";
import { DelegationStore, type DelegationRecord } from "./store";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "agent-communication-"));
  directories.push(directory);
  const records = new DelegationStore(directory);
  for (const id of ["a", "b"])
    await records.add({
      runId: id,
      childSessionId: `child-${id}`,
      parentSessionId: "parent",
      kind: "subagent",
      model: { harness: "codex", model: "codex:fixture" },
      title: id,
      requestKey: id,
      payloadHash: id,
      startedAt: 1,
    });
  const deliver = vi.fn(async () => "started" as const);
  const inspect = vi.fn(async (_id: string) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: "idle",
  }));
  const result = vi.fn(async (_record: DelegationRecord) => ({
    status: "succeeded",
    result: "Answer",
  }));
  const create = () => new AgentCommunication({ directory, records, deliver, inspect, result });
  const communication = create();
  return { communication, create, records, deliver, inspect, result, directory };
}

it("lets a child discover and contact its sibling without parent relaying", async () => {
  const f = await fixture();
  const caller = { sessionId: "child-a", projectId: "p" };
  expect(await f.communication.list(caller)).toMatchObject({
    self: "a",
    agents: [{ runId: "parent" }, { runId: "a" }, { runId: "b" }],
  });
  expect(
    await f.communication.send(
      { requestId: "question", runId: "b", message: "Need schema" },
      caller,
    ),
  ).toMatchObject({ delivery: "started" });
  expect(f.deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      targetSessionId: "child-b",
      text: expect.stringContaining("Need schema"),
    }),
  );
});

it("deduplicates identical retry and refuses reuse with changed content", async () => {
  const f = await fixture();
  const args = { requestId: "once", runId: "b", message: "Schema?" };
  const caller = { sessionId: "child-a", projectId: "p" };
  const first = await f.communication.send(args, caller);
  expect(await f.create().send(args, caller)).toEqual(first);
  await expect(f.communication.send({ ...args, message: "Different" }, caller)).rejects.toThrow(
    "different payload",
  );
  expect(f.deliver).toHaveBeenCalledOnce();
});

it("separates earlier discussion groups within the same parent conversation", async () => {
  const f = await fixture();
  await f.records.patch("a", { groupId: "current-turn" });
  await f.records.patch("b", { groupId: "old-turn" });
  const caller = { sessionId: "child-a", projectId: "p" };
  const list = await f.communication.list(caller);
  expect(list.agents.map((agent) => agent.runId)).toEqual(["parent", "a"]);
  await expect(
    f.communication.send({ requestId: "old-peer", runId: "b", message: "Question" }, caller),
  ).rejects.toThrow("Recipient not found");
  expect(f.deliver).not.toHaveBeenCalled();
});

it("queues while busy and resumes after restart without asking the parent to relay", async () => {
  const f = await fixture();
  let busy = true;
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: id === "child-b" && busy ? "running" : "idle",
  }));
  const args = { requestId: "queue", runId: "b", message: "Result", mode: "queue" };
  expect(await f.communication.send(args, { sessionId: "child-a", projectId: "p" })).toMatchObject({
    delivery: "queued",
  });
  expect(f.deliver).not.toHaveBeenCalled();
  busy = false;
  await f.create().tick();
  expect(f.deliver).toHaveBeenCalledOnce();
});

it("retains unknown effects across restart instead of replaying", async () => {
  const f = await fixture();
  f.deliver.mockRejectedValueOnce(new Error("Disconnected after offering"));
  const args = { requestId: "unknown", runId: "b", message: "Question" };
  const caller = { sessionId: "child-a", projectId: "p" };
  expect(await f.communication.send(args, caller)).toMatchObject({ delivery: "unknown" });
  await f.create().tick();
  expect(await f.create().send(args, caller)).toMatchObject({ delivery: "unknown" });
  expect(f.deliver).toHaveBeenCalledOnce();
});

it("fences cross-group IDs, broader permissions and advisor sibling writes", async () => {
  const f = await fixture();
  const caller = { sessionId: "child-a", projectId: "p" };
  await expect(
    f.communication.send({ requestId: "x", runId: "alien", message: "Hello" }, caller),
  ).rejects.toThrow("Recipient not found");
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: id === "child-b" ? "full-access" : "supervised",
    status: "idle",
  }));
  await expect(
    f.communication.send({ requestId: "x", runId: "b", message: "Hello" }, caller),
  ).rejects.toThrow("broader or unknown execution");
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "idle" });
  await f.records.patch("a", { kind: "advisor" });
  await expect(
    f.communication.send({ requestId: "x", runId: "b", message: "Hello" }, caller),
  ).rejects.toThrow("parent only");
  expect(f.deliver).not.toHaveBeenCalled();
});

it("rechecks project and stop revocation before a queued effect", async () => {
  const f = await fixture();
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "running" });
  const args = { requestId: "stop", runId: "b", message: "Result", mode: "queue" };
  const caller = { sessionId: "child-a", projectId: "p" };
  await f.communication.send(args, caller);
  await f.records.patch("a", { communicationClosed: true });
  await f.create().tick();
  expect(f.deliver).not.toHaveBeenCalled();
  await expect(f.communication.list(caller)).rejects.toThrow("stopped");
});

it("notifies the parent once per opted-in child turn and does not wake on running results", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-one" });
  f.result.mockResolvedValueOnce({ status: "running", result: "" });
  await f.communication.tick();
  expect(f.deliver).not.toHaveBeenCalled();
  await f.communication.tick();
  await f.create().tick();
  expect(f.deliver).toHaveBeenCalledOnce();
  expect(f.deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      targetSessionId: "parent",
      mode: "queue",
      text: expect.stringContaining("Answer"),
    }),
  );
  await f.records.patch("a", { childRunId: "turn-two" });
  await f.create().tick();
  expect(f.deliver).toHaveBeenCalledTimes(2);
});

it("recovers a persisted dispatch as unknown instead of repeating an effect", async () => {
  const f = await fixture();
  await f.communication.send(
    { requestId: "crash", runId: "b", message: "Question" },
    { sessionId: "child-a", projectId: "p" },
  );
  const file = join(f.directory, "delegation", "messages.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));
  rows[0].state = "dispatching";
  await writeFileAtomic(file, JSON.stringify(rows));
  await f.create().tick();
  expect(JSON.parse(readFileSync(file, "utf8"))[0]).toMatchObject({
    state: "settled",
    delivery: "unknown",
  });
  expect(f.deliver).toHaveBeenCalledOnce();
});

it("rechecks recipient permissions after enqueue and retains a failed receipt", async () => {
  const f = await fixture();
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "running" });
  const args = { requestId: "policy", runId: "b", message: "Result", mode: "queue" };
  const caller = { sessionId: "child-a", projectId: "p" };
  await f.communication.send(args, caller);
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: id === "child-b" ? "full-access" : "supervised",
    status: "idle",
  }));
  await f.create().tick();
  expect(f.deliver).not.toHaveBeenCalled();
  // Read the durable receipt directly: an authority change must not erase evidence.
  const rows = JSON.parse(readFileSync(join(f.directory, "delegation", "messages.json"), "utf8"));
  expect(rows[0]).toMatchObject({ state: "settled", delivery: "failed" });
});

it("preserves corrupt outbox evidence and fails closed", async () => {
  const f = await fixture();
  const file = join(f.directory, "delegation", "messages.json");
  await writeFileAtomic(file, "corrupt");
  await expect(f.create().tick()).rejects.toThrow("unreadable");
  expect(readFileSync(file, "utf8")).toBe("corrupt");
});

it("drains from change events and unsubscribes cleanly without periodic polling", async () => {
  const f = await fixture();
  let wake = () => {};
  const unsubscribe = vi.fn();
  const resume = vi.fn(async () => {});
  f.communication.start((listener) => {
    wake = listener;
    return unsubscribe;
  }, resume);
  await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "running" });
  await f.communication.send(
    { requestId: "event", runId: "b", message: "Question", mode: "queue" },
    { sessionId: "child-a", projectId: "p" },
  );
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "idle" });
  wake();
  wake();
  wake();
  await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledOnce());
  await f.communication.close();
  expect(unsubscribe).toHaveBeenCalledOnce();
  wake();
  expect(f.deliver).toHaveBeenCalledOnce();
});
