import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  await repository.trash("threads", "thread", 1, time++);
  expect(await journal.activity(20, ports, admission, "thread")).toEqual([]);
});

it("gives the history up after its budget instead of waiting on a silent desktop", async () => {
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
  const journal = new AssistantActionJournal(store, Date.now, 40);
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
  let observed: RoomManagementAdmission | undefined;
  const ports = {
    manualProjectVisible: async () => true,
    // A desktop that never answers: only the admission signal can end this wait.
    withRoomResponseDisclosure: (_scopes: unknown, admission: RoomManagementAdmission) => {
      observed = admission;
      return new Promise<never>(() => undefined);
    },
  } as unknown as AssistantPorts;
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: "a".repeat(64),
    authorized: async () => true,
  };
  const started = Date.now();
  await expect(journal.activity(20, ports, admission, "thread")).rejects.toThrow("not answering");
  expect(Date.now() - started).toBeLessThan(2_000);
  // The abandoned capture sees revoked authority, so a late desktop answer is refused.
  expect(observed?.signal?.aborted).toBe(true);
  expect(await observed?.authorized()).toBe(false);
});

it("hands every source of every row to one disclosure, with no cap on how many", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-journal-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  await repository.put("threads", {
    id: "thread",
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    summary: "",
  });
  const journal = new AssistantActionJournal(store, Date.now);
  const projectIds: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const folder = join(directory, `project-${index}`);
    mkdirSync(folder);
    projectIds.push((await store.addProject(folder, `Project ${index}`)).id);
  }
  // The newest row alone touches nine projects: any source cap would hide it and everything after.
  for (const [index, ids] of [[projectIds], ...projectIds.map((id) => [[id]])].entries())
    await journal.runAutonomous(
      {
        operationId: `operation-${index}`,
        action: "sessions.manage",
        target: "session",
        jobId: `job-${index}`,
        projectIds: ids[0] as string[],
      },
      async () => ({ state: "unknown" }),
    );
  let scopes: { projects: string[] }[] = [];
  const ports = {
    manualProjectVisible: async () => true,
    withRoomResponseDisclosure: async (
      requested: { projects: string[] }[],
      _admission: RoomManagementAdmission,
      effect: (valid: () => boolean) => Promise<unknown>,
    ) => {
      scopes = requested;
      return effect(() => true);
    },
  } as unknown as AssistantPorts;
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: "a".repeat(64),
    authorized: async () => true,
  };
  const history = await journal.activity(50, ports, admission, "thread");
  expect(history).toHaveLength(10);
  expect(new Set(scopes.flatMap((scope) => scope.projects)).size).toBe(9);
});
