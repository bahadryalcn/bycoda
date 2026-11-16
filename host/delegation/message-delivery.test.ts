import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHostRpcMethod } from "../../src/shared/model/host-contracts";
import { HostStore } from "../store";
import { SessionQueues } from "../sessions/session-queue";
import {
  agentMessageDelivery,
  enqueueAgentParentMessage,
  noticeUndelivered,
} from "./message-delivery";
import type { DelegationDependencies } from "./service";
import type { AgentDelivery } from "./communication";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture() {
  const command = vi.fn(async (_command: unknown) => ({}));
  const enqueueParent = vi.fn(async () => {});
  const continueChild = vi.fn(async () => "started" as const);
  const session = vi.fn(async () => ({
    status: "running",
    runId: "turn-a",
    session: { blocks: [] },
  }));
  const deps = {
    engine: { store: { session }, command },
    enqueueParent,
  } as unknown as DelegationDependencies;
  const message = {
    targetSessionId: "child",
    target: { runId: "b" },
    text: "Question",
    commandId: "message-id",
    mode: "auto",
  } as AgentDelivery;
  return {
    command,
    enqueueParent,
    continueChild,
    session,
    message,
    deliver: agentMessageDelivery(deps, continueChild),
  };
}

it("steers the captured running turn without replacing its task", async () => {
  const f = fixture();
  expect(await f.deliver(f.message)).toBe("steered");
  expect(f.command).toHaveBeenCalledWith({
    type: "steer",
    commandId: "message-id",
    sessionId: "child",
    runId: "turn-a",
    text: "Question",
  });
  expect(f.continueChild).not.toHaveBeenCalled();
});

it("defers unsupported auto steering but never retries an uncertain provider error", async () => {
  const f = fixture();
  f.command.mockRejectedValueOnce(new Error("This provider cannot steer an active turn"));
  expect(await f.deliver(f.message)).toBe("waiting");
  f.command.mockRejectedValueOnce(new Error("Transport lost after submit"));
  await expect(f.deliver(f.message)).rejects.toThrow("Transport lost");
});

it("resumes an idle child through delegation admission", async () => {
  const f = fixture();
  f.session.mockResolvedValue({ status: "idle", runId: "previous", session: { blocks: [] } });
  expect(await f.deliver(f.message)).toBe("started");
  expect(f.continueChild).toHaveBeenCalledWith(f.message);
  expect(f.command).not.toHaveBeenCalled();
});

it("queues a Native parent without creating or adopting its session", async () => {
  const f = fixture();
  f.session.mockRejectedValue(new Error("Session not found on this machine"));
  expect(
    await f.deliver({ ...f.message, target: undefined, targetSessionId: "native-parent" }),
  ).toBe("queued");
  expect(f.enqueueParent).toHaveBeenCalledWith(
    "native-parent",
    "message-id",
    "Question",
    undefined,
  );
  expect(f.command).not.toHaveBeenCalled();
});

it("does not interrupt a parent's current turn for a completion notification", async () => {
  const f = fixture();
  expect(await f.deliver({ ...f.message, target: undefined, mode: "queue" })).toBe("queued");
  expect(f.command).not.toHaveBeenCalled();
});

it("never routes an unattended Work parent through an unbudgeted owner queue", async () => {
  const f = fixture();
  const source = { rootWorkId: "work-root" } as NonNullable<AgentDelivery["source"]>;
  expect(await f.deliver({ ...f.message, source, target: undefined, mode: "queue" })).toBe(
    "waiting",
  );
  f.session.mockResolvedValue({ status: "idle", runId: "previous", session: { blocks: [] } });
  await expect(f.deliver({ ...f.message, source, target: undefined })).rejects.toThrow(
    "Work owner",
  );
  expect(f.enqueueParent).not.toHaveBeenCalled();
});

it("preserves existing queue text and the owner's pause", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-queue-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanup.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const queues = new SessionQueues(store.db);
  await queues.ready;
  const empty = await queues.get("parent");
  await queues.change("parent", empty, {
    ...empty,
    status: "paused",
    messages: [{ id: "owner", text: "Draft", attachments: [] }],
  });
  await enqueueAgentParentMessage(queues, "parent", "message-id", "Completion");
  const queue = await queues.get("parent");
  expect(queue.status).toBe("paused");
  expect(queue.messages.map((row) => row.text)).toEqual(["Draft", "Completion"]);
});

async function noticeQueues() {
  const directory = mkdtempSync(join(tmpdir(), "agent-notice-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanup.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const queues = new SessionQueues(store.db);
  await queues.ready;
  return queues;
}
const notice = (runId: string, reason: "completion" | "message" = "completion") =>
  ({ kind: "delegation", runId, title: runId, reason }) as const;

it("queues a completion as a system-authored row and batches later ones into it", async () => {
  const queues = await noticeQueues();
  await enqueueAgentParentMessage(queues, "parent", "agent_message_1", "Done one", notice("a"));
  await enqueueAgentParentMessage(queues, "parent", "agent_message_2", "Done two", notice("b"));
  await enqueueAgentParentMessage(queues, "parent", "agent_message_2", "Done two", notice("b"));
  const queue = await queues.get("parent");
  expect(queue.messages).toHaveLength(1);
  expect(queue.messages[0]).toMatchObject({
    id: "agent_message_1",
    author: notice("a"),
    text: expect.stringContaining("Done one"),
  });
  expect(queue.messages[0]!.text).toContain("Done two");
  // A stamped row once failed the wire contract, so every queue read held the owner's sends.
  expect(getHostRpcMethod("sessions.queue.get")!.resultSchema.safeParse(queue).success).toBe(true);
});

it("does not merge notices across reasons, owner rows or a row being sent, and caps each section", async () => {
  const queues = await noticeQueues();
  await enqueueAgentParentMessage(queues, "parent", "agent_message_1", "Done", notice("a"));
  await enqueueAgentParentMessage(
    queues,
    "parent",
    "agent_message_2",
    "Peer",
    notice("b", "message"),
  );
  const before = await queues.get("parent");
  await queues.change("parent", before, {
    ...before,
    messages: [...before.messages, { id: "owner", text: "Hi", attachments: [] }],
  });
  await enqueueAgentParentMessage(
    queues,
    "parent",
    "agent_message_3",
    "x".repeat(20_000),
    notice("c"),
  );
  const rows = (await queues.get("parent")).messages;
  expect(rows.map((row) => row.id)).toEqual([
    "agent_message_1",
    "agent_message_2",
    "owner",
    "agent_message_3",
  ]);
  expect(rows[3]!.text.length).toBeLessThanOrEqual(8_000);
});

it("reports a notice as undelivered only while it heads an active queue nobody claimed", async () => {
  const queues = await noticeQueues();
  expect(await noticeUndelivered(queues, "parent")).toBe(false);
  await enqueueAgentParentMessage(queues, "parent", "agent_message_1", "Done", notice("a"));
  expect(await noticeUndelivered(queues, "parent")).toBe(true);
  const queue = await queues.get("parent");
  await queues.change("parent", queue, { ...queue, status: "paused" });
  expect(await noticeUndelivered(queues, "parent")).toBe(false);
  await enqueueAgentParentMessage(queues, "owner-first", "owner", "Draft");
  await enqueueAgentParentMessage(queues, "owner-first", "agent_message_2", "Done", notice("b"));
  expect(await noticeUndelivered(queues, "owner-first")).toBe(false);
});
