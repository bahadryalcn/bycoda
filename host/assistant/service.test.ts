import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { HostAssistant, type AssistantPorts } from "./service";
import { AssistantResponseSchema } from "../../src/shared/model/host-contracts/assistant";
import { chiefContextAction, tokenBudgetMode, workerContextAction } from "./cost";
import { AssistantModelsHeldError } from "./models/assistant-model-execution";
import { AssistantTextPreflightError } from "./core/assistant-text-budget";

it("reads the profile alone, without Room history that needs project disclosure", async () => {
  const f = await setup({});
  await f.request({ op: "threads.open" });
  const response = await f.request({ op: "profile.get" });
  expect(Object.keys(response)).toEqual(["profile"]);
  expect(response.profile).toEqual((await f.request({ op: "snapshot" })).snapshot!.profile);
});
it("refunds only a known zero-provider reply refusal, retains the owner message and never retries that intent", async () => {
  let calls = 0;
  const f = await setup({
    reply: async () => {
      calls++;
      throw new AssistantTextPreflightError();
    },
  });
  await f.configure("report", 20000);
  const thread = (await f.request({ op: "threads.open" })).thread!;
  const input = {
    op: "threads.send",
    threadId: thread.id,
    via: "text",
    text: "Keep my exact text",
    idempotencyKey: "preflight",
  };
  await expect(f.request(input)).rejects.toThrow("review reservation");
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
  await f.restart();
  await expect(f.request(input)).rejects.toThrow("review reservation");
  expect(calls).toBe(1);
  expect(
    (await f.request({ op: "threads.messages", threadId: thread.id })).messages?.map(
      (message) => message.text,
    ),
  ).toEqual([input.text]);
});
it("holds a reply reservation after accepted or uncertain output failure instead of refunding unknown usage", async () => {
  let calls = 0;
  const f = await setup({
    reply: async () => {
      calls++;
      throw new Error("local text allowance; provider usage uncertain");
    },
  });
  await f.configure("report", 20000);
  const thread = (await f.request({ op: "threads.open" })).thread!,
    input = {
      op: "threads.send",
      threadId: thread.id,
      via: "text",
      text: "Status?",
      idempotencyKey: "uncertain-output",
    };
  await expect(f.request(input)).rejects.toThrow("provider usage uncertain");
  const usage = (await f.request({ op: "snapshot" })).snapshot!.usage;
  expect(usage.total).toBeGreaterThan(0);
  expect(usage.estimated).toBe(true);
  await f.restart();
  const profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { perWakeTokenCap: profile.perWakeTokenCap + 1000 },
  });
  await expect(f.request(input)).rejects.toThrow("uncertain outcome");
  expect(calls).toBe(1);
});
it("retries a known zero-provider refusal only after changed capacity and reuses the exact canonical owner message", async () => {
  let calls = 0;
  const f = await setup({
    reply: async (input) => {
      calls++;
      if (calls === 1) throw new AssistantTextPreflightError();
      expect(input.messages.at(-1)?.text).toBe("Original exact request");
      return { text: "Now fits", tokens: 7 };
    },
  });
  await f.configure("report", 100000);
  const thread = (await f.request({ op: "threads.open" })).thread!,
    input = {
      op: "threads.send",
      threadId: thread.id,
      via: "text",
      text: "Original exact request",
      idempotencyKey: "capacity-retry",
    };
  await expect(f.request(input)).rejects.toThrow("review reservation");
  const original = (await f.request({ op: "threads.messages", threadId: thread.id })).messages![0];
  await f.restart();
  await expect(f.request(input)).rejects.toThrow("review reservation");
  expect(calls).toBe(1);
  const profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { perWakeTokenCap: profile.perWakeTokenCap + 1000 },
  });
  expect((await f.request(input)).messages?.map((message) => message.text)).toEqual([
    input.text,
    "Now fits",
  ]);
  const messages = (await f.request({ op: "threads.messages", threadId: thread.id })).messages!;
  expect(messages).toHaveLength(2);
  expect(messages[0].id).toBe(original.id);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(7);
  await f.request(input);
  expect(calls).toBe(2);
});
it("never resurrects a deleted owner message when a refused reply gets more capacity", async () => {
  let calls = 0;
  const f = await setup({
    reply: async () => {
      calls++;
      throw new AssistantTextPreflightError();
    },
  });
  await f.configure("report", 100000);
  const thread = (await f.request({ op: "threads.open" })).thread!,
    input = {
      op: "threads.send",
      threadId: thread.id,
      via: "voice",
      text: "Exact captured owner text",
      idempotencyKey: "deleted-refusal",
    };
  await expect(f.request(input)).rejects.toThrow();
  const user = (await f.request({ op: "threads.messages", threadId: thread.id })).messages![0];
  await f.request({ op: "messages.delete", id: user.id, expectedVersion: user.version });
  const profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { perWakeTokenCap: profile.perWakeTokenCap + 1000 },
  });
  await expect(f.request(input)).rejects.toThrow();
  expect(calls).toBe(1);
  expect((await f.request({ op: "threads.messages", threadId: thread.id })).messages).toEqual([]);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
});
it("allows an explicit reply model change only for known zero-provider refusal and still preserves source and via", async () => {
  let calls = 0;
  const f = await setup({
    reply: async (input) => {
      calls++;
      if (calls === 1) throw new AssistantTextPreflightError();
      expect(input.profile.replyExecution?.model).toBe("new-owner-choice");
      return { text: "Ready", tokens: 3 };
    },
  });
  await f.configure("report", 100000);
  const thread = (await f.request({ op: "threads.open" })).thread!,
    input = {
      op: "threads.send",
      threadId: thread.id,
      via: "text",
      text: "Owner request",
      idempotencyKey: "role-refusal",
    };
  await expect(f.request(input)).rejects.toThrow();
  const profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { replyExecution: { ...execution, model: "new-owner-choice" } },
  });
  await expect(f.request({ ...input, via: "voice" })).rejects.toThrow("payload changed");
  expect(calls).toBe(1);
  await f.request(input);
  expect(calls).toBe(2);
  expect((await f.request({ op: "threads.messages", threadId: thread.id })).messages).toHaveLength(
    2,
  );
});

const cleanups: (() => Promise<void>)[] = [];
it("admits a separately configured reply model without requiring a worker model or dispatching project work", async () => {
  let calls = 0;
  const f = await setup({
    reply: async ({ profile }) => {
      calls++;
      expect(profile.execution).toBeNull();
      expect(profile.replyExecution?.model).toBe("reply-only-model");
      return { text: "Ready", tokens: 9 };
    },
  });
  await f.configure("report", 20000);
  let profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { execution: null, replyExecution: null },
  });
  const thread = (await f.request({ op: "threads.open" })).thread!;
  const input = {
    op: "threads.send",
    threadId: thread.id,
    via: "text",
    text: "Reply briefly",
    idempotencyKey: "reply-role-only",
  };
  await expect(f.request(input)).rejects.toThrow("Configure and enable");
  expect((await f.request({ op: "threads.messages", threadId: thread.id })).messages).toEqual([]);
  expect(calls).toBe(0);
  profile = (await f.request({ op: "snapshot" })).snapshot!.profile;
  await f.request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { replyExecution: { ...execution, model: "reply-only-model" } },
  });
  expect((await f.request(input)).messages?.at(-1)?.text).toBe("Ready");
  await f.request(input);
  expect(calls).toBe(1);
  const snapshot = (await f.request({ op: "snapshot" })).snapshot!;
  expect(snapshot.profile).toMatchObject({
    execution: null,
    autonomy: "report",
    dailyTokenBudget: 20000,
  });
  expect(snapshot.jobs).toEqual([]);
  expect(snapshot.usage.total).toBe(9);
});

it("preserves worker reservations while settling a Chief conversation reservation", async () => {
  let reserve!: (input: { requestId: string; estimatedTokens: number }) => Promise<void>;
  const f = await setup({
    reply: async () => {
      await reserve({ requestId: "worker-effect", estimatedTokens: 500 });
      return { text: "Recorded", tokens: 10 };
    },
  });
  reserve = (input) => f.service.reserveSessionTokens(input);
  await f.configure("chief");
  const thread = (await f.request({ op: "threads.open" })).thread!;
  await f.request({
    op: "threads.send",
    threadId: thread.id,
    via: "text",
    text: "Status?",
    idempotencyKey: "turn-1",
  });
  const usage = (await f.request({ op: "snapshot" })).snapshot!.usage;
  expect(usage.workerTokens).toBe(500);
  expect(usage.chiefTokens).toBe(10);
  expect(usage.total).toBe(510);
});
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const execution = {
  harness: "codex" as const,
  model: "test-model",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
};
async function setup(ports: AssistantPorts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-assistant-"));
  const path = join(dir, "host.db");
  let store = new HostStore(path);
  await store.ready;
  let service = new HostAssistant(store, {
    listProjects: async () => [{ id: "project", path: dir, name: "Test" }],
    ...ports,
  });
  await service.ready;
  const f = {
    dir,
    path,
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    request: (input: unknown, principal: "owner" | "assistant" | "chief" = "owner") =>
      service.request(input, principal),
    restart: async () => {
      await service.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      service = new HostAssistant(store, {
        listProjects: async () => [{ id: "project", path: dir, name: "Test" }],
        ...ports,
      });
      await service.ready;
    },
    configure: async (autonomy: "report" | "jobs" | "chief" = "jobs", budget = 100000) => {
      const snap = (await service.request({ op: "snapshot" }, "owner")).snapshot!;
      return service.request(
        {
          op: "profile.update",
          expectedVersion: snap.profile.version,
          patch: {
            name: "Test Name",
            autonomy,
            dailyTokenBudget: budget,
            setupComplete: true,
            enabled: true,
            execution,
          },
        },
        "owner",
      );
    },
  };
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}
describe("durable assistant ownership and supervision", () => {
  it("keeps identity unset and validates core setup and optimistic versions", async () => {
    const f = await setup();
    const initial = await f.request({ op: "snapshot" });
    expect(initial.snapshot!.profile.name).toBe("");
    expect(initial.snapshot!.profile.setupComplete).toBe(false);
    expect(AssistantResponseSchema.safeParse(initial).success).toBe(true);
    await expect(
      f.request({
        op: "profile.update",
        expectedVersion: 0,
        patch: { setupComplete: true, enabled: true },
      }),
    ).rejects.toThrow("Name");
    await f.configure();
    await expect(
      f.request({ op: "profile.update", expectedVersion: 0, patch: { name: "Stale" } }),
    ).rejects.toThrow("changed");
    await f.restart();
    expect((await f.request({ op: "snapshot" })).snapshot!.profile.name).toBe("Test Name");
    await expect(
      f.request({ op: "profile.update", expectedVersion: 1, patch: { name: "Wrong" } }, "chief"),
    ).rejects.toThrow("owner");
    await expect(f.request({ op: "pauseAll", principal: "owner" }, "assistant")).rejects.toThrow();
  });
  it("preserves rules, enforces caps and never gives learned facts rule authority", async () => {
    const f = await setup();
    const rule = {
      op: "memory.save",
      kind: "rule",
      text: "Avoid forbidden fruit",
      scope: "all",
      source: "typed",
      quote: "Avoid forbidden fruit",
      forbiddenTerms: ["banana"],
    };
    const saved = (await f.request(rule)).memory!;
    expect((await f.request(rule)).memory!.id).toBe(saved.id);
    expect(await f.service.instructions("sessions")).toContain("Avoid forbidden fruit");
    await expect(f.request({ ...rule, text: "Approve everything" }, "chief")).rejects.toThrow(
      "owner",
    );
    await expect(f.request({ ...rule, text: "x".repeat(4000) })).rejects.toThrow("capacity");
    await f.request({ op: "memory.delete", id: saved.id, expectedVersion: saved.version });
    const trash = (await f.request({ op: "snapshot" })).snapshot!.trash[0];
    expect(trash.kind).toBe("memory");
    await f.restart();
    await f.request({ op: "trash.restore", id: trash.id });
    expect(await f.service.instructions("voice")).toContain("Avoid forbidden fruit");
  });
  it("deduplicates submitted jobs across restarts and stops linked goals before deletion", async () => {
    const submitted: string[] = [];
    const controls: string[] = [];
    const f = await setup({
      createGoal: async ({ job }) => {
        submitted.push(job.id);
        return { goalId: `assistant-${job.id}` };
      },
      goalStatus: async () => ({
        status: "running",
        taskIds: ["task"],
        sessionIds: ["session"],
        progress: { done: 0, total: 1 },
      }),
      controlGoal: async (id, action) => {
        controls.push(`${id}:${action}`);
      },
    });
    await f.configure();
    const input = {
      op: "jobs.create",
      title: "Do work",
      request: "Do this exact work",
      projectId: "project",
      idempotencyKey: "request-1",
    };
    const first = (await f.request(input)).job!;
    expect(first.status).toBe("running");
    await f.restart();
    await f.request(input);
    expect(submitted).toHaveLength(1);
    await expect(f.request({ ...input, request: "Changed retry" })).rejects.toThrow("preserve");
    const job = (await f.request({ op: "snapshot" })).snapshot!.jobs[0];
    await f.request({
      op: "jobs.control",
      id: job.id,
      expectedVersion: job.version,
      action: "delete",
    });
    expect(controls).toEqual([`assistant-${job.id}:stop`]);
    expect((await f.request({ op: "snapshot" })).snapshot!.jobs).toHaveLength(0);
  });
  it("reconciles ambiguous dispatch by stable identity without replaying the planner", async () => {
    let creates = 0;
    let recovered = false;
    const f = await setup({
      createGoal: async () => {
        creates++;
        throw new Error("transport lost after commit");
      },
      findGoal: async () => (recovered ? { goalId: "stable-goal" } : undefined),
    });
    await f.configure();
    const job = (
      await f.request({
        op: "jobs.create",
        title: "Night work",
        request: "Night work",
        projectId: "project",
        idempotencyKey: "uncertain",
      })
    ).job!;
    expect(job.dispatchState).toBe("unknown");
    await f.restart();
    recovered = true;
    await f.service.tick();
    expect(creates).toBe(1);
    expect((await f.request({ op: "snapshot" })).snapshot!.jobs[0].goalId).toBe("stable-goal");
  });
  it("persists scoped transcripts and enforces message authorship and retry identity", async () => {
    const f = await setup();
    const thread = (await f.request({ op: "threads.open", projectId: "project" })).thread!;
    const input = {
      op: "threads.append",
      threadId: thread.id,
      role: "user",
      via: "voice",
      text: "Keep this",
      idempotencyKey: "speech-1",
    };
    await f.request(input);
    await f.request(input);
    await f.restart();
    expect(
      (await f.request({ op: "threads.messages", threadId: thread.id })).messages,
    ).toHaveLength(1);
    await expect(f.request({ ...input, role: "assistant", via: "text" })).rejects.toThrow(
      "authorship",
    );
    await expect(f.request({ ...input, text: "Different" })).rejects.toThrow("preserve");
    const matches = await f.request({
      op: "conversations.search",
      query: "Keep",
      threadId: thread.id,
    });
    expect(matches.messages).toHaveLength(1);
    const message = matches.messages![0];
    await f.request({ op: "messages.delete", id: message.id, expectedVersion: message.version });
    expect((await f.request({ op: "conversations.search", query: "Keep" })).messages).toHaveLength(
      0,
    );
  });
  it("runs real reply ports once, records budget provenance, filters forbidden terms", async () => {
    let calls = 0;
    const f = await setup({
      reply: async () => {
        calls++;
        return { text: "A banana suggestion" };
      },
    });
    await f.configure();
    await f.request({
      op: "memory.save",
      kind: "rule",
      text: "Avoid one fruit",
      scope: "all",
      source: "typed",
      forbiddenTerms: ["banana"],
    });
    const thread = (await f.request({ op: "threads.open" })).thread!;
    const input = {
      op: "threads.send",
      threadId: thread.id,
      via: "text",
      text: "A suggestion",
      idempotencyKey: "send1",
    };
    const result = await f.request(input);
    expect(result.messages![1].text).not.toContain("banana");
    await f.restart();
    await f.request(input);
    expect(calls).toBe(1);
    const snapshot = (await f.request({ op: "snapshot" })).snapshot!;
    expect(snapshot.usage.total).toBe(8000);
    expect(snapshot.usage.estimated).toBe(true);
  });
  it("keeps notebook failures separate from core snapshot and stores recoverable note deletion copies", async () => {
    let note = {
      id: "note",
      title: "A note",
      body: "Owner content",
      tags: ["assistant"],
      createdAt: 1,
      updatedAt: 2,
    };
    let exists = true;
    const f = await setup({
      listNotes: async () => (exists ? [note] : []),
      deleteNote: async () => {
        exists = false;
      },
      saveNote: async (input) => {
        exists = true;
        note = { ...note, ...input, id: input.id ?? "note", updatedAt: 3 };
        return note;
      },
    });
    await f.request({ op: "notes.delete", id: "note", expectedUpdatedAt: 2 });
    expect(exists).toBe(false);
    const trash = (await f.request({ op: "snapshot" })).snapshot!.trash[0];
    expect(trash.kind).toBe("notetrash");
    await f.restart();
    await f.request({ op: "trash.restore", id: trash.id });
    expect(note.body).toBe("Owner content");
    expect(exists).toBe(true);
    const unavailable = await setup({
      listNotes: async () => {
        throw new Error("No desktop database");
      },
    });
    const snapshot = (await unavailable.request({ op: "snapshot" })).snapshot!;
    expect(snapshot.capabilities.notes).toBe(false);
    expect(snapshot.notesError).toContain("No desktop database");
  });
  it("holds notifications while away and persists a welcome-back briefing only on a real return", async () => {
    let now = Date.parse("2026-11-02T01:00:00Z");
    const f = await setup({ now: () => now });
    await f.request({ op: "presence.set", state: "away" });
    now += 40 * 60000;
    await f.request({
      op: "memory.save",
      kind: "fact",
      text: "A learned fact",
      scope: "all",
      source: "typed",
    });
    expect((await f.request({ op: "snapshot" })).snapshot!.briefing).toBeNull();
    await f.request({ op: "presence.set", state: "present" });
    const briefing = (await f.request({ op: "snapshot" })).snapshot!.briefing;
    expect(briefing?.voiceReceipt).toEqual({
      reason: "return",
      returnAt: now,
      meaningful: false,
      important: false,
    });
  });
  it("uses the budget at 80% to prevent new dispatch and counts worker deltas once", async () => {
    let launches = 0;
    const f = await setup({
      createGoal: async () => ({ goalId: `goal-${++launches}` }),
      goalStatus: async () => ({
        status: "running",
        taskIds: [],
        sessionIds: [],
        progress: { done: 0, total: 1 },
        tokens: 8500,
      }),
    });
    await f.configure("jobs", 10000);
    const input = {
      op: "jobs.create",
      title: "First",
      request: "First",
      projectId: "project",
      idempotencyKey: "one",
    };
    await f.request(input);
    await f.service.tick();
    await f.request({ ...input, title: "Second", idempotencyKey: "two" });
    expect(launches).toBe(1);
    const usage = (await f.request({ op: "snapshot" })).snapshot!.usage;
    expect(usage.total).toBe(8500);
    expect(usage.mode).toBe("report");
  });
  it("preempts an in-flight provider immediately when the owner stops everything", async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const f = await setup({
      reply: async ({ signal }) => {
        started();
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          ),
        );
      },
    });
    await f.configure();
    const thread = (await f.request({ op: "threads.open" })).thread!;
    const sending = f.request({
      op: "threads.send",
      threadId: thread.id,
      via: "text",
      text: "Long thought",
      idempotencyKey: "slow",
    });
    const rejected = expect(sending).rejects.toThrow("aborted");
    await entered;
    await f.request({ op: "pauseAll" });
    await rejected;
    expect(aborted).toBe(true);
    const snapshot = (await f.request({ op: "snapshot" })).snapshot!;
    expect(snapshot.paused).toBe(true);
    expect(snapshot.usage.estimated).toBe(true);
  });
  it("accepts a job without waiting for the Chief's model turn it triggers", async () => {
    let release!: () => void;
    const woke = new Promise<void>((resolve) => (release = resolve));
    const chiefWake = vi.fn(async () => {
      await woke;
      return { tokens: 1, actions: [] };
    });
    const f = await setup({ createGoal: async () => ({ goalId: "goal" }), chiefWake });
    await f.configure("chief");
    const { job } = await f.request({
      op: "jobs.create",
      title: "A job",
      request: "Do work",
      projectId: "project",
      idempotencyKey: "slow-chief",
    });
    expect(job?.goalId).toBe("goal");
    await vi.waitFor(() => expect(chiefWake).toHaveBeenCalledOnce());
    release();
  });
  it("applies a Chief's narrow replan action but rejects approval escalation", async () => {
    let actions = 0;
    const f = await setup({
      createGoal: async () => ({ goalId: "goal" }),
      goalStatus: async () => ({
        status: "waiting",
        taskIds: [],
        sessionIds: [],
        progress: { done: 0, total: 1 },
      }),
      replanGoal: async () => {
        actions++;
      },
      chiefWake: async ({ events }) => {
        const jobId = events[0].jobId!;
        const row = await f.store.db
          .prepare("SELECT value FROM assistant_jobs WHERE id=?")
          .get(jobId);
        const job = JSON.parse(row!.value);
        return {
          tokens: 100,
          actions: [
            {
              op: "jobs.replan",
              id: jobId,
              expectedVersion: job.version,
              feedback: "Resolve the blocked task",
            },
          ],
        };
      },
    });
    await f.configure("chief");
    await f.request({
      op: "jobs.create",
      title: "A job",
      request: "Do work",
      projectId: "project",
      idempotencyKey: "chief-job",
    });
    await vi.waitFor(() => expect(actions).toBe(1));
    await expect(f.request({ op: "resumeAll" }, "chief")).rejects.toThrow("owner");
  });
});
describe("job attention", () => {
  const create = {
    op: "jobs.create",
    title: "Stuck job",
    request: "Do work",
    projectId: "project",
    idempotencyKey: "attention",
  };
  const kinds = async (f: Awaited<ReturnType<typeof setup>>) =>
    ((await f.request({ op: "snapshot" })).snapshot!.notifications ?? [])
      .filter((n) => n.kind !== "briefing") // the daily briefing follows the wall clock
      .map((n) => [n.kind, n.body]);
  it("notifies once when a job stalls", async () => {
    let now = 1_000_000;
    const f = await setup({
      now: () => now,
      createGoal: async () => ({ goalId: "goal" }),
      goalStatus: async () => ({
        status: "running",
        taskIds: [],
        sessionIds: [],
        progress: { done: 0, total: 1 },
        lastActivityAt: now - 20 * 60000,
        summary: "Compiling",
      }),
    });
    await f.configure();
    await f.request(create);
    await f.service.tick();
    await f.service.tick();
    expect(await kinds(f)).toEqual([["job.stalled", "No output for 15 minutes. Compiling"]]);
    const response = await f.request({ op: "snapshot" });
    expect(response.snapshot).toHaveProperty("jobHolds");
    expect(AssistantResponseSchema.safeParse(response).success).toBe(true);
    now += 60000;
    await f.service.tick();
    expect(await kinds(f)).toHaveLength(1);
  });
  it("says why a blocked goal is waiting", async () => {
    const f = await setup({
      createGoal: async () => ({ goalId: "goal" }),
      goalStatus: async () => ({
        status: "waiting",
        waitingReason: "error",
        summary: "Planner crashed",
        taskIds: [],
        sessionIds: [],
        progress: { done: 0, total: 1 },
      }),
    });
    await f.configure();
    await f.request(create);
    await f.service.tick();
    expect(await kinds(f)).toEqual([["job.waiting", "Stopped with an error: Planner crashed"]]);
  });
  it("reports why a queued job is not starting", async () => {
    const f = await setup({ createGoal: async () => ({ goalId: "goal" }) });
    await f.configure("report");
    const job = (await f.request(create)).job!;
    const asked = (await f.request({ op: "snapshot" })).snapshot!;
    expect(asked.jobHolds).toEqual({ [job.id]: "report" });
  });
  describe("model pool holds", () => {
    const holds = async (f: Awaited<ReturnType<typeof setup>>) =>
      (await f.request({ op: "snapshot" })).snapshot!;
    it("keeps a held job queued, notifies once per reset window and clears after start", async () => {
      let now = 1_000_000;
      let error: Error | null = new AssistantModelsHeldError("limits", 2_000_000);
      const f = await setup({
        now: () => now,
        createGoal: async () => {
          if (error) throw error;
          return {
            goalId: "goal",
            modelChoice: {
              rowId: "b",
              reason: "skipped:a,c",
              model: "m2",
              providerAccountId: "acc",
            },
          };
        },
        goalStatus: async () => ({
          status: "running",
          taskIds: [],
          sessionIds: [],
          progress: { done: 0, total: 1 },
        }),
      });
      await f.configure();
      const job = (await f.request(create)).job!;
      await f.service.tick();
      let snap = await holds(f);
      expect(snap.jobs.find((item) => item.id === job.id)?.status).toBe("queued");
      expect(snap.jobHolds).toEqual({ [job.id]: "limits" });
      const waiting = () => snap.notifications?.filter((n) => n.kind === "job.waiting") ?? [];
      expect(waiting().map((n) => n.body)).toEqual([
        `All models in the pool are at their limit until ${new Date(2_000_000).toISOString()}.`,
      ]);
      now += 1000;
      await f.service.tick();
      snap = await holds(f);
      expect(waiting()).toHaveLength(1);
      error = new AssistantModelsHeldError("limits", 3_000_000);
      await f.service.tick();
      snap = await holds(f);
      expect(waiting()).toHaveLength(2);
      error = null;
      await f.service.tick();
      snap = await holds(f);
      expect(snap.jobHolds).toEqual({});
      expect(JSON.stringify(snap.activity)).toContain(
        "Using m2 (account acc): skipped 2 rows below their limit",
      );
    });
    it("reports noModel when the pool has no row for the role", async () => {
      const f = await setup({
        createGoal: async () => {
          throw new AssistantModelsHeldError("noRow");
        },
      });
      await f.configure();
      const job = (await f.request(create)).job!;
      await f.service.tick();
      const snap = await holds(f);
      expect(snap.jobHolds).toEqual({ [job.id]: "noModel" });
      expect(snap.notifications?.map((n) => n.body)).toContain(
        "No model in the pool can run this job.",
      );
    });
  });
});
it("uses bounded context actions and the 150k/250k chief defaults", () => {
  expect(workerContextAction(40000, 1000000)).toBe("send");
  expect(workerContextAction(150000, 1000000)).toBe("compact");
  expect(workerContextAction(750000, 1000000)).toBe("handoff");
  expect(workerContextAction(undefined, undefined)).toBe("compact");
  expect(chiefContextAction(150000, 1000000)).toBe("compact");
  expect(chiefContextAction(250000, 1000000)).toBe("rotate");
  expect(chiefContextAction(80000, 100000)).toBe("rotate");
  expect(tokenBudgetMode(799, 1000)).toBe("run");
  expect(tokenBudgetMode(800, 1000)).toBe("report");
  expect(tokenBudgetMode(1000, 1000)).toBe("paused");
});
