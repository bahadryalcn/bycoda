import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../storage/atomic-write";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentCommunication,
  delegationReplyCommandId,
  type AgentDelivery,
  type AgentDeliveryOutcome,
} from "./communication";
import { DelegationStore, type DelegationRecord } from "./store";
import { DelegationMessagesSchema } from "../../src/shared/model/host-contracts/delegation";

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
  const deliver = vi.fn<(message: AgentDelivery) => Promise<AgentDeliveryOutcome>>(
    async () => "started",
  );
  const inspect = vi.fn(async (_id: string) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: "idle",
  }));
  const result = vi.fn(async (record: DelegationRecord) =>
    // Only the child that opted in to notices has finished; its siblings are still working.
    record.notifyOnCompletion
      ? { status: "succeeded", result: "Answer" }
      : { status: "running", result: "" },
  );
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

it("delivers a completion to a parent with broader permissions than its child", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-a" });
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: id === "parent" ? "full-access" : "supervised",
    status: "idle",
  }));
  await f.communication.tick();
  expect(f.deliver).toHaveBeenCalledOnce();
  // The peer gate still holds for messages the child writes itself.
  await expect(
    f.communication.send(
      { requestId: "peer", runId: "parent", message: "Question" },
      { sessionId: "child-a", projectId: "p" },
    ),
  ).rejects.toThrow("broader or unknown execution");
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

it("does not wake a finished sibling: only the parent restarts a finished child", async () => {
  const f = await fixture();
  f.result.mockResolvedValue({ status: "succeeded", result: "Done" });
  const caller = { sessionId: "child-a", projectId: "p" };
  const receipt = await f.communication.send(
    { requestId: "late", runId: "b", message: "One more thing" },
    caller,
  );
  expect(receipt).toMatchObject({ delivery: "failed", error: expect.stringContaining("finished") });
  expect(f.deliver).not.toHaveBeenCalled();
});

it("flags completion and peer messages to the parent as delegation notices", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-a" });
  await f.communication.tick();
  expect(f.deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      targetSessionId: "parent",
      notice: { kind: "delegation", runId: "a", title: "a", reason: "completion" },
    }),
  );
  await f.communication.send(
    { requestId: "peer", runId: "parent", message: "Question" },
    { sessionId: "child-b", projectId: "p" },
  );
  expect(f.deliver).toHaveBeenLastCalledWith(
    expect.objectContaining({
      notice: { kind: "delegation", runId: "b", title: "b", reason: "message" },
    }),
  );
});

it("leaves a completion undecided when its result cannot be read, and reports not-offered failures as failed", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-a" });
  f.result.mockRejectedValueOnce(new Error("database is locked"));
  await f.communication.tick();
  expect(f.deliver).not.toHaveBeenCalled();
  await f.communication.tick();
  expect(f.deliver).toHaveBeenCalledOnce();
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: id === "child-b" ? "idle" : "idle",
  }));
  f.result.mockResolvedValue({ status: "running", result: "" });
  f.deliver.mockRejectedValueOnce(
    Object.assign(new Error("The conversation changed."), { notOffered: true }),
  );
  expect(
    await f.communication.send(
      { requestId: "conflict", runId: "b", message: "Hello" },
      { sessionId: "child-a", projectId: "p" },
    ),
  ).toMatchObject({ delivery: "failed" });
});

it("heads an advisor's completion as the advisor's, not a subagent's", async () => {
  const f = await fixture();
  await f.records.patch("a", { kind: "advisor", notifyOnCompletion: true, childRunId: "turn-a" });
  await f.communication.tick();
  expect(f.deliver).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringMatching(/^Advisor completion: a \(a\)/) }),
  );
});

it("notifies a finished turn before a queued continuation advances the child", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-one" });
  // The child is finished on turn-one; a continuation moves it to turn-two (running).
  f.result.mockImplementation(async (record: DelegationRecord) =>
    record.childRunId === "turn-one"
      ? { status: "succeeded", result: "First answer" }
      : { status: "running", result: "" },
  );
  f.deliver.mockImplementation(async (message) => {
    if (message.target) await f.records.patch(message.target.runId, { childRunId: "turn-two" });
    return "started" as const;
  });
  await f.communication.send(
    { requestId: "next", runId: "a", message: "Second task", mode: "queue" },
    { sessionId: "parent", projectId: "p" },
  );
  await f.communication.tick();
  const targets = f.deliver.mock.calls.map(([message]) => message.targetSessionId);
  expect(targets).toEqual(["parent", "child-a"]);
  expect(f.deliver.mock.calls[0]![0].text).toContain("First answer");
});

it("discovers completion before draining queued continuations on a change event", async () => {
  const f = await fixture();
  await f.records.patch("a", { notifyOnCompletion: true, childRunId: "turn-one" });
  let busy = true;
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: id === "child-a" && busy ? "running" : "idle",
  }));
  f.result.mockImplementation(async (record: DelegationRecord) =>
    !busy && record.childRunId === "turn-one"
      ? { status: "succeeded", result: "First answer" }
      : { status: "running", result: "" },
  );
  f.deliver.mockImplementation(async (message) => {
    if (message.target) await f.records.patch(message.target.runId, { childRunId: "turn-two" });
    return "started" as const;
  });
  await f.communication.send(
    { requestId: "later", runId: "a", message: "Second task", mode: "queue" },
    { sessionId: "parent", projectId: "p" },
  );
  expect(f.deliver).not.toHaveBeenCalled();
  busy = false;
  await f.communication.tick();
  expect(f.deliver.mock.calls.map(([message]) => message.targetSessionId)).toEqual([
    "parent",
    "child-a",
  ]);
});

it("keeps queued messages to one recipient in order behind an earlier waiting one", async () => {
  const f = await fixture();
  f.deliver.mockResolvedValueOnce("waiting");
  const caller = { sessionId: "parent", projectId: "p" };
  await f.communication.send(
    { requestId: "q1", runId: "b", message: "One", mode: "queue" },
    caller,
  );
  expect(
    await f.communication.send(
      { requestId: "q2", runId: "b", message: "Two", mode: "queue" },
      caller,
    ),
  ).toMatchObject({ delivery: "queued" });
  expect(f.deliver).toHaveBeenCalledOnce();
  await f.communication.tick();
  const texts = f.deliver.mock.calls.map(([message]) => message.text);
  expect(texts.findIndex((text) => text.endsWith("One"))).toBeLessThan(
    texts.findIndex((text) => text.endsWith("Two")),
  );
});

it("streams child messages as contract rows with engine hand-off and stable block identity", async () => {
  const f = await fixture();
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "running" });
  f.deliver.mockResolvedValue("steered");
  const changed: string[] = [];
  const unsubscribe = f.communication.subscribeMessageChanges((id) => changed.push(id));
  const parent = { sessionId: "parent", projectId: "p" };
  const steer = await f.communication.send(
    { requestId: "s1", runId: "b", message: "Steer now", mode: "steer" },
    parent,
  );
  await f.communication.send(
    { requestId: "q1", runId: "b", message: "Later", mode: "queue" },
    { sessionId: "child-a", projectId: "p" },
  );
  const rows = await f.communication.messagesForSession("child-b", "p");
  expect(DelegationMessagesSchema.parse(rows)).toEqual(rows);
  expect(rows).toEqual([
    {
      id: steer.messageId,
      blockId: `agent_message_${steer.messageId}`,
      text: "Steer now",
      sender: "parent",
      mode: "steer",
      effectiveMode: "steer",
      // Engine hand-off only; provider acceptance comes from the block's followUpDelivery.
      delivery: "submitted",
      createdAt: expect.any(Number),
    },
    {
      id: expect.any(String),
      text: "Later",
      sender: "a",
      mode: "queue",
      delivery: "queued",
      createdAt: expect.any(Number),
    },
  ]);
  // Announced only after the durable write, only for the child target.
  expect(new Set(changed)).toEqual(new Set(["child-b"]));
  changed.length = 0;
  await f.communication.send(
    { requestId: "up", runId: "parent", message: "Report" },
    { sessionId: "child-b", projectId: "p" },
  );
  expect(changed).toEqual([]);
  expect(await f.communication.messagesForSession("parent", "p")).toEqual([]);
  expect(await f.communication.messagesForSession("child-a", "p")).toEqual([]);
  f.inspect.mockResolvedValue({ projectId: "other", runtimeMode: "supervised", status: "running" });
  await expect(f.communication.messagesForSession("child-b", "p")).rejects.toThrow(
    "another project",
  );
  unsubscribe();
});

it("prefers the reported continuation block and falls back to the ordinary send identity", async () => {
  const f = await fixture();
  f.deliver
    .mockResolvedValueOnce({ delivery: "started", blockId: "agents_hash:send" })
    // A Work-admitted start reports no block. The ordinary send candidate does not match its Work block.
    .mockResolvedValueOnce("started");
  const parent = { sessionId: "parent", projectId: "p" };
  await f.communication.send(
    { requestId: "c1", runId: "b", message: "One", mode: "queue" },
    parent,
  );
  await f.communication.send(
    { requestId: "c2", runId: "a", message: "Two", mode: "queue" },
    parent,
  );
  expect(await f.communication.messagesForSession("child-b", "p")).toEqual([
    expect.objectContaining({
      blockId: "agents_hash:send",
      effectiveMode: "queue",
      delivery: "submitted",
    }),
  ]);
  const [work] = await f.communication.messagesForSession("child-a", "p");
  expect(work).toMatchObject({ text: "Two", delivery: "submitted" });
  expect(work).not.toHaveProperty("blockId");
});

it("exposes only Host-authored delivery reasons", async () => {
  const f = await fixture();
  f.deliver.mockRejectedValueOnce(new Error("spawn C:\\Users\\someone\\secret failed"));
  await f.communication.send(
    { requestId: "e1", runId: "b", message: "Hi" },
    { sessionId: "parent", projectId: "p" },
  );
  const [row] = await f.communication.messagesForSession("child-b", "p");
  expect(row).toMatchObject({
    delivery: "unknown",
    detail: "Delivery could not be confirmed. Check the agent before sending again.",
  });
  expect(JSON.stringify(row)).not.toContain("secret");
});

it("reads historical rows without body or block identity and marks stopped sends cancelled", async () => {
  const f = await fixture();
  const legacy = (id: string, delivery: string) => ({
    id,
    requestKey: `message:parent:${id}`,
    payloadHash: id,
    parentSessionId: "parent",
    projectId: "p",
    senderSessionId: "parent",
    targetSessionId: "child-b",
    targetRunId: "b",
    text: `Message from the parent assistant. Keep your existing subagent/advisor authority limits.\n\nOld ${id}`,
    mode: "auto",
    state: "settled",
    delivery,
    createdAt: 1,
  });
  await writeFileAtomic(
    join(f.directory, "delegation", "messages.json"),
    JSON.stringify([
      legacy("old-steer", "steered"),
      legacy("old-queue", "started"),
      { ...legacy("old-work", "started"), targetSessionId: "child-a", targetRunId: "a" },
    ]),
  );
  await f.records.patch("a", { rootWorkId: "work" });
  const rows = await f.create().messagesForSession("child-b", "p");
  expect(rows[0]).toMatchObject({ text: "Old old-steer", blockId: "agent_message_old-steer" });
  expect(rows[1]).toMatchObject({
    text: "Old old-queue",
    delivery: "submitted",
    blockId: delegationReplyCommandId("agents:parent:agent_message_old-queue"),
  });
  const [work] = await f.create().messagesForSession("child-a", "p");
  expect(work).toMatchObject({ text: "Old old-work", delivery: "submitted" });
  expect(work).not.toHaveProperty("blockId");

  const live = f.create();
  f.inspect.mockResolvedValue({ projectId: "p", runtimeMode: "supervised", status: "running" });
  await live.send(
    { requestId: "stop", runId: "b", message: "After stop", mode: "queue" },
    { sessionId: "parent", projectId: "p" },
  );
  await f.records.patch("b", { communicationClosed: true });
  await live.tick();
  expect((await live.messagesForSession("child-b", "p")).at(-1)).toMatchObject({
    text: "After stop",
    delivery: "cancelled",
  });
  expect(f.deliver).not.toHaveBeenCalled();
});

it("keeps six sends distinct: auto and steers reach the active turn, queues open FIFO turns after each completion", async () => {
  const f = await fixture();
  await f.records.patch("b", { notifyOnCompletion: true, childRunId: "turn-1" });
  let turn = 1;
  let running = true;
  const finished = new Set<string>();
  f.inspect.mockImplementation(async (id) => ({
    projectId: "p",
    runtimeMode: "supervised",
    status: id === "child-b" && running ? "running" : "idle",
  }));
  f.result.mockImplementation(async (record: DelegationRecord) =>
    finished.has(record.childRunId ?? "")
      ? { status: "succeeded", result: `Answer ${record.childRunId}` }
      : { status: "running", result: "" },
  );
  f.deliver.mockImplementation(async (message) => {
    if (!message.target) return "queued" as const;
    if (message.mode !== "queue") return "steered" as const;
    turn += 1;
    running = true;
    await f.records.patch("b", { childRunId: `turn-${turn}` });
    return { delivery: "started" as const, blockId: `send-turn-${turn}` };
  });
  const parent = { sessionId: "parent", projectId: "p" };
  const send = (requestId: string, message: string, mode: string) =>
    f.communication.send({ requestId, runId: "b", message, mode }, parent);
  await send("auto-1", "Auto", "auto");
  await send("steer-1", "Steer one", "steer");
  await send("steer-2", "Steer two", "steer");
  for (const n of [1, 2, 3]) await send(`queue-${n}`, `Queue ${n}`, "queue");
  // Every queued entry waits while the turn is active.
  expect(f.deliver).toHaveBeenCalledTimes(3);
  for (let round = 1; round <= 3; round++) {
    finished.add(`turn-${turn}`);
    running = false;
    await f.create().tick();
  }
  const order = f.deliver.mock.calls.map(([message]) =>
    message.target ? message.text.split("\n\n").at(-1) : message.text.split(":")[0],
  );
  expect(order).toEqual([
    "Auto",
    "Steer one",
    "Steer two",
    "Subagent completion",
    "Queue 1",
    "Subagent completion",
    "Queue 2",
    "Subagent completion",
    "Queue 3",
  ]);
  const notices = f.deliver.mock.calls
    .map(([message]) => message)
    .filter((message) => !message.target);
  expect(notices.map((message) => message.text.split("\n\n").at(-1))).toEqual([
    "Answer turn-1",
    "Answer turn-2",
    "Answer turn-3",
  ]);
  // Read as a restarted Host would: the projection comes from the durable outbox.
  const rows = await f.create().messagesForSession("child-b", "p");
  expect(new Set(rows.map((row) => row.id)).size).toBe(6);
  expect(
    rows.map((row) => [row.text, row.mode, row.effectiveMode, row.delivery, row.blockId]),
  ).toEqual([
    ["Auto", "auto", "steer", "submitted", `agent_message_${rows[0]!.id}`],
    ["Steer one", "steer", "steer", "submitted", `agent_message_${rows[1]!.id}`],
    ["Steer two", "steer", "steer", "submitted", `agent_message_${rows[2]!.id}`],
    ["Queue 1", "queue", "queue", "submitted", "send-turn-2"],
    ["Queue 2", "queue", "queue", "submitted", "send-turn-3"],
    ["Queue 3", "queue", "queue", "submitted", "send-turn-4"],
  ]);
  // Completion receipts stay durable (one per turn) and a retry of any send is deduplicated.
  const stored = JSON.parse(readFileSync(join(f.directory, "delegation", "messages.json"), "utf8"));
  expect(
    stored
      .filter((row: { requestKey: string }) => row.requestKey.startsWith("completion:"))
      .map((row: { requestKey: string }) => row.requestKey),
  ).toEqual(["completion:b:turn-1", "completion:b:turn-2", "completion:b:turn-3"]);
  await f
    .create()
    .send({ requestId: "queue-2", runId: "b", message: "Queue 2", mode: "queue" }, parent);
  expect(f.deliver).toHaveBeenCalledTimes(9);
});
