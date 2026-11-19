import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("settles the receipt of a message refused because the assistant is not set up", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-assistant-refusal-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const service = new HostAssistant(store, {
    listProjects: async () => [],
    onError: () => {},
    reply: async () => ({ text: "unused", tokens: 1 }),
  });
  await service.ready;
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const request = (input: unknown) => service.request(input, "owner");
  const thread = (await request({ op: "threads.open" })).thread!;
  const instance = (await request({ op: "threads.sendIdentity" })).sendIdentity!.instanceId;
  const send = { threadId: thread.id, text: "Hello", idempotencyKey: "refused-send", expectedHostInstance: instance };
  // Before the fix the phone's receipt check stayed "unknown" forever and the message could never be cleared.
  await expect(request({ op: "threads.send", via: "text", ...send })).rejects.toThrow("Configure and enable the assistant");
  const status = await request({ op: "threads.sendStatus", ...send });
  expect(status.sendReceipt).toEqual({ status: "refused" });
  // A key that never reached the Host still reads as unknown: absence never permits a resend.
  const unseen = await request({ op: "threads.sendStatus", ...send, idempotencyKey: "never-sent" });
  expect(unseen.sendReceipt).toEqual({ status: "unknown" });
});
