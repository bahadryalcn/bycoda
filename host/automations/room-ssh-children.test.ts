import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import { RoomToolRetiredError } from "./room-command-lifetime";
import { RoomAutomationSshChildren } from "./room-ssh-children";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "room-ssh-child-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  let active = true;
  let state = "exited";
  const source = {
    environmentId: store.environmentId,
    threadId: "room",
    family: "conversation" as const,
    action: "servers.ssh.status",
  };
  const disclose = vi.fn(async () => ({
    value: { requestId: "request", state },
    source,
    contributorProjectIds: [],
  }));
  const relay = vi.fn(
    async (
      action: string,
      _input: unknown,
      _source: unknown,
      authorized: () => Promise<boolean>,
    ) => {
      expect(await authorized()).toBe(true);
      if (action === "servers.ssh.cancel") state = "cancelled";
      return { requestId: "request", state };
    },
  );
  const dependencies = {
    conversationDesktop: { callAssistantThread: relay },
    assistant: { globalRoomBinding: async () => ({ id: "room" }) },
    assistantPorts: { roomManagement: disclose },
  } as unknown as Pick<ServerBindings, "conversationDesktop" | "assistant" | "assistantPorts">;
  const children = new RoomAutomationSshChildren(
    store,
    async () => active,
    () => dependencies,
  );
  const call = {
    threadId: "room",
    family: "conversation" as const,
    action: "servers.ssh.execute",
    requestId: "request",
    input: { id: "saved-server", requestId: "request", command: "read" },
  };
  const parent = { workId: "work", occurrence: "occurrence", deviceHash: "a".repeat(64) };
  return {
    store,
    children,
    relay,
    disclose,
    call,
    parent,
    source,
    active: (value: boolean) => {
      active = value;
    },
    state: (value: string) => {
      state = value;
    },
  };
}

it("retains exact original SSH attempt and re-enters registered disclosure only after Native exit", async () => {
  const f = await fixture();
  const effect = vi.fn(async () => {
    const row = await f.store.db
      .prepare("SELECT value FROM metadata WHERE key='room-ssh-child:request'")
      .get();
    expect(JSON.parse(String(row!.value))).toMatchObject({
      ...f.parent,
      requestId: "request",
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    return { value: { state: "running" }, source: f.source };
  });
  const result = await f.children.withChild(
    f.call,
    f.parent,
    new AbortController().signal,
    async () => true,
    effect,
  );
  expect(result.value.state).toBe("exited");
  expect(effect).toHaveBeenCalledTimes(1);
  expect(f.relay).toHaveBeenCalledWith(
    "servers.ssh.status",
    { requestId: "request", maxBytes: 1 },
    expect.objectContaining({ targetDeviceHash: f.parent.deviceHash, threadId: "room" }),
    expect.any(Function),
  );
  expect(f.disclose).toHaveBeenCalledTimes(1);
  await expect(
    f.children.withChild(f.call, f.parent, new AbortController().signal, async () => true, effect),
  ).rejects.toThrow("never replay");
  expect(effect).toHaveBeenCalledTimes(1);
});

it("Abort cancels original pending Native request and waits for its original executor result", async () => {
  const f = await fixture();
  f.state("pendingApproval");
  const controller = new AbortController();
  let reply!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = f.children.withChild(
    f.call,
    f.parent,
    controller.signal,
    async () => true,
    async () => {
      entered();
      await new Promise<void>((resolve) => {
        reply = resolve;
      });
      return { value: {}, source: f.source };
    },
  );
  const held = pending.catch((error) => error);
  await started;
  controller.abort();
  f.active(false);
  await f.children.stop("occurrence");
  expect(f.relay).toHaveBeenCalledWith(
    "servers.ssh.cancel",
    { requestId: "request" },
    expect.objectContaining({ targetDeviceHash: f.parent.deviceHash }),
    expect.any(Function),
  );
  reply();
  expect(await held).toBeInstanceOf(RoomToolRetiredError);
  expect(f.disclose).not.toHaveBeenCalled();
});

it("unknown Native process or I/O retirement remains held and never exposes output as success", async () => {
  const f = await fixture();
  f.state("unknown");
  await expect(
    f.children.withChild(
      f.call,
      f.parent,
      new AbortController().signal,
      async () => true,
      async () => ({ value: {}, source: f.source }),
    ),
  ).rejects.toThrow("do not replay");
  expect(f.disclose).not.toHaveBeenCalled();
  const row = await f.store.db
    .prepare("SELECT value FROM metadata WHERE key='room-ssh-child:request'")
    .get();
  expect(JSON.parse(String(row!.value)).retired).toBeUndefined();
});
