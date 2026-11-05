import { afterEach, expect, it, vi } from "vitest";
import { HostTerminals } from "../../terminals/terminals";
import { createRoomTerminalTools, type RoomTerminalPrincipal } from "./assistant-room-terminals";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

const hosts: HostTerminals[] = [];
afterEach(async () => {
  await Promise.allSettled(hosts.splice(0).map((host) => host.close()));
});
function setup() {
  let output = (_text: string) => {};
  let exit = (_code: number | null) => {};
  const process = { write: vi.fn(async (_data: string) => {}), stop: vi.fn(async () => exit(0)) };
  const host = new HostTerminals(
    (_profile, _cwd, onOutput, onExit) => {
      output = onOutput;
      exit = onExit;
      return process;
    },
    () => ({
      profiles: [{ id: "sh", name: "Shell", path: "/shell", kind: "sh" }],
      defaultId: "sh",
      chosenId: null,
    }),
    async (root) => root,
  );
  hosts.push(host);
  const receipts = new Map<string, ManagementReceipt>();
  const tools = createRoomTerminalTools({
    terminals: host,
    project: async (id) => ({ id, cwd: "/project" }),
    approve: async (op) => ({ approved: true, operationHash: op.operationHash }),
    receipt: async (key) => receipts.get(key),
    saveReceipt: async (key, value) => {
      receipts.set(key, value);
    },
  });
  const principal: RoomTerminalPrincipal = {
    kind: "assistant-thread",
    provider: "assistant",
    threadId: "room",
    projectId: "p",
    projectCwd: "/project",
    environmentId: "host",
    deviceHash: "a".repeat(64),
  };
  return { tools, principal, process, output: (value: string) => output(value) };
}
const qualify = <T>(effect: () => Promise<T>) => effect();
it("keeps pipe terminals scoped to the exact Room and device", async () => {
  const f = setup();
  const created = (await f.tools.call(
    "terminals.create",
    { requestId: "create-1", name: "Room shell" },
    f.principal,
    async () => true,
    qualify,
  )) as { result: { id: string; transport: string } };
  expect(created.result.transport).toBe("pipe");
  f.output("hello");
  const read = (await f.tools.call(
    "terminals.read",
    { terminalId: created.result.id },
    f.principal,
    async () => true,
    qualify,
  )) as { output: string; transport: string };
  expect(read.output).toBe("hello");
  expect(read.transport).toBe("pipe");
  const other = { ...f.principal, deviceHash: "b".repeat(64) };
  expect(
    (
      (await f.tools.call("terminals.list", {}, other, async () => true, qualify)) as {
        terminals: unknown[];
      }
    ).terminals,
  ).toEqual([]);
  await expect(
    f.tools.call(
      "terminals.read",
      { terminalId: created.result.id },
      other,
      async () => true,
      qualify,
    ),
  ).rejects.toThrow("unavailable");
});
it("retains an uncertain input receipt and never writes it twice", async () => {
  const f = setup();
  const created = (await f.tools.call(
    "terminals.create",
    { requestId: "create-2" },
    f.principal,
    async () => true,
    qualify,
  )) as { result: { id: string } };
  f.process.write.mockRejectedValue(new Error("unknown write"));
  const input = { requestId: "write-1", terminalId: created.result.id, data: "pwd\n" };
  expect(
    (
      (await f.tools.call(
        "terminals.write",
        input,
        f.principal,
        async () => true,
        qualify,
      )) as ManagementReceipt
    ).state,
  ).toBe("uncertain");
  expect(
    (
      (await f.tools.call(
        "terminals.write",
        input,
        f.principal,
        async () => true,
        qualify,
      )) as ManagementReceipt
    ).state,
  ).toBe("uncertain");
  expect(f.process.write).toHaveBeenCalledOnce();
  const originalInput = { data: input.data, terminalId: input.terminalId };
  expect(
    (
      (await f.tools.call(
        "terminals.operation.status",
        { operationId: input.requestId, action: "terminals.write", originalInput },
        f.principal,
        async () => true,
        qualify,
      )) as { state: string }
    ).state,
  ).toBe("uncertain");
});

it("keeps the qualified effect pending until the pipe write settles", async () => {
  const f = setup();
  const created = (await f.tools.call(
    "terminals.create",
    { requestId: "create-3" },
    f.principal,
    async () => true,
    qualify,
  )) as { result: { id: string } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.process.write.mockImplementation(() => gate);
  let holding = false;
  const fence = async <T>(effect: () => Promise<T>) => {
    holding = true;
    try {
      return await effect();
    } finally {
      holding = false;
    }
  };
  const pending = f.tools.call(
    "terminals.write",
    { requestId: "write-2", terminalId: created.result.id, data: "pwd\n" },
    f.principal,
    async () => true,
    fence,
  );
  await vi.waitFor(() => expect(f.process.write).toHaveBeenCalledOnce());
  expect(holding).toBe(true);
  release();
  expect(await pending).toMatchObject({
    state: "accepted",
    receiptState: "completed",
    result: { delivery: "pipe-written", commandCompletion: "unobserved", transport: "pipe" },
  });
  expect(holding).toBe(false);
  expect(
    await f.tools.call(
      "terminals.operation.status",
      {
        operationId: "write-2",
        action: "terminals.write",
        originalInput: { data: "pwd\n", terminalId: created.result.id },
      },
      f.principal,
      async () => true,
      qualify,
    ),
  ).toMatchObject({
    state: "accepted",
    receiptState: "completed",
    result: { commandCompletion: "unobserved" },
  });
});

it("does not deliver input when Room authority is revoked before qualification", async () => {
  const f = setup();
  const created = (await f.tools.call(
    "terminals.create",
    { requestId: "create-4" },
    f.principal,
    async () => true,
    qualify,
  )) as { result: { id: string } };
  let authorized = true;
  const fence = async <T>(effect: () => Promise<T>) => {
    authorized = false;
    return effect();
  };
  const result = (await f.tools.call(
    "terminals.write",
    { requestId: "write-3", terminalId: created.result.id, data: "pwd\n" },
    f.principal,
    async () => authorized,
    fence,
  )) as ManagementReceipt;
  expect(result.state).toBe("uncertain");
  expect(f.process.write).not.toHaveBeenCalled();
});
