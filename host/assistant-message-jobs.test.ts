import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostAssistant } from "./assistant/service";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "assistant-message-jobs-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const a = await store.addProject(join(directory, "a"), "A"),
    b = await store.addProject(join(directory, "b"), "B");
  const core = new HostAssistant(store, {
    listProjects: async () =>
      (await store.projects()).map((project) => ({
        id: project.id,
        path: project.cwd,
        name: project.name,
      })),
  });
  await core.ready;
  cleanup.push(async () => {
    await core.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  await core.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Fixture assistant",
        dailyTokenBudget: 20000,
        enabled: true,
        setupComplete: true,
        autonomy: "report",
      },
    },
    "owner",
  );
  const job = (
    await core.request(
      {
        op: "jobs.create",
        title: "Reviewed work",
        request: "Only this reviewed work",
        projectId: a.id,
        projectIds: [a.id, b.id],
        idempotencyKey: "original-reviewed-key",
      },
      "owner",
    )
  ).job!;
  const thread = (await core.request({ op: "threads.open" }, "owner")).thread!;
  const message = (
    await core.request(
      {
        op: "threads.append",
        threadId: thread.id,
        role: "user",
        via: "voice",
        text: "The accepted owner request",
        idempotencyKey: "owner-turn",
      },
      "owner",
    )
  ).message!;
  return { core, store, a, b, job, thread, message };
}
it("links the exact accepted work once and projects all canonical participant scope", async () => {
  const f = await fixture(),
    input = {
      op: "messages.linkJob",
      id: f.message.id,
      jobId: f.job.id,
      jobKey: f.job.idempotencyKey,
    };
  const first = (await f.core.request(input, "owner")).message!;
  expect(first).toMatchObject({
    id: f.message.id,
    text: f.message.text,
    role: "user",
    jobIds: [f.job.id],
    projectIds: [f.a.id, f.b.id].sort(),
  });
  expect((await f.core.request(input, "owner")).message).toEqual(first);
  const page = await f.core.request({ op: "threads.messages", threadId: f.thread.id }, "owner");
  expect(page.messages?.find((message) => message.id === f.message.id)?.jobIds).toEqual([f.job.id]);
  expect((await f.core.request({ op: "snapshot" }, "owner")).snapshot?.jobs).toHaveLength(1);
});
it("refuses forged receipts, other thread projects and cleared source resurrection", async () => {
  const f = await fixture(),
    input = {
      op: "messages.linkJob",
      id: f.message.id,
      jobId: f.job.id,
      jobKey: f.job.idempotencyKey,
    };
  await expect(f.core.request(input, "assistant")).rejects.toThrow();
  await expect(f.core.request({ ...input, jobKey: "replacement-key" }, "owner")).rejects.toThrow(
    "original accepted job receipt",
  );
  const c = await f.store.addProject("/unrelated-message-job-scope", "C");
  const thread = (await f.core.request({ op: "threads.open", projectId: c.id }, "owner")).thread!;
  const message = (
    await f.core.request(
      {
        op: "threads.append",
        threadId: thread.id,
        role: "user",
        via: "text",
        text: "Different project",
        idempotencyKey: "other-owner-turn",
      },
      "owner",
    )
  ).message!;
  await expect(f.core.request({ ...input, id: message.id }, "owner")).rejects.toThrow(
    "another thread scope",
  );
  await f.core.request(
    { op: "messages.delete", id: f.message.id, expectedVersion: f.message.version },
    "owner",
  );
  await expect(f.core.request(input, "owner")).rejects.toThrow();
});
