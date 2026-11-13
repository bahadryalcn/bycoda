import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { AssistantRepository } from "../repository";
import { AssistantActionJournal } from "./assistant-action-journal";
import type { AssistantPorts } from "../service";
import type { RoomManagementAdmission, RoomManagementCall } from "./assistant-management-turn";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

it("appends actual operation outcomes once and fences source disclosure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-journal-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.ready;
  const project = await store.addProject(directory, "Test");
  const repository = new AssistantRepository(store);
  await repository.initialize();
  await repository.put("threads", {
    id: "thread",
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    projectId: project.id,
    summary: "",
  });
  let time = 1;
  const journal = new AssistantActionJournal(store, () => time++);
  const call: RoomManagementCall = {
    threadId: "thread",
    projectId: project.id,
    family: "conversation",
    action: "files.write",
    requestId: "request",
    input: { path: "file.txt", content: "private source bytes" },
  };
  const effect = async () => ({
    value: { status: "completed", secret: "private output bytes" },
    source: {
      environmentId: store.environmentId,
      threadId: call.threadId,
      projectId: project.id,
      family: call.family,
      action: call.action,
    },
    contributorProjects: [{ projectId: project.id, cwd: project.cwd }],
  });
  await journal.run(call, store.environmentId, effect);
  await journal.run(call, store.environmentId, effect);
  const rows = await store.db.prepare("SELECT value FROM assistant_action_journal").all();
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain("private source bytes");
  expect(JSON.stringify(rows)).not.toContain("private output bytes");
  await expect(
    journal.run({ ...call, input: { path: "other.txt" } }, store.environmentId, effect),
  ).rejects.toThrow("identity was reused");
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: "device",
    authorized: async () => true,
  };
  const ports: AssistantPorts = {
    manualProjectVisible: async () => true,
    withRoomResponseDisclosure: async (_scopes, _admission, effect) => effect(() => true),
  };
  expect(await journal.activity(20, ports)).toEqual([]);
  const activity = await journal.activity(20, ports, admission);
  expect(activity).toHaveLength(1);
  expect(activity[0].kind).toBe("action.completed");
  expect(activity[0].operation?.target).toContain("file.txt");
  expect(
    await journal.activity(20, { ...ports, manualProjectVisible: async () => false }, admission),
  ).toEqual([]);
  await expect(
    journal.activity(
      20,
      {
        ...ports,
        withRoomResponseDisclosure: async (_scopes, _admission, effect) => effect(() => false),
      },
      admission,
    ),
  ).rejects.toThrow("source visibility changed");
  await journal.clear();
  expect(await journal.activity(20, ports, admission)).toEqual([]);
  expect(await store.db.prepare("SELECT value FROM assistant_action_journal").all()).toHaveLength(
    2,
  );
  await journal.runAutonomous(
    {
      operationId: "auto",
      action: "sessions.manage",
      target: "session",
      jobId: "job",
      projectIds: [project.id],
    },
    async () => ({ state: "unknown" }),
  );
  const autonomous = await journal.activity(20, ports, admission, "thread");
  expect(autonomous).toHaveLength(1);
  expect(autonomous[0]).toMatchObject({
    jobId: "job",
    kind: "action.unknown",
    operation: { tool: "conversation:sessions.manage", target: "session" },
  });
});
