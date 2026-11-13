import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import { captureRoomTerminalChild, RoomAutomationTerminalChildren } from "./room-terminal-children";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("owns exact terminal processes, refuses foreign writes, and waits for proven Stop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-terminal-child-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  let active = true;
  const terminal = { id: "terminal", projectId: "project", createdAt: 1, cwd: "C:/project" };
  let entries = [terminal];
  let retire!: () => void;
  const remove = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      retire = resolve;
    });
    entries = [];
    return { closed: true };
  });
  const terminals = {
    list: () => ({ terminals: entries }),
    remove,
  } as unknown as ServerBindings["terminals"];
  const children = new RoomAutomationTerminalChildren(
    store,
    async () => active,
    () => terminals,
  );
  const parent = { workId: "work", occurrence: "occurrence" };
  const operation = {
    threadId: "room",
    projectId: "project",
    family: "conversation" as const,
    action: "terminals.create",
    input: {},
    requestId: "create",
  };
  await children.withChild(
    operation,
    parent,
    async () => true,
    async () => {
      await captureRoomTerminalChild(terminal, "original-owner");
      return terminal;
    },
  );
  const dispatch = vi.fn(async () => ({ accepted: true }));
  await expect(
    children.withChild(
      {
        ...operation,
        action: "terminals.write",
        requestId: "foreign",
        input: { terminalId: "foreign-terminal", data: "run\n" },
      },
      parent,
      async () => true,
      dispatch,
    ),
  ).rejects.toThrow("original occurrence");
  expect(dispatch).not.toHaveBeenCalled();
  await children.withChild(
    {
      ...operation,
      action: "terminals.write",
      requestId: "write",
      input: { terminalId: terminal.id, data: "run\n" },
    },
    parent,
    async () => true,
    dispatch,
  );
  const write = await store.db
    .prepare("SELECT value FROM metadata WHERE key='room-terminal-write:write'")
    .get();
  expect(JSON.parse(String(write!.value))).toMatchObject({
    ...parent,
    terminalId: terminal.id,
    createdAt: 1,
  });
  active = false;
  const stop = children.stop("occurrence");
  await vi.waitFor(() =>
    expect(remove).toHaveBeenCalledWith("project", "terminal", "original-owner"),
  );
  let stopped = false;
  void stop
    .then(
      () => {
        stopped = true;
      },
      () => {
        stopped = true;
      },
    )
    .catch(() => undefined);
  expect(stopped).toBe(false);
  retire();
  await stop;
  const entry = await store.db
    .prepare("SELECT value FROM metadata WHERE key='room-terminal-child:create'")
    .get();
  expect(JSON.parse(String(entry!.value)).closed).toBe(true);
});

it("restart cannot replace an unproven old terminal handle with a new runtime process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-terminal-recovery-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  await store.db
    .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
    .run(
      "room-terminal-child:old",
      JSON.stringify({
        requestId: "old",
        workId: "work",
        occurrence: "occurrence",
        runtime: "old-runtime",
        terminal: { id: "terminal", projectId: "project", createdAt: 1, cwd: "C:/project" },
        owner: "owner",
      }),
    );
  const remove = vi.fn();
  const children = new RoomAutomationTerminalChildren(
    store,
    async () => false,
    () => ({ remove }) as unknown as ServerBindings["terminals"],
  );
  await expect(children.recover()).rejects.toThrow("unknown after restart");
  expect(remove).not.toHaveBeenCalled();
});
