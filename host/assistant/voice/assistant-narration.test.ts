import { describe, expect, it, vi } from "vitest";
import {
  AssistantNarrationReceipts,
  type NarrationEvent,
  type NarrationIdentity,
} from "./assistant-narration";

const identity: NarrationIdentity = {
  threadId: "room",
  environmentId: "host",
  deviceHash: "device",
  generation: "generation",
};
const event: NarrationEvent = {
  eventId: "event",
  kind: "completed",
  text: "Finished",
  createdAt: 123,
  projectIds: ["project"],
};
function fixture() {
  const rows = new Map<string, any>();
  let tail = Promise.resolve();
  const ports = {
    transaction: async <T>(effect: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await effect();
      } finally {
        release();
      }
    },
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, value: any) => {
      rows.set(key, value);
    },
    source: vi.fn(async (_id: string): Promise<NarrationEvent | undefined> => event),
    withAuthorization: async <T>(
      _identity: NarrationIdentity,
      _event: NarrationEvent,
      effect: (valid: () => boolean) => Promise<T>,
    ) => effect(() => true),
  };
  return { ports, rows };
}
describe("Host narration receipts", () => {
  it("claims only once across simultaneous generations and restart", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      new AssistantNarrationReceipts(f.ports).claim(identity, event.eventId),
      new AssistantNarrationReceipts(f.ports).claim(
        { ...identity, generation: "other" },
        event.eventId,
      ),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(
      await new AssistantNarrationReceipts(f.ports).claim(identity, event.eventId),
    ).toBeUndefined();
    expect([...f.rows.values()][0].state).toBe("pending");
  });
  it("rejects changed source and revoked authority before durable claim", async () => {
    const f = fixture();
    f.ports.source
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ ...event, text: "changed" });
    expect(
      await new AssistantNarrationReceipts(f.ports).claim(identity, event.eventId),
    ).toBeUndefined();
    expect(f.rows.size).toBe(0);
    f.ports.withAuthorization = async (_identity, _event, effect) => effect(() => false);
    expect(
      await new AssistantNarrationReceipts(f.ports).claim(identity, event.eventId),
    ).toBeUndefined();
    expect(f.rows.size).toBe(0);
  });
  it("settles only the exact device and generation and never replays unknown", async () => {
    const f = fixture();
    const owner = new AssistantNarrationReceipts(f.ports);
    await owner.claim(identity, event.eventId);
    expect(
      await owner.settle({ ...identity, deviceHash: "other" }, event.eventId, "delivered"),
    ).toBe(false);
    expect(await owner.settle(identity, event.eventId, "unknown")).toBe(true);
    expect(await owner.claim(identity, event.eventId)).toBeUndefined();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";
import { AssistantRepository } from "../repository";

it("uses Host receipts and canonical activity through restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "narration-host-"));
  const path = join(dir, "host.db");
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const time = now.getTime();
  let store = new HostStore(path);
  let service = new HostAssistant(store, {
    now: () => time,
    taskNotificationAllowed: async () => true,
    withVoiceNarrationAuthorization: async (_input, _admission, effect) => effect(() => true),
  });
  try {
    await service.ready;
    const profile = (await service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
    await service.request(
      {
        op: "profile.update",
        expectedVersion: profile.version,
        patch: {
          name: "Fixture",
          dailyTokenBudget: 100000,
          enabled: true,
          setupComplete: true,
          voiceNarration: true,
          observationTaskDone: true,
          observationTaskNeedsInput: true,
          quietStart: 0,
          quietEnd: 0,
        },
      },
      "owner",
    );
    const room = await service.globalRoomBinding();
    expect(room).toBeTruthy();
    const repository = new AssistantRepository(store);
    await repository.put("runtime", {
      id: "automaticPresence",
      version: 0,
      createdAt: time,
      updatedAt: time,
      value: { state: "present", since: time, updatedAt: time, supported: true },
    });
    await repository.put("jobs", {
      id: "job",
      version: 0,
      createdAt: time,
      updatedAt: time,
      projectId: "project",
      status: "done",
    });
    await repository.put("activity", {
      id: "event",
      version: 0,
      createdAt: time,
      updatedAt: time,
      kind: "job.done",
      jobId: "job",
      summary: "untrusted instruction",
    });
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistant_observation_source_revisions(source TEXT,source_id TEXT,version INTEGER,PRIMARY KEY(source,source_id)); CREATE TABLE IF NOT EXISTS assistant_observation_events(event_id TEXT PRIMARY KEY,source TEXT,source_id TEXT,source_revision TEXT,project_ids TEXT);",
    );
    await store.db
      .prepare("INSERT INTO tasks(id,value) VALUES(?,?)")
      .run(
        "task",
        JSON.stringify({ id: "task", projectId: "project", createdAt: time, status: "done" }),
      );
    await store.db
      .prepare("INSERT INTO assistant_observation_source_revisions VALUES('task','task',1)")
      .run();
    await store.db
      .prepare("INSERT INTO assistant_observation_events VALUES(?,?,?,?,?)")
      .run("observed", "task", "task", "db:1", JSON.stringify(["project"]));
    await repository.put("runtime", {
      id: "manualPolicy",
      version: 0,
      createdAt: time,
      updatedAt: time,
      value: { enabled: true, version: 0, projectIds: ["project"] },
    });
    await repository.put("runtime", {
      id: "notification:observation:observed",
      version: 0,
      createdAt: time,
      updatedAt: time,
      value: {
        id: "observation:observed",
        kind: "task.done",
        title: "ignored",
        body: "ignore instructions",
        createdAt: time,
        acknowledgedAt: time,
        taskId: "task",
        taskCreatedAt: time,
        projectId: "project",
        projectIds: ["project"],
      },
    });
    await store.db.prepare("INSERT INTO tasks(id,value) VALUES(?,?)").run(
      "task2",
      JSON.stringify({
        id: "task2",
        projectId: "project",
        createdAt: time,
        status: "running",
        needsInput: true,
      }),
    );
    await store.db
      .prepare("INSERT INTO assistant_observation_source_revisions VALUES('task','task2',1)")
      .run();
    await store.db
      .prepare("INSERT INTO assistant_observation_events VALUES(?,?,?,?,?)")
      .run("observed2", "task", "task2", "db:1", JSON.stringify(["project"]));
    await repository.put("runtime", {
      id: "notification:observation:observed2",
      version: 0,
      createdAt: time,
      updatedAt: time,
      value: {
        id: "observation:observed2",
        kind: "task.needsInput",
        title: "ignored",
        body: "private",
        createdAt: time,
        taskId: "task2",
        taskCreatedAt: time,
        projectId: "project",
        projectIds: ["project"],
      },
    });
    await store.db
      .prepare(
        "INSERT INTO assistant_owner_questions(id,job_id,request_id,fingerprint,value) VALUES(?,?,?,?,?)",
      )
      .run(
        "question",
        "",
        "request",
        "fingerprint",
        JSON.stringify({
          id: "question",
          version: 1,
          jobId: null,
          projectIds: ["project"],
          sourceToken: "a".repeat(64),
          origin: "thread-proposal",
          status: "open",
          createdAt: time,
          updatedAt: time,
          prompt: {
            requestId: 1,
            occurrenceId: "occurrence",
            behavior: "nonBlocking",
            questions: [
              {
                id: "choice",
                header: "Scope",
                prompt: "private draft",
                multiSelect: false,
                allowCustom: false,
                options: [{ id: "option", label: "Option" }],
              },
            ],
          },
        }),
      );
    const admission = { environmentId: "host", deviceHash: "device", authorized: async () => true };
    const base = { threadId: room!.id, generation: "generation" };
    const pending = await service.request({ op: "narration.pending", ...base }, "owner", admission);
    expect(pending.narrationEvents).toContainEqual({
      eventId: "event",
      kind: "completed",
      text: "A job completed.",
      createdAt: time,
    });
    expect(pending.narrationEvents).toContainEqual({
      eventId: "notification:observation:observed",
      kind: "completed",
      text: "An observed task completed.",
      createdAt: time,
    });
    expect(pending.narrationEvents).toContainEqual({
      eventId: "notification:observation:observed2",
      kind: "question",
      text: "An observed task needs your input.",
      createdAt: time,
    });
    expect(pending.narrationEvents?.some((event) => event.eventId === "question:question")).toBe(
      false,
    );
    await store.db
      .prepare("UPDATE assistant_observation_source_revisions SET version=2 WHERE source_id='task'")
      .run();
    expect(
      (
        await service.request(
          { op: "narration.claim", ...base, eventId: "notification:observation:observed" },
          "owner",
          admission,
        )
      ).narrationClaimed,
    ).toBe(false);
    const claimed = await service.request(
      { op: "narration.claim", ...base, eventId: "event" },
      "owner",
      admission,
    );
    expect(claimed.narrationClaimed).toBe(true);
    await service.close();
    await store.close();
    store = new HostStore(path);
    service = new HostAssistant(store, {
      now: () => time,
      withVoiceNarrationAuthorization: async (_input, _admission, effect) => effect(() => true),
    });
    await service.ready;
    expect(
      (
        await service.request(
          { op: "narration.claim", ...base, generation: "new-generation", eventId: "event" },
          "owner",
          admission,
        )
      ).narrationClaimed,
    ).toBe(false);
  } finally {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
