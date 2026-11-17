import { afterEach, expect, it, vi } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { clientMessageQueue } from "./client-message-queue";

const id = "8ca190f8-9e1b-477d-9565-2fb1283ac578";
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const params = (sessionId: string, text = "hello") => ({
  sessionId,
  before: { messages: [] },
  after: { messages: [{ id, clientMessageId: id, text, attachments: [] }] },
});
it("atomically deduplicates an enqueue even when its original row has drained", async () => {
  const { store, id: sessionId } = await setup();
  const work = vi.fn(async () => ({ messages: [{ id, text: "hello" }], revision: 1 }));
  const input = params(sessionId);
  const authorize = vi.fn(async () => {});
  const first = await clientMessageQueue(store, input, work, authorize);
  expect(await clientMessageQueue(store, input, work, authorize)).toEqual(first);
  expect(work).toHaveBeenCalledTimes(1);
  await expect(
    clientMessageQueue(store, params(sessionId, "changed"), work, authorize),
  ).rejects.toThrow("different request");
});
it("rolls back both queue mutation and receipt when authorization is revoked", async () => {
  const { store, id: sessionId } = await setup();
  await store.db.exec("CREATE TABLE outbox_test_effect (id TEXT PRIMARY KEY)");
  let calls = 0;
  const authorize = async () => {
    if (++calls === 2) throw new Error("revoked");
  };
  await expect(
    clientMessageQueue(
      store,
      params(sessionId),
      async () => {
        await store.db.prepare("INSERT INTO outbox_test_effect (id) VALUES (?)").run(id);
        return { revision: 1 };
      },
      authorize,
    ),
  ).rejects.toThrow("revoked");
  expect(await store.db.prepare("SELECT * FROM outbox_test_effect").all()).toEqual([]);
  const work = vi.fn(async () => ({ revision: 1 }));
  await clientMessageQueue(store, params(sessionId), work, async () => {});
  expect(work).toHaveBeenCalledTimes(1);
});
it("never enqueues after archive", async () => {
  const { store, engine, id: sessionId } = await setup();
  await engine.updateSession(sessionId, { archived: true });
  const work = vi.fn();
  await expect(clientMessageQueue(store, params(sessionId), work, async () => {})).rejects.toThrow(
    "archived",
  );
  expect(work).not.toHaveBeenCalled();
});
