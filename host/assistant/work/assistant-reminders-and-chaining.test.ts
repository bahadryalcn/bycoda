import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import {
  AssistantRequestSchema,
  AssistantResponseSchema,
} from "../../../src/shared/model/host-contracts/assistant";
import { assistantPushAllowed, assistantPushMessage } from "../../push/push-assistant";

const cleanups: Array<() => Promise<void>> = [];
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
  const dir = mkdtempSync(join(tmpdir(), "bycoda-assistant-extras-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  const service = new HostAssistant(store, {
    listProjects: async () => [{ id: "project", path: dir, name: "Test" }],
    ...ports,
  });
  await service.ready;
  const request = (input: unknown) => service.request(input, "owner");
  const snap = (await request({ op: "snapshot" })).snapshot!;
  await request({
    op: "profile.update",
    expectedVersion: snap.profile.version,
    patch: {
      name: "Test",
      autonomy: "jobs",
      dailyTokenBudget: 100000,
      setupComplete: true,
      enabled: true,
      execution,
    },
  });
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { service, request };
}
const notifications = async (f: Awaited<ReturnType<typeof setup>>) =>
  (await f.request({ op: "snapshot" })).snapshot!.notifications ?? [];

describe("reminders", () => {
  it("creates idempotently, validates the time, fires once", async () => {
    let now = 1_000_000;
    const f = await setup({ now: () => now });
    const create = { op: "reminders.create", text: "Call Sam", at: now + 60_000, requestId: "r1" };
    expect(AssistantRequestSchema.safeParse(create).success).toBe(true);
    const created = (await f.request(create)).reminders!;
    expect(created.reminder).toMatchObject({ text: "Call Sam", status: "pending" });
    expect((await f.request(create)).reminders!.items).toHaveLength(1);
    await expect(f.request({ ...create, text: "Other" })).rejects.toThrow("preserve");
    await expect(f.request({ ...create, requestId: "r2", at: now - 1 })).rejects.toThrow("future");
    await expect(
      f.request({ ...create, requestId: "r3", at: now + 400 * 86_400_000 }),
    ).rejects.toThrow("year");
    await f.service.tick();
    expect(await notifications(f)).toEqual([]);
    now += 61_000;
    await f.service.tick();
    await f.service.tick();
    const fired = (await notifications(f)).filter((n) => n.kind === "reminder");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ title: "Reminder", body: "Call Sam" });
    expect(AssistantResponseSchema.safeParse(await f.request({ op: "snapshot" })).success).toBe(
      true,
    );
    expect((await f.request({ op: "reminders.list" })).reminders!.items).toEqual([]);
  });
  it("cancels with the expected version", async () => {
    const f = await setup({ now: () => 1_000_000 });
    const { reminder } = (
      await f.request({ op: "reminders.create", text: "Stretch", at: 2_000_000, requestId: "c1" })
    ).reminders!;
    await expect(
      f.request({
        op: "reminders.cancel",
        id: reminder!.id,
        expectedVersion: reminder!.version + 1,
      }),
    ).rejects.toThrow("changed");
    const after = await f.request({
      op: "reminders.cancel",
      id: reminder!.id,
      expectedVersion: reminder!.version,
    });
    expect(after.reminders!.items).toEqual([]);
  });
  it("is owner-only", async () => {
    const f = await setup();
    await expect(
      f.service.request(
        { op: "reminders.create", text: "x", at: Date.now() + 5000, requestId: "o" },
        "assistant",
      ),
    ).rejects.toThrow("owner");
  });
  it("is eligible for push and carries its kind", () => {
    const notification = {
      id: "reminder:1",
      kind: "reminder" as const,
      title: "Reminder",
      body: "Call Sam",
      createdAt: 1,
      eligible: true,
      deferredReason: null,
    };
    const recipient = {
      pushToken: "t",
      title: "bycoda",
      texts: { assistant: "x" },
      events: { assistant: true },
      assistantUrgentDuringQuiet: false,
    } as never;
    expect(assistantPushAllowed(notification, recipient)).toBe(true);
    expect(assistantPushMessage(recipient, notification, "env").data).toMatchObject({
      assistantKind: "reminder",
    });
  });
});

describe("job chaining", () => {
  const job = (key: string, title: string, after?: string) => ({
    op: "jobs.create",
    title,
    request: `Do ${title}`,
    projectId: "project",
    idempotencyKey: key,
    ...(after ? { after } : {}),
  });
  function chain() {
    const status = new Map<string, "running" | "done" | "failed" | "cancelled">();
    const submitted: string[] = [];
    return {
      status,
      submitted,
      ports: {
        createGoal: async ({ job }: { job: { id: string; title: string } }) => {
          submitted.push(job.title);
          status.set(job.id, "running");
          return { goalId: `goal-${job.id}` };
        },
        goalStatus: async (goalId: string) => ({
          status: status.get(goalId.slice("goal-".length)) ?? "running",
          taskIds: [],
          sessionIds: [],
          progress: { done: 0, total: 1 },
        }),
      } as AssistantPorts,
    };
  }
  it("keeps the later job queued until the earlier one is done", async () => {
    const c = chain();
    const f = await setup(c.ports);
    const a = (await f.request(job("a", "A"))).job!;
    const b = (await f.request(job("b", "B", a.id))).job!;
    expect(b.status).toBe("queued");
    await f.service.tick();
    expect(c.submitted).toEqual(["A"]);
    const held = (await f.request({ op: "snapshot" })).snapshot!;
    expect(held.jobHolds).toEqual({ [b.id]: "dependency" });
    expect(AssistantResponseSchema.safeParse({ snapshot: held }).success).toBe(true);
    c.status.set(a.id, "done");
    await f.service.tick();
    await f.service.tick();
    expect(c.submitted).toEqual(["A", "B"]);
  });
  it("holds with one notification when the earlier job fails", async () => {
    const c = chain();
    const f = await setup(c.ports);
    const a = (await f.request(job("a", "Build"))).job!;
    const b = (await f.request(job("b", "Deploy", a.id))).job!;
    await f.service.tick();
    c.status.set(a.id, "failed");
    await f.service.tick();
    await f.service.tick();
    await f.service.tick();
    expect(c.submitted).toEqual(["Build"]);
    const waiting = (await notifications(f)).filter((n) => n.jobId === b.id);
    expect(waiting.map((n) => [n.kind, n.body])).toEqual([
      ["job.waiting", "Waiting for Build, which failed."],
    ]);
    const holds = (await f.request({ op: "snapshot" })).snapshot!.jobHolds;
    expect(holds?.[b.id]).toBe("dependency");
  });
  it("says the earlier job was cancelled", async () => {
    const c = chain();
    const f = await setup(c.ports);
    const a = (await f.request(job("a", "Build"))).job!;
    await f.request(job("b", "Deploy", a.id));
    await f.service.tick();
    c.status.set(a.id, "cancelled");
    await f.service.tick();
    await f.service.tick();
    expect((await notifications(f)).map((n) => n.body)).toContain(
      "Waiting for Build, which was cancelled.",
    );
  });
  it("rejects an unknown dependency and keeps retries idempotent", async () => {
    const f = await setup(chain().ports);
    await expect(f.request(job("x", "X", "missing"))).rejects.toThrow("not found");
    const a = (await f.request(job("a", "A"))).job!;
    const b = (await f.request(job("b", "B", a.id))).job!;
    expect((await f.request(job("b", "B", a.id))).job!.id).toBe(b.id);
  });
});
