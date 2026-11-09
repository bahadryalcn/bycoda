import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createRoomFileTools, type RoomFilePrincipal } from "./assistant-room-files";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const projectCwd = await mkdtemp(join(tmpdir(), "room-files-"));
  dirs.push(projectCwd);
  const principal: RoomFilePrincipal = {
    kind: "assistant-thread",
    threadId: "room",
    projectId: "p",
    provider: "assistant",
    projectCwd,
  };
  const receipts = new Map<string, ManagementReceipt>();
  const approve = vi.fn(async (operation: { operationHash: string }) => ({
    approved: true,
    operationHash: operation.operationHash,
  }));
  const tools = createRoomFileTools({
    approve,
    receipt: async (key) => receipts.get(key),
    saveReceipt: async (key, value) => {
      receipts.set(key, value);
    },
    run: async () => {
      throw new Error("Unexpected mutation");
    },
  });
  return { projectCwd, principal, receipts, approve, tools };
}
const qualify = <T>(effect: () => Promise<T>) => effect();

it("reads only the exact project root and rejects path traversal", async () => {
  const f = await fixture();
  await writeFile(join(f.projectCwd, "read.txt"), "hello");
  const value = (await f.tools.call(
    "files.read",
    { path: "read.txt" },
    f.principal,
    async () => true,
    qualify,
  )) as { text: string };
  expect(value.text).toBe("hello");
  await expect(
    f.tools.call("files.read", { path: "../outside" }, f.principal, async () => true, qualify),
  ).rejects.toThrow();
  await expect(
    f.tools.call(
      "files.read",
      { path: "read.txt", cwd: "outside" },
      f.principal,
      async () => true,
      qualify,
    ),
  ).rejects.toThrow();
  expect(f.approve).not.toHaveBeenCalled();
});

it("requires exact approval and current hash, then returns a durable receipt without replay", async () => {
  const f = await fixture();
  await writeFile(join(f.projectCwd, "edit.txt"), "old");
  const expectedHash = createHash("sha256").update("old").digest("hex");
  const input = { requestId: "edit-1", path: "edit.txt", expectedHash, content: "new" };
  const receipt = (await f.tools.call(
    "files.write",
    input,
    f.principal,
    async () => true,
    qualify,
  )) as ManagementReceipt;
  expect(receipt.state).toBe("completed");
  expect(await readFile(join(f.projectCwd, "edit.txt"), "utf8")).toBe("new");
  expect(
    (
      (await f.tools.call(
        "files.write",
        input,
        f.principal,
        async () => true,
        qualify,
      )) as ManagementReceipt
    ).state,
  ).toBe("completed");
  expect(f.approve).toHaveBeenCalledTimes(1);
  const { requestId, ...originalInput } = input;
  const status = (await f.tools.call(
    "files.operation.status",
    { operationId: requestId, action: "files.write", originalInput },
    f.principal,
    async () => true,
    qualify,
  )) as { state: string };
  expect(status.state).toBe("completed");
  const reordered = {
    content: originalInput.content,
    expectedHash: originalInput.expectedHash,
    path: originalInput.path,
  };
  expect(
    (
      (await f.tools.call(
        "files.operation.status",
        { operationId: requestId, action: "files.write", originalInput: reordered },
        f.principal,
        async () => true,
        qualify,
      )) as { state: string }
    ).state,
  ).toBe("completed");
  const [receiptKey, recorded] = [...f.receipts.entries()][0];
  f.receipts.set(receiptKey, { ...recorded, state: "pending" });
  expect(
    (
      (await f.tools.call(
        "files.operation.status",
        { operationId: requestId, action: "files.write", originalInput },
        f.principal,
        async () => true,
        qualify,
      )) as { state: string }
    ).state,
  ).toBe("uncertain");
  f.receipts.set(receiptKey, recorded);
  await expect(
    f.tools.call(
      "files.operation.status",
      {
        operationId: requestId,
        action: "files.write",
        originalInput: { ...originalInput, content: "forged" },
      },
      f.principal,
      async () => true,
      qualify,
    ),
  ).rejects.toThrow("identity changed");
  expect(
    (
      (await f.tools.call(
        "files.operation.status",
        { operationId: "missing", action: "files.write", originalInput },
        f.principal,
        async () => true,
        qualify,
      )) as { state: string }
    ).state,
  ).toBe("unknown");
  await expect(
    f.tools.call(
      "files.write",
      { ...input, content: "different" },
      f.principal,
      async () => true,
      qualify,
    ),
  ).rejects.toThrow("reused");
  const stale = (await f.tools.call(
    "files.write",
    { ...input, requestId: "edit-2" },
    f.principal,
    async () => true,
    qualify,
  )) as ManagementReceipt;
  expect(stale.state).toBe("uncertain");
  expect(await readFile(join(f.projectCwd, "edit.txt"), "utf8")).toBe("new");
});

it("waits for the qualified operation to settle and denies revoked writes", async () => {
  const f = await fixture();
  await writeFile(join(f.projectCwd, "edit.txt"), "old");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let allowed = true;
  const held = <T>(effect: () => Promise<T>) => gate.then(effect);
  const input = {
    requestId: "edit-3",
    path: "edit.txt",
    expectedHash: createHash("sha256").update("old").digest("hex"),
    content: "new",
  };
  const pending = f.tools.call("files.write", input, f.principal, async () => allowed, held);
  await vi.waitFor(() => expect(f.approve).toHaveBeenCalledOnce());
  expect(await readFile(join(f.projectCwd, "edit.txt"), "utf8")).toBe("old");
  allowed = false;
  release();
  expect(((await pending) as ManagementReceipt).state).toBe("uncertain");
  expect(await readFile(join(f.projectCwd, "edit.txt"), "utf8")).toBe("old");
});

it("does not repeat a filesystem mutation after an uncertain outcome", async () => {
  const f = await fixture();
  await writeFile(join(f.projectCwd, "edit.txt"), "old");
  const inspected = (await f.tools.call(
    "files.inspect",
    { path: "edit.txt" },
    f.principal,
    async () => true,
    qualify,
  )) as { hash: string };
  const run = vi.fn(async () => {
    throw new Error("lost mutation acknowledgement");
  });
  const tools = createRoomFileTools({
    approve: f.approve,
    receipt: async (key) => f.receipts.get(key),
    saveReceipt: async (key, value) => {
      f.receipts.set(key, value);
    },
    run,
  });
  const input = {
    requestId: "rename-unknown",
    path: "edit.txt",
    name: "new.txt",
    expectedHash: inspected.hash,
  };
  expect(
    (
      (await tools.call(
        "files.rename",
        input,
        f.principal,
        async () => true,
        qualify,
      )) as ManagementReceipt
    ).state,
  ).toBe("uncertain");
  expect(
    (
      (await tools.call(
        "files.rename",
        input,
        f.principal,
        async () => true,
        qualify,
      )) as ManagementReceipt
    ).state,
  ).toBe("uncertain");
  expect(run).toHaveBeenCalledTimes(1);
});
