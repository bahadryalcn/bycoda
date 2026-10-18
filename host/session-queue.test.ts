import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { SessionQueues } from "./session-queue";
import type { RemoteQueue } from "../src/features/connections/model/remoteQueue";

const databases: DatabaseSync[] = [];
const message = (id: string, text = id) => ({
  id,
  text,
  attachments: [],
  modelTarget: { harness: "codex" as const, model: "gpt", modelSettings: { effort: "high" } },
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return { db, queues: new SessionQueues(db) };
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

it("validates explicit selected-row sends without releasing a paused queue", () => {
  const { queues } = setup();
  const paused = queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  expect(() => queues.assertSend("chat", "b", "pc1", paused.revision)).toThrow(/queue changed/);
  expect(queues.assertSend("chat", "b", "pc1", paused.revision, true)).toEqual(paused);
  queues.consumed("chat", "b");
  expect(queues.get("chat").messages.map((row) => row.id)).toEqual(["a"]);
  expect(queues.get("chat").status).toBe("paused");
});

it("persists ordered messages and saved settings across queue service restarts", () => {
  const { db, queues } = setup();
  const first = queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  expect(new SessionQueues(db).get("chat")).toEqual(first);
  expect(queues.get("other").messages).toEqual([]);
});

it("merges simultaneous appends and edits of different rows without losing either", () => {
  const { queues } = setup();
  const empty = { messages: [] };
  queues.change("chat", empty, { messages: [message("a")], status: "active" }, "pc1");
  queues.change("chat", empty, { messages: [message("b")], status: "active" });
  const before = queues.get("chat");
  queues.change("chat", before, { ...before, messages: [message("a", "edit a"), message("b")] });
  const next = queues.change("chat", before, {
    ...before,
    messages: [message("a"), message("b", "edit b")],
  });
  expect(next.messages.map((row) => row.text)).toEqual(["edit a", "edit b"]);
  expect(next.consumer).toBe("pc1");
});

it("rejects competing edits and orders, leaving the first change intact", () => {
  const { queues } = setup();
  const before = queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b"), message("c")], status: "paused" },
  );
  queues.change("chat", before, {
    ...before,
    messages: [message("a", "first"), message("b"), message("c")],
  });
  expect(() =>
    queues.change("chat", before, {
      ...before,
      messages: [message("a", "second"), message("b"), message("c")],
    }),
  ).toThrow(/another computer/);
  const order = queues.get("chat");
  queues.change("chat", order, {
    ...order,
    messages: [order.messages[1], order.messages[0], order.messages[2]],
  });
  expect(() =>
    queues.change("chat", order, { ...order, messages: [...order.messages].reverse() }),
  ).toThrow(/order changed/);
});

it("keeps an uncertain local send reserved and retries its acknowledgement idempotently", () => {
  const { queues } = setup();
  const before = queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a")], status: "active" },
    "desktop:pc1",
  );
  const claimed = queues.claim("chat", "a", "desktop:pc1", before.revision);
  expect(() => queues.assertSend("chat", "a", "pc2", claimed.revision)).toThrow();
  expect(() =>
    queues.change("chat", claimed, { ...claimed, messages: [message("a", "edit")] }),
  ).toThrow(/being sent/);
  const finished = queues.finish("chat", claimed.claim!.token, true);
  expect(finished.messages).toEqual([]);
  expect(queues.finish("chat", claimed.claim!.token, true)).toEqual(finished);
});

it("does not resurrect consumed or removed rows when an enqueue reply was lost", () => {
  const { queues } = setup();
  const empty = { messages: [] };
  const queued: RemoteQueue = { messages: [message("a")], status: "active" };
  queues.change("chat", empty, queued, "pc1");
  queues.consumed("chat", "a");
  expect(queues.change("chat", empty, queued, "pc1").messages).toEqual([]);
  expect(
    queues.change("chat", queued, { ...queued, messages: [message("a"), message("new")] }).messages,
  ).toEqual([message("new")]);
  const b = queues.change("chat", empty, { ...queued, messages: [message("b")] });
  queues.change("chat", b, empty);
  expect(queues.change("chat", empty, { ...queued, messages: [message("b")] }).messages).toEqual(
    [],
  );
});

it("guards saved state, ownership, revision and head before dispatch", () => {
  const { queues } = setup();
  const queue = queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  expect(() => queues.assertSend("chat", "a", "pc1", queue.revision)).toThrow();
  const active = queues.change("chat", queue, { ...queue, status: "active" }, "pc2");
  expect(() => queues.assertSend("chat", "a", "pc1", active.revision)).toThrow();
  expect(() => queues.assertSend("chat", "b", "pc2", active.revision)).toThrow();
  expect(() => queues.assertSend("chat", "a", "pc2", queue.revision)).toThrow();
  expect(queues.assertSend("chat", "a", "pc2", active.revision)).toEqual(active);
});
