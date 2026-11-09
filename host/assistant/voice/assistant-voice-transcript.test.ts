import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";
import { assistantDomain } from "../../domains/assistant/service";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
it("accepts both voice display roles through the actual owner RPC domain while retaining session scope and all mutation authority gates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-voice-rpc-")),
    store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const first = await store.addProject(directory, "First"),
    other = await store.addProject(join(directory, "other"), "Other"),
    service = new HostAssistant(store, {
      listProjects: async () =>
        (await store.projects()).map((project) => ({
          id: project.id,
          path: project.cwd,
          name: project.name,
        })),
    });
  await service.ready;
  closes.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.save(
    {
      projectId: first.id,
      revision: 1,
      status: "idle",
      updatedAt: 1,
      session: {
        id: "host-session",
        cwd: first.cwd,
        harness: "codex",
        model: "test",
        modelSettings: {},
        runtimeMode: "supervised",
        title: "Host source",
        blocks: [],
      },
    },
    {},
  );
  const rpc = assistantDomain(service, store),
    context = { principalId: "paired-owner-device", authorized: async () => true },
    thread = (await rpc({ op: "threads.open", projectId: first.id }, context)).thread!;
  const append = {
    op: "threads.append",
    threadId: thread.id,
    via: "voice",
    sessionId: "host-session",
    text: "Voice history",
    idempotencyKey: "voice-user",
    role: "user",
  };
  const user = (await rpc(append, context)).message!,
    assistant = (
      await rpc({ ...append, role: "assistant", idempotencyKey: "voice-assistant" }, context)
    ).message!;
  expect(user).toMatchObject({
    role: "user",
    via: "voice",
    sessionId: "host-session",
    projectIds: [first.id],
  });
  expect(assistant).toMatchObject({ role: "assistant", via: "voice", sessionId: "host-session" });
  expect(assistant).not.toHaveProperty("projectIds");
  expect(
    (await rpc({ ...append, role: "assistant", idempotencyKey: "voice-assistant" }, context))
      .message!.id,
  ).toBe(assistant.id);
  expect(
    (await rpc({ op: "threads.messages", threadId: thread.id }, context)).messages?.map(
      (message) => message.role,
    ),
  ).toEqual(["user", "assistant"]);
  await expect(
    rpc({ ...append, role: "assistant", via: "text", idempotencyKey: "typed-forgery" }, context),
  ).rejects.toThrow("captured principal");
  await expect(
    rpc(
      { ...append, sessionId: "local-native-only-id", idempotencyKey: "unknown-session" },
      context,
    ),
  ).rejects.toThrow("not available on this Host");
  const foreign = (await rpc({ op: "threads.open", projectId: other.id }, context)).thread!;
  await expect(
    rpc({ ...append, threadId: foreign.id, idempotencyKey: "foreign-thread" }, context),
  ).rejects.toThrow("another project's thread");
  const global = (await rpc({ op: "threads.open" }, context)).thread!;
  expect(
    (
      await rpc(
        { ...append, threadId: global.id, role: "assistant", idempotencyKey: "global-voice" },
        context,
      )
    ).message?.sessionId,
  ).toBe("host-session");
  await rpc(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Voice fixture",
        enabled: true,
        setupComplete: true,
        autonomy: "report",
        dailyTokenBudget: 100000,
      },
    },
    context,
  );
  const job = (
    await rpc(
      {
        op: "jobs.create",
        title: "Other project",
        request: "Track this known source",
        projectId: other.id,
        idempotencyKey: "other-job",
      },
      context,
    )
  ).job!;
  await expect(
    rpc({ ...append, jobIds: [job.id], idempotencyKey: "foreign-job-thread" }, context),
  ).rejects.toThrow("another thread scope");
  await expect(
    rpc(
      { ...append, threadId: global.id, jobIds: ["unknown-job"], idempotencyKey: "unknown-job" },
      context,
    ),
  ).rejects.toThrow("not found");
  expect(
    (
      await rpc(
        {
          ...append,
          threadId: global.id,
          jobIds: [job.id],
          idempotencyKey: "cross-project-global",
        },
        context,
      )
    ).message!.projectIds?.sort(),
  ).toEqual([first.id, other.id].sort());
  await expect(rpc({ ...append, principal: "chief" }, context)).rejects.toThrow();
  await expect(
    rpc({ ...append, author: { kind: "assistant-manual", supervisionId: "forged" } }, context),
  ).rejects.toThrow();
  await expect(
    rpc(
      { ...append, idempotencyKey: "unauthorized" },
      { ...context, authorized: async () => false },
    ),
  ).rejects.toThrow();
  expect(
    await store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='assistant_manual_supervision'")
      .get(),
  ).toBeUndefined();
  expect((await store.session("host-session")).session.blocks).toEqual([]);
  expect((await store.session("host-session")).managedBy).toBeUndefined();
});
