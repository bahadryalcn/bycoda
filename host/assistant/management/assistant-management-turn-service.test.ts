import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import type { RoomManagementAdmission } from "./assistant-management-turn";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-room-management-"));
  let store = new HostStore(join(directory, "host.db"));
  let calls = 0;
  let currentCwd = directory;
  const tools = vi.fn<NonNullable<AssistantPorts["roomManagement"]>>(async (call) => {
    calls++;
    return {
      value: { state: "completed", title: "Exact current task" },
      source: {
        environmentId: store.environmentId,
        threadId: call.threadId,
        family: call.family,
        action: call.action,
        ...(call.projectId ? { projectId: call.projectId, projectCwd: directory } : {}),
      },
      contributorProjectIds: call.projectId ? [call.projectId] : [],
    };
  });
  const reply = vi.fn<NonNullable<AssistantPorts["reply"]>>(async (input) => {
    expect(input.managementPrompt).toBeDefined();
    return {
      text: JSON.stringify(
        input.managementPrompt!.includes("Exact current task")
          ? { type: "final", text: "Read back Exact current task." }
          : {
              type: "tool",
              family: "conversation",
              action: "tasks.get",
              projectId: "project",
              input: { id: "task" },
            },
      ),
      tokens: 20,
    };
  });
  const visible = vi.fn(async () => true);
  const ports: AssistantPorts = {
    listProjects: async () => [{ id: "project", path: directory, name: "Project" }],
    reply,
    roomManagement: tools,
    roomManagementVisible: visible,
    roomProjectProofsValid: async (proofs) =>
      proofs.every((proof) => proof.projectId === "project" && proof.cwd === currentCwd),
    withRoomProjectDisclosure: async (threadId, ids, admission, effect) => {
      if (!(await admission.authorized()) || !(await visible(threadId, ids, admission)))
        throw new Error("Room project visibility unavailable.");
      return await effect(() => true);
    },
  };
  await store.ready;
  let service = new HostAssistant(store, ports);
  await service.ready;
  const profile = (await service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  await service.request(
    {
      op: "profile.update",
      expectedVersion: profile.version,
      patch: {
        name: "Room",
        setupComplete: true,
        enabled: true,
        autonomy: "report",
        dailyTokenBudget: 100000,
        execution: {
          harness: "codex",
          model: "saved-owner-model",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 30,
        },
      },
    },
    "owner",
  );
  const thread = (await service.request({ op: "threads.open" }, "owner")).thread!;
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: "actual-owner-hash",
    authorized: async () => true,
  };
  const input = {
    op: "threads.send",
    threadId: thread.id,
    via: "text",
    text: "Read the current task",
    idempotencyKey: "owner-turn",
  };
  const request = () => service.request(input, "owner", admission);
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get service() {
      return service;
    },
    get store() {
      return store;
    },
    thread,
    directory,
    retarget: () => {
      currentCwd = `${directory}-retargeted`;
    },
    admission,
    input,
    request,
    reply,
    tools,
    visible,
    restart: async () => {
      await service.close();
      await store.close();
      store = new HostStore(join(directory, "host.db"));
      await store.ready;
      service = new HostAssistant(store, ports);
      await service.ready;
    },
  };
}

it("redacts retained Room output when the source project is retargeted", async () => {
  const f = await fixture();
  const response = await f.request();
  expect(response.messages?.at(-1)?.text).toContain("Exact current task");
  f.retarget();
  const history = await f.service.request(
    { op: "threads.messages", threadId: f.thread.id, limit: 10 },
    "owner",
    f.admission,
  );
  expect(history.messages?.at(-1)?.text).toBe(
    "This message is unavailable because its source access changed.",
  );
});

it("executes typed Room tools with real owner/thread admission and retains verified result across restart", async () => {
  const f = await fixture();
  const response = await f.request();
  expect(response.messages?.at(-1)).toMatchObject({
    text: "Read back Exact current task.",
    projectIds: ["project"],
  });
  expect(response.messages?.at(-1)?.toolActions).toMatchObject([
    { action: "tasks.get", status: "completed" },
  ]);
  expect(response.messages?.[0].toolActions).toMatchObject([
    { action: "tasks.get", status: "completed" },
  ]);
  expect(f.tools).toHaveBeenCalledTimes(1);
  expect(f.tools.mock.calls[0][0]).toMatchObject({
    threadId: f.thread.id,
    projectId: "project",
    action: "tasks.get",
  });
  expect(f.tools.mock.calls[0][1].deviceHash).toBe("actual-owner-hash");
  await f.restart();
  expect((await f.request()).messages?.at(-1)?.text).toBe("Read back Exact current task.");
  expect(f.reply).toHaveBeenCalledTimes(2);
  expect(f.tools).toHaveBeenCalledTimes(1);
});

it("holds uncertain typed effects after restart and retains the exact accepted owner turn", async () => {
  const f = await fixture();
  f.tools.mockRejectedValueOnce(new Error("Effect acknowledgement unknown"));
  await expect(f.request()).rejects.toThrow("acknowledgement unknown");
  await f.restart();
  await expect(f.request()).rejects.toThrow("uncertain outcome");
  expect(f.tools).toHaveBeenCalledTimes(1);
  const messages = (
    await f.service.request({ op: "threads.messages", threadId: f.thread.id }, "owner")
  ).messages!;
  expect(messages.map((message) => message.text)).toEqual([f.input.text]);
  expect(messages[0]).toMatchObject({
    visibilityProjectIds: ["project"],
    toolActions: [{ action: "tasks.get", status: "unknown" }],
  });
});

it("emergency Stop releases the serialized Room request while native observation remains unknown", async () => {
  const f = await fixture();
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  f.tools.mockImplementationOnce(async (_call, admission) => {
    began();
    expect(admission.signal).toBeDefined();
    return new Promise(() => {});
  });
  const reply = f.request();
  const stopped = expect(reply).rejects.toThrow("stopped");
  await started;
  const pause = f.service.request({ op: "pauseAll" }, "owner");
  await stopped;
  await pause;
  expect(f.tools).toHaveBeenCalledTimes(1);
  expect(f.tools.mock.calls[0][1].signal?.aborted).toBe(true);
  expect(await f.tools.mock.calls[0][1].authorized()).toBe(false);
});

it("unknown tool provenance stays outside certified retained replies", async () => {
  const f = await fixture();
  f.tools.mockImplementationOnce(async (call) => ({
    value: { title: "Exact current task" },
    source: {
      environmentId: f.store.environmentId,
      threadId: call.threadId,
      projectId: call.projectId,
      projectCwd: f.directory,
      family: call.family,
      action: call.action,
    },
  }));
  const message = (await f.request()).messages?.at(-1)!;
  expect(message.projectIds).toBeUndefined();
  expect(message.visibilityProjectIds).toEqual(["project"]);
  expect(message.unverifiedToolContext).toBe(true);
});

it("recovers a durably settled final after its transcript acknowledgement gap without replaying tools", async () => {
  const f = await fixture();
  const response = await f.request();
  const reply = response.messages!.at(-1)!;
  const key = `reply:${f.thread.id}:${f.input.idempotencyKey}`;
  const row = await f.store.db.prepare("SELECT value FROM assistant_runtime WHERE id=?").get(key);
  const receipt = JSON.parse(String(row!.value));
  receipt.value.status = "unknown";
  delete receipt.value.messageId;
  await f.store.db
    .prepare("UPDATE assistant_runtime SET value=? WHERE id=?")
    .run(JSON.stringify(receipt), key);
  await f.restart();
  const recovered = await f.request();
  expect(recovered.messages?.at(-1)?.id).toBe(reply.id);
  expect(f.tools).toHaveBeenCalledTimes(1);
  expect(f.reply).toHaveBeenCalledTimes(2);
});
