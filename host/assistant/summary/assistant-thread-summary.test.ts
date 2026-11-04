import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import { HostAssistantThreadSummaries } from "./assistant-thread-summary";
import { assistantDomain } from "../../domains/assistant/service";
import { AssistantTextPreflightError } from "../core/assistant-text-budget";
import { AssistantResponseValidationSchema } from "../../../src/shared/model/host-contracts/assistant";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const execution = {
  harness: "codex",
  model: "fake-summary-test",
  modelSettings: {},
  runtimeMode: "supervised",
  maxRunMinutes: 60,
};
async function fixture(
  options: {
    project?: boolean;
    visible?: () => Promise<boolean>;
    generate?: NonNullable<AssistantPorts["summarize"]>;
    reply?: AssistantPorts["reply"];
    qualified?: boolean;
  } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), "assistant-summary-")),
    path = join(folder, "host.db");
  let store = new HostStore(path);
  await store.ready;
  const project = await store.addProject(folder, "Actual summary project");
  let now = Date.UTC(2026, 10, 2, 12),
    calls: Parameters<NonNullable<AssistantPorts["summarize"]>>[0][] = [];
  const ports: AssistantPorts = {
    ...(options.reply ? { reply: options.reply } : {}),
    now: () => now,
    listProjects: async () =>
      (await store.projects()).map((p) => ({ id: p.id, path: p.cwd, name: p.name })),
    ...(options.visible ? { manualProjectVisible: async () => options.visible!() } : {}),
    ...(options.qualified ? {
      roomProjectProofsValid: async (proofs: { projectId: string; cwd: string }[]) => (await Promise.all(proofs.map(async proof => (await store.project(proof.projectId)).cwd === proof.cwd))).every(Boolean),
      roomAccountProofsValid: async (_threadId: string, proofs: { accountId: string; version: string }[]) => proofs.every(proof => proof.accountId === "account" && proof.version === "grant-v1"),
      withSummarySourceDisclosure: async <T>(_threadId: string, projectProofs: { projectId: string; cwd: string }[], _accountProofs: { accountId: string; version: string }[], effect: (valid: () => boolean) => Promise<T>) => store.withProjectIdentityRead(projectProofs, effect),
    } : {}),
    summarize: async (input) => {
      calls.push(input);
      return options.generate
        ? options.generate(input)
        : { text: `Verified summary ${calls.length}`, tokens: 17 };
    },
  };
  let service = new HostAssistant(store, ports);
  await service.ready;
  const request = (input: unknown) =>
    assistantDomain(service, store)(input, {
      principalId: "actual-summary-owner",
      authorized: async () => true,
    });
  let profile = (await request({ op: "snapshot" })).snapshot!.profile;
  await request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: {
      name: "Test assistant",
      enabled: true,
      setupComplete: true,
      autonomy: "report",
      dailyTokenBudget: 1000000,
      execution,
      summaryRefreshMessages: 20,
    },
  });
  const thread = (
    await request({ op: "threads.open", ...(options.project ? { projectId: project.id } : {}) })
  ).thread!;
  let seq = 0;
  const append = async (
    text = `Exact accepted message ${seq + 1}`,
    role: "user" | "assistant" = "user",
  ) =>
    (
      await request({
        op: "threads.append",
        threadId: thread.id,
        role,
        via: "voice",
        text,
        idempotencyKey: `message-${++seq}`,
      })
    ).message!;
  const summary = () =>
    (service as unknown as { threadSummaries: HostAssistantThreadSummaries }).threadSummaries;
  const current = async () => {
    const response = await request({ op: "threads.messages", threadId: thread.id });
    expect(AssistantResponseValidationSchema.safeParse(response).success).toBe(true);
    return response.thread!;
  };
  cleanup.push(async () => {
    await service.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    request,
    append,
    current,
    calls,
    ports,
    thread,
    project,
    summary,
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    advance(ms: number) {
      now += ms;
    },
    fill: async (count = 20) => {
      for (let i = 0; i < count; i++) await append();
    },
    restart: async () => {
      await service.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      service = new HostAssistant(store, ports);
      await service.ready;
    },
    patch: async (patch: unknown) => {
      profile = (await request({ op: "snapshot" })).snapshot!.profile;
      return request({ op: "profile.update", expectedVersion: profile.version, patch });
    },
  };
}

it("persists exact source identities for qualified project summaries and rejects a later retarget", async () => {
  const f = await fixture({ project: true, visible: async () => true, qualified: true });
  await f.fill();
  await f.summary().drain();
  const first = await f.current();
  expect(first.summaryProof?.projectIds).toEqual([f.project.id]);
  expect(await f.summary().sourceProofs(f.thread.id, first.summaryProof!.id)).toEqual({ projectProofs: [{ projectId: f.project.id, cwd: f.project.cwd }], accountProofs: [] });
  await f.store.withProjectIdentityWrite(() => f.store.db.prepare("UPDATE projects SET cwd=? WHERE id=?").run(`${f.project.cwd}-new`, f.project.id).then(() => undefined));
  const saved = await f.summary().sourceProofs(f.thread.id, first.summaryProof!.id);
  await expect(f.store.withProjectIdentityRead(saved!.projectProofs, async () => {})).rejects.toThrow("project identity changed");
  expect(await f.current()).toMatchObject({ summary: "", summaryState: { status: "blocked" } });
});
it("persists account grant versions in qualified summary artifacts", async () => {
  const f = await fixture({ qualified: true });
  vi.spyOn(f.service as unknown as { messageAccountProofs: () => Promise<{ accountId: string; version: string }[]> }, "messageAccountProofs").mockResolvedValue([{ accountId: "account", version: "grant-v1" }]);
  await f.fill();
  await f.summary().drain();
  const thread = await f.current();
  expect(await f.summary().sourceProofs(f.thread.id, thread.summaryProof!.id)).toEqual({ projectProofs: [], accountProofs: [{ accountId: "account", version: "grant-v1" }] });
});
it("holds the project identity through the physical summary provider and rechecks it at commit", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ project: true, visible: async () => true, qualified: true, generate: async () => { entered(); await gate; return { text: "Old project summary", tokens: 10 }; } });
  await f.fill();
  const running = f.summary().drain();
  await started;
  let changed = false;
  const writer = f.store.withProjectIdentityWrite(async () => {
    await f.store.db.prepare("UPDATE projects SET cwd=? WHERE id=?").run(`${f.project.cwd}-new`, f.project.id);
    changed = true;
  });
  await Promise.resolve();
  expect(changed).toBe(false);
  release();
  await writer;
  await running;
  expect((await f.current()).summary).toBe("");
});

it("summarizes oldest complete batches automatically, retains earlier facts and returns canonical proof on reads", async () => {
  const f = await fixture();
  await f.fill(40);
  expect(f.calls).toHaveLength(0);
  await f.summary().drain();
  const first = await f.current();
  expect(first.summaryProof).toMatchObject({
    version: 1,
    messageCount: 20,
    projectIds: [],
    inputTruncated: false,
    omittedMessages: 0,
  });
  expect(f.calls[0].messages.map((m) => m.text)).toEqual(
    Array.from({ length: 20 }, (_, i) => `Exact accepted message ${i + 1}`),
  );
  await f.summary().drain();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].thread.summary).toBe(first.summary);
  expect(f.calls[1].messages[0].text).toBe("Exact accepted message 21");
  expect((await f.current()).summaryProof?.messageCount).toBe(40);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(34);
});

it("keeps Voice acceptance and refresh ACK independent of a slow summary and Stop aborts its separate lane", async () => {
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const f = await fixture({
    generate: (input) =>
      new Promise((_, reject) => {
        entered();
        input.signal.addEventListener("abort", () => reject(new Error("interrupted")), {
          once: true,
        });
      }),
  });
  await f.fill();
  const running = f.summary().drain();
  await ready;
  const accepted = await f.append("Accepted while summary is working");
  expect(accepted.text).toContain("Accepted while");
  const ack = await f.request({
    op: "threads.summary.refresh",
    threadId: f.thread.id,
    requestId: "during-working",
  });
  expect(ack.thread?.id).toBe(f.thread.id);
  await f.request({ op: "pauseAll" });
  await running;
  expect((await f.current()).summaryProof).toBeUndefined();
  expect((await f.current()).summaryState?.status).toBe("blocked");
});

it("refuses unknown message scope, unverified prior summary and missing fresh project privacy before provider entry", async () => {
  const unknown = await fixture();
  await unknown.fill(19);
  await unknown.append("Legacy assistant speech", "assistant");
  await unknown.summary().drain();
  expect(unknown.calls).toHaveLength(0);
  expect((await unknown.current()).summaryState?.status).toBe("blocked");
  const project = await fixture({ project: true });
  await project.fill();
  await project.summary().drain();
  expect(project.calls).toHaveLength(0);
  expect((await project.current()).summaryState?.message).toContain("privacy");
  const legacy = await fixture();
  await legacy.fill();
  const thread = await legacy.current();
  await legacy.service.request(
    {
      op: "threads.summary",
      threadId: thread.id,
      expectedVersion: thread.version,
      summary: "Unproven prior model text",
    },
    "assistant",
  );
  await legacy.summary().drain();
  expect(legacy.calls).toHaveLength(0);
});

it("checks fresh project privacy again after reservation immediately before the actual model", async () => {
  let reads = 0;
  const f = await fixture({ project: true, visible: async () => ++reads < 2 });
  await f.fill();
  await f.summary().drain();
  expect(f.calls).toHaveLength(0);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
  expect((await f.current()).summaryProof).toBeUndefined();
});

it("refuses a source cleared during model execution and keeps known measured cost without creating an artifact", async () => {
  let release!: (value: { text: string; tokens: number }) => void, entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const f = await fixture({
    generate: async () => {
      entered();
      return new Promise((r) => (release = r));
    },
  });
  await f.fill();
  const running = f.summary().drain();
  await ready;
  const thread = await f.current();
  await f.request({ op: "threads.clear", threadId: thread.id, expectedVersion: thread.version });
  release({ text: "Must never commit stale history", tokens: 23 });
  await running;
  expect((await f.current()).summaryProof).toBeUndefined();
  expect(
    await f.store.db.prepare("SELECT count(*) AS n FROM assistant_summary_artifacts").get(),
  ).toMatchObject({ n: 0 });
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(23);
});

it("rechecks all exact sources inside final critical SQL admission after an owner edit races the outer proof", async () => {
  const f = await fixture();
  await f.fill();
  const original = f.store.transaction.bind(f.store);
  let committed = false;
  const transaction = vi.spyOn(f.store, "transaction").mockImplementation(async (run, mode) => {
    if (mode === "critical" && f.calls.length && !committed) {
      committed = true;
      await f.store.db
        .prepare(
          "UPDATE assistant_messages SET deleted_at=1 WHERE id=(SELECT id FROM assistant_messages LIMIT 1)",
        )
        .run();
    }
    return original(run, mode);
  });
  await f.summary().drain();
  transaction.mockRestore();
  expect(f.calls).toHaveLength(1);
  expect((await f.current()).summaryProof).toBeUndefined();
  expect(
    await f.store.db.prepare("SELECT count(*) AS n FROM assistant_summary_artifacts").get(),
  ).toMatchObject({ n: 0 });
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(17);
});

it("retains verified immutable artifacts after clear and later summary updates, including the original actual Voice generation proof", async () => {
  const f = await fixture();
  await f.fill();
  await f.summary().drain();
  const first = await f.current(),
    proof = first.summaryProof!;
  await f.request({ op: "threads.clear", threadId: first.id, expectedVersion: first.version });
  expect((await f.current()).summaryProof?.id).toBe(proof.id);
  const owner = await f.append("Fresh actual accepted owner speech");
  const context = (
    await f.request({
      op: "voice.context.open",
      threadId: first.id,
      requestId: "original-summary-connect",
      generationKey: "physical-provider-connection",
      seedMessageIds: [],
      ownerMessageId: owner.id,
      contextProjectIds: [],
      summaryUsed: true,
      summaryProofId: proof.id,
    })
  ).voiceContext!;
  expect(context.status).toBe("known");
  await f.fill(19);
  await f.summary().drain();
  expect((await f.current()).summaryProof?.id).not.toBe(proof.id);
  const next = await f.append("Same connection keeps the captured old summary");
  expect(
    (
      await f.request({
        op: "voice.context.open",
        threadId: first.id,
        requestId: "same-summary-generation",
        generationKey: context.generationKey,
        previousContextId: context.id,
        seedMessageIds: [],
        ownerMessageId: next.id,
        contextProjectIds: [],
        summaryUsed: true,
        summaryProofId: proof.id,
      })
    ).voiceContext?.status,
  ).toBe("known");
  await f.restart();
  expect((await f.request({ op: "voice.context.get", id: context.id })).voiceContext?.status).toBe(
    "known",
  );
  expect((await f.current()).summaryProof?.messageCount).toBe(40);
});

it("persists an uncertain summary nonce and reservation across restart without automatic replay; explicit new refresh permits a new text attempt", async () => {
  let fail = true;
  const f = await fixture({
    generate: async () => {
      if (fail) throw new Error("provider transport uncertain");
      return { text: "Explicit new pure text attempt", tokens: 5 };
    },
  });
  await f.fill();
  await f.request({
    op: "threads.summary.refresh",
    threadId: f.thread.id,
    requestId: "stable-lost-ack",
  });
  await f.summary().drain();
  const held = (await f.request({ op: "snapshot" })).snapshot!.usage.total;
  expect(held).toBe(8000);
  await f.restart();
  fail = false;
  await f.request({
    op: "threads.summary.refresh",
    threadId: f.thread.id,
    requestId: "stable-lost-ack",
  });
  f.advance(120000);
  await f.summary().drain();
  expect(f.calls).toHaveLength(1);
  await f.request({
    op: "threads.summary.refresh",
    threadId: f.thread.id,
    requestId: "explicit-next-review",
  });
  await f.summary().drain();
  expect(f.calls).toHaveLength(2);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(held + 5);
});

it("refunds known-zero preflight and does not drain budget repeatedly until capacity changes or owner explicitly refreshes", async () => {
  const f = await fixture({
    generate: async () => {
      throw new AssistantTextPreflightError();
    },
  });
  await f.fill();
  await f.summary().drain();
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
  f.advance(120000);
  await f.summary().drain();
  expect(f.calls).toHaveLength(1);
  await f.patch({ perWakeTokenCap: 9000 });
  f.advance(60001);
  await f.summary().drain();
  expect(f.calls).toHaveLength(2);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
});

it("bounds UTF8 inputs/output honestly and performs no per-thread queries on an idle history", async () => {
  const f = await fixture({ generate: async () => ({ text: "😀".repeat(4000), tokens: 13 }) });
  for (let i = 0; i < 20; i++) await f.append("😀".repeat(3000));
  await f.summary().drain();
  const thread = await f.current();
  expect(thread.summaryProof?.inputTruncated).toBe(true);
  expect(Buffer.byteLength(thread.summary, "utf8")).toBeLessThanOrEqual(6000);
  expect(f.calls[0].messages.every((m) => Buffer.byteLength(m.text, "utf8") <= 1000)).toBe(true);
  const prepare = vi.spyOn(f.store.db, "prepare");
  await f.summary().drain();
  expect(prepare.mock.calls.some(([sql]) => String(sql).includes("SELECT q.sequence"))).toBe(false);
  prepare.mockRestore();
});

it("uses actual remaining capacity and day in a known-zero refusal key, so a new day can retry with unchanged saved configuration", async () => {
  const f = await fixture({
    generate: async () => {
      throw new AssistantTextPreflightError();
    },
  });
  await f.patch({ dailyTokenBudget: 10000 });
  await f.fill();
  const day = new Date(Date.UTC(2026, 10, 2, 12)).toISOString().slice(0, 10),
    id = `usage:${day}`,
    value = {
      id,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      value: {
        day,
        chiefTokens: 5000,
        workerTokens: 0,
        total: 5000,
        mode: "run",
        estimated: false,
      },
    };
  await f.store.db
    .prepare("INSERT INTO assistant_runtime(id,value,version,updated_at) VALUES(?,?,1,1)")
    .run(id, JSON.stringify(value));
  await f.summary().drain();
  expect(f.calls[0].tokenCap).toBe(3000);
  f.advance(86400001);
  await f.summary().drain();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].tokenCap).toBe(8000);
  expect((await f.request({ op: "snapshot" })).snapshot!.usage.total).toBe(0);
});

it("captures the original proven typed-reply summary before a concurrent rolling refresh replaces the current artifact", async () => {
  let entered!: () => void, release!: (value: { text: string; tokens: number }) => void;
  const ready = new Promise<void>((r) => (entered = r)),
    f = await fixture({
      reply: async () => {
        entered();
        return new Promise((r) => (release = r));
      },
    });
  await f.fill();
  await f.summary().drain();
  const original = (await f.current()).summaryProof!.id;
  await f.fill(19);
  const pending = f.request({
    op: "threads.send",
    threadId: f.thread.id,
    text: "Accepted text reply while summary advances",
    via: "text",
    idempotencyKey: "typed-summary-version",
  });
  await ready;
  await f.summary().drain();
  release({ text: "Actual reply from the earlier immutable summary", tokens: 7 });
  const response = await pending,
    reply = response.messages!.at(-1)!;
  expect(reply.projectIds).toEqual([]);
  const thread = await f.current();
  expect(thread.summaryProof!.id).not.toBe(original);
  expect(thread.summaryProof!.messageCount).toBe(40);
});

it("retains Native library proof in summary and hides it after revocation", async () => {
  const f = await fixture({ qualified: true });
  const proof = { environmentId: f.store.environmentId, threadId: f.thread.id, installationId: "installation", issuer: "issuer", registryRevision: "revision", visibilityEpoch: 1, policyGeneration: "generation" };
  let valid = true;
  vi.spyOn(f.service as unknown as { messageNativeProofs: () => Promise<typeof proof[]> }, "messageNativeProofs").mockResolvedValue([proof]);
  f.ports.roomNativeProofsValid = async () => valid;
  f.ports.withSummarySourceDisclosure = async (_threadId, _projects, _accounts, effect, _expected, native) => {
    expect(native).toEqual([proof]);
    if (!valid) throw new Error("Native source revoked");
    return effect(() => valid);
  };
  await f.fill();
  await f.summary().drain();
  const thread = await f.current();
  expect((await f.summary().sourceProofs(f.thread.id, thread.summaryProof!.id))?.nativeProofs).toEqual([proof]);
  valid = false;
  expect(await f.current()).toMatchObject({ summary: "", summaryState: { status: "blocked" } });
});
