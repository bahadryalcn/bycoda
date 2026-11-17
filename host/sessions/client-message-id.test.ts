import { afterEach, expect, it } from "vitest";
import { join } from "node:path";
import { HostEngine, parseCommand } from "../engine";
import { HostStore } from "../store";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { clientMessageCommand } from "./client-message-id";

const id = "8ca190f8-9e1b-477d-9565-2fb1283ac578";
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each([null, "", 2, "bad", "8ca190f8-9e1b-077d-9565-2fb1283ac578"])(
  "rejects invalid clientMessageId %s",
  (clientMessageId) => {
    expect(() => clientMessageCommand({ type: "send", sessionId: "s", clientMessageId })).toThrow(
      "Invalid client message ID",
    );
  },
);
it("does not change legacy commands", () => {
  const command = { type: "send", sessionId: "s", commandId: "old" };
  expect(clientMessageCommand(command)).toBe(command);
});
it("projects mobile identity before semantic parsing", () => {
  expect(
    parseCommand({
      type: "send",
      sessionId: "s",
      commandId: "transport",
      text: "hello",
      clientMessageId: id,
    }).commandId,
  ).toBe(id);
});
it("rejects non-message commands carrying a client identity", () => {
  expect(() =>
    clientMessageCommand({ type: "delete", sessionId: "s", clientMessageId: id }),
  ).toThrow();
});
it("does not start a new send after archive", async () => {
  const fixture = await setup();
  await fixture.engine.updateSession(fixture.id, { archived: true });
  await expect(
    fixture.engine.command({
      type: "send",
      sessionId: fixture.id,
      text: "hello",
      clientMessageId: id,
    }),
  ).rejects.toThrow("archived");
  expect(fixture.provider.send).not.toHaveBeenCalled();
});
it("returns one durable receipt for concurrent sends and after reopening the store", async () => {
  const fixture = await setup();
  const command = {
    type: "send",
    sessionId: fixture.id,
    text: "hello",
    clientMessageId: id,
    commandId: "first",
  };
  const [first, second] = await Promise.all([
    fixture.engine.command(command),
    fixture.engine.command({ ...command, commandId: "retry" }),
  ]);
  expect(second).toEqual(first);
  await fixture.waitForTurnStart();
  expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  await expect(fixture.engine.command({ ...command, text: "changed" })).rejects.toThrow();
  await fixture.engine.close();
  await fixture.store.close();
  const store = new HostStore(join(fixture.directory, "host.db"));
  const engine = new HostEngine(store, { codex: fixture.provider });
  try {
    expect(await engine.command({ ...command, commandId: "restart" })).toEqual(first);
    expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  } finally {
    await engine.close();
    await store.close();
  }
});
