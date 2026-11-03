import { afterEach, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostAssistant } from "./assistant/service";
import { assistantDomain } from "./assistant-domain";
import { RUNTIME_LOG_TOOLS } from "./runtime-log-tools";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../src/shared/model/host-contracts/assistant";
import {
  AssistantVoiceContextSchema,
  AssistantVoiceDisclosureSchema,
  type AssistantVoiceContext,
} from "../src/shared/model/assistantVoiceContext";
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const drafts = [
  {
    prompt: "Which result should be retained?",
    multiSelect: false,
    allowCustom: true,
    options: [{ label: "First result" }, { label: "Second result" }],
  },
];
it("retains only actual captured action metadata across restart and old immutable speech versions, then hides it when a source is cleared", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    before = await f.speech(context, "Before any tool disclosure");
  const ticket = await f.service.beginVoiceToolDisclosure({
    contextId: context.id,
    requestId: "actual-action-metadata",
  });
  await f.service.finishVoiceToolDisclosure(ticket.id, {
    threadId: f.thread.id,
    projectId: f.project.id,
    family: "conversation",
    action: "notes.read",
    result: { body: "Private actual output must never enter metadata" },
  });
  const speech = await f.speech(context, "After canonical tool output"),
    actions = await f.service.voiceActionsForMessage(speech.id);
  expect(actions).toMatchObject({
    projectIds: [f.project.id],
    actions: [{ id: ticket.id, family: "conversation", action: "notes.read", status: "completed" }],
  });
  expect(JSON.stringify(actions)).not.toContain("Private actual output");
  expect(await f.service.voiceActionsForMessage(before.id)).toBeUndefined();
  await f.restart();
  expect(await f.service.voiceActionsForMessage(speech.id)).toEqual(actions);
  await f.owner({
    op: "voice.context.invalidate",
    id: context.id,
    requestId: "later-unproven-disclosure",
    reason: "unverified-tool",
  });
  expect(await f.service.voiceActionsForMessage(speech.id)).toEqual(actions);
  expect(await f.service.voiceActionsForMessage(owner.id)).toBeUndefined();
  await f.owner({ op: "messages.delete", id: owner.id, expectedVersion: owner.version });
  expect(await f.service.voiceActionsForMessage(speech.id)).toBeUndefined();
});
async function fixture() {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "assistant-voice-provenance-"))),
    store = new HostStore(join(folder, "host.db"));
  await store.ready;
  mkdirSync(join(folder, "other"));
  const project = await store.addProject(folder, "First project"),
    other = await store.addProject(join(folder, "other"), "Other project");
  const ports = {
    listProjects: async () =>
      (await store.projects()).map((project) => ({
        id: project.id,
        path: project.cwd,
        name: project.name,
      })),
  };
  let service = new HostAssistant(store, ports);
  await service.ready;
  const owner = (input: unknown) =>
    assistantDomain(service, store)(input, {
      principalId: "actual-voice-owner",
      authorized: async () => true,
    });
  const thread = (await owner({ op: "threads.open" })).thread!;
  let sequence = 0;
  const user = async (text = "Accepted owner speech") =>
    (
      await owner({
        op: "threads.append",
        threadId: thread.id,
        role: "user",
        via: "voice",
        text,
        idempotencyKey: `owner-${++sequence}`,
      })
    ).message!;
  const open = async (
    ownerMessageId: string,
    options: {
      previous?: AssistantVoiceContext;
      generation?: string;
      seed?: string[];
      projects?: string[];
      requestId?: string;
      summaryUsed?: boolean;
    } = {},
  ) =>
    (
      await owner({
        op: "voice.context.open",
        threadId: thread.id,
        ownerMessageId,
        generationKey:
          options.generation ?? options.previous?.generationKey ?? "actual-provider-generation",
        seedMessageIds: options.seed ?? [],
        contextProjectIds: options.projects ?? [],
        summaryUsed: options.summaryUsed ?? false,
        requestId: options.requestId ?? `context-${++sequence}`,
        ...(options.previous ? { previousContextId: options.previous.id } : {}),
      })
    ).voiceContext!;
  const speech = async (
    context: AssistantVoiceContext | undefined,
    text = "Actual assistant speech",
    idempotencyKey = `assistant-${++sequence}`,
  ) =>
    (
      await owner({
        op: "threads.append",
        threadId: thread.id,
        role: "assistant",
        via: "voice",
        text,
        idempotencyKey,
        ...(context ? { causalContextId: context.id } : {}),
      })
    ).message!;
  const read = async (id: string) =>
    (await owner({ op: "threads.messages", threadId: thread.id, limit: 100 })).messages!.find(
      (message) => message.id === id,
    )!;
  const present = async (
    context: AssistantVoiceContext,
    ownerMessageId: string,
    requestId = `proposal-${++sequence}`,
  ) =>
    (
      await owner({
        op: "questions.present",
        threadId: thread.id,
        ownerMessageId,
        requestId,
        contextProjectIds: context.projectIds ?? [],
        causalContextId: context.id,
        questions: drafts,
      })
    ).ownerQuestion!;
  closes.push(async () => {
    await service.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    store,
    project,
    other,
    thread,
    owner,
    user,
    open,
    speech,
    read,
    present,
    get service() {
      return service;
    },
    restart: async () => {
      await service.close();
      service = new HostAssistant(store, ports);
      await service.ready;
    },
  };
}

it("proves continuous tool-free voice from actual accepted source IDs, preserving prior speech and persistent choices with unknown unused history omitted", async () => {
  const f = await fixture();
  await f.speech(undefined, "Legacy speech with no causal receipt");
  await f.service.request(
    {
      op: "threads.summary",
      threadId: f.thread.id,
      expectedVersion: (await f.owner({ op: "snapshot" })).snapshot!.threads[0].version,
      summary: "Unknown older summary retained for history",
    },
    "assistant",
  );
  const owner1 = await f.user(),
    context1 = await f.open(owner1.id),
    speech1 = await f.speech(context1);
  expect(context1).toMatchObject({ status: "known", projectIds: [] });
  expect(speech1.projectIds).toEqual([]);
  const owner2 = await f.user("Continue the known same connection"),
    context2 = await f.open(owner2.id, { previous: context1 }),
    question = await f.present(context2, owner2.id);
  expect(question).toMatchObject({ jobId: null, sourceCurrent: true, projectIds: [] });
  await f.restart();
  expect((await f.read(speech1.id)).projectIds).toEqual([]);
  expect(
    (await f.owner({ op: "questions.get", id: question.id })).ownerQuestion?.sourceCurrent,
  ).toBe(true);
  expect(
    AssistantResponseValidationSchema.safeParse(
      await f.owner({ op: "voice.context.get", id: context2.id }),
    ).success,
  ).toBe(true);
});

it("keeps unsafe disclosures monotonic for the entire retained provider generation while preserving earlier verified history", async () => {
  const f = await fixture(),
    owner1 = await f.user(),
    context1 = await f.open(owner1.id),
    before = await f.speech(context1),
    ticket = await f.service.beginVoiceToolDisclosure({
      contextId: context1.id,
      requestId: "unsafe-result",
    });
  expect((await f.owner({ op: "voice.context.get", id: context1.id })).voiceContext?.status).toBe(
    "pending",
  );
  const pending = await f.speech(context1, "No false global stamp while tool data is pending");
  expect(pending.projectIds).toBeUndefined();
  const receipt = await f.service.finishVoiceToolDisclosure(ticket.id, {
    threadId: f.thread.id,
    projectId: f.project.id,
    family: "conversation",
    action: "desktop.snapshot",
    result: { private: "Unverified application data" },
  });
  expect(receipt.voiceDisclosure).toMatchObject({ verified: false });
  expect(receipt.voiceDisclosure.projectIds).toBeUndefined();
  expect(receipt.voiceContext).toMatchObject({ status: "unknown", reason: "unverified-tool" });
  expect(receipt.voiceContext.projectIds).toBeUndefined();
  expect((await f.speech(context1)).projectIds).toBeUndefined();
  expect((await f.read(before.id)).projectIds).toEqual([]);
  const owner2 = await f.user(),
    context2 = await f.open(owner2.id, { previous: context1 });
  expect(context2.status).toBe("unknown");
  await expect(f.present(context2, owner2.id)).rejects.toThrow("no verified current source");
  const reset = await f.open(owner2.id, { generation: "actual-fresh-provider-connection" });
  expect(reset.status).toBe("known");
  const cannotBless = await f.open(owner2.id, {
    generation: "fresh-but-unsafe-seed",
    seed: [pending.id],
  });
  expect(cannotBless.status).toBe("unknown");
});

it("tracks parallel pending tools independently, adds all actual canonical participants and returns per-result scope even after generation invalidation", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id);
  await f.store.db.exec("CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  await f.store.db
    .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
    .run(
      "actual-multiple-project-goal",
      JSON.stringify({ projectIds: [f.project.id, f.other.id] }),
    );
  const one = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "canonical-task",
    }),
    two = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "canonical-logs",
    });
  const first = await f.service.finishVoiceToolDisclosure(one.id, {
    threadId: f.thread.id,
    projectId: f.project.id,
    family: "conversation",
    action: "tasks.get",
    result: { id: "actual-task", projectId: f.project.id, goalId: "actual-multiple-project-goal" },
  });
  expect(first.voiceContext.status).toBe("pending");
  expect(first.voiceContext.projectIds).toBeUndefined();
  expect(first.voiceDisclosure.projectIds).toEqual([f.project.id, f.other.id].sort());
  const second = await f.service.finishVoiceToolDisclosure(two.id, {
    threadId: f.thread.id,
    projectId: f.project.id,
    family: "runtime-logs",
    action: RUNTIME_LOG_TOOLS[0],
    result: { entries: ["Actual scoped log metadata"] },
  });
  expect(second.voiceContext).toMatchObject({
    status: "known",
    projectIds: [f.project.id, f.other.id].sort(),
  });
  expect(second.voiceDisclosure.projectIds).toEqual([f.project.id]);
  expect((await f.speech(context)).projectIds).toEqual([f.project.id, f.other.id].sort());
  await f.owner({
    op: "voice.context.invalidate",
    id: context.id,
    requestId: "renderer-disclosure",
    reason: "unverified-tool",
  });
  const later = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "known-after-unsafe",
    }),
    known = await f.service.finishVoiceToolDisclosure(later.id, {
      threadId: f.thread.id,
      projectId: f.project.id,
      family: "conversation",
      action: "notes.read",
      result: { title: "Actual scoped note", body: "Retained body" },
    });
  expect(known.voiceContext.status).toBe("unknown");
  expect(known.voiceContext.projectIds).toBeUndefined();
  expect(known.voiceDisclosure).toMatchObject({ verified: true, projectIds: [f.project.id] });
});

it("records exact canonical choice data in the context and invalidates only dependent speech when its transcript source is deleted", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    before = await f.speech(context, "Before the owner decision"),
    question = await f.present(context, owner.id),
    item = question.prompt.questions[0];
  await f.owner({
    op: "questions.answer",
    id: question.id,
    expectedVersion: question.version,
    requestId: "actual-owner-answer",
    answers: { [item.id]: [item.options[1].id] },
  });
  const after = await f.speech(context, "After the exact owner choice"),
    messages = (await f.owner({ op: "threads.messages", threadId: f.thread.id })).messages!,
    choice = messages.find((message) => message.ownerQuestionId === question.id)!;
  expect(choice.ownerQuestionRequestId).toBe("actual-owner-answer");
  expect(choice.projectIds).toEqual([]);
  expect(after.projectIds).toEqual([]);
  await f.owner({ op: "messages.delete", id: choice.id, expectedVersion: choice.version });
  expect((await f.read(after.id)).projectIds).toBeUndefined();
  expect((await f.read(before.id)).projectIds).toEqual([]);
  expect((await f.speech(context)).projectIds).toBeUndefined();
});

it("refuses cross-thread/forged seed origins and owner impersonation, while raw convenience arrays cannot certify output", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    foreign = (await f.owner({ op: "threads.open", projectId: f.project.id })).thread!,
    foreignMessage = (
      await f.owner({
        op: "threads.append",
        threadId: foreign.id,
        role: "user",
        via: "voice",
        text: "Foreign source",
        idempotencyKey: "foreign-owner",
      })
    ).message!;
  await expect(
    f.open(owner.id, { generation: "foreign-seed", seed: [foreignMessage.id] }),
  ).rejects.toThrow("another thread");
  await expect(
    f.service.request({ op: "voice.context.get", id: context.id }, "chief"),
  ).rejects.toThrow("direct authority");
  expect(
    AssistantRequestValidationSchema.safeParse({
      op: "threads.append",
      threadId: f.thread.id,
      role: "assistant",
      via: "voice",
      text: "Forged",
      idempotencyKey: "forged",
      projectIds: [],
    }).success,
  ).toBe(false);
  expect(
    AssistantRequestValidationSchema.safeParse({
      op: "voice.context.open",
      threadId: f.thread.id,
      ownerMessageId: owner.id,
      generationKey: "forged",
      requestId: "forged",
      seedMessageIds: [],
      contextProjectIds: [],
      summaryUsed: false,
      principal: "owner",
    }).success,
  ).toBe(false);
  const ticket = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "wrong-bound-thread",
    }),
    result = await f.service.finishVoiceToolDisclosure(ticket.id, {
      threadId: foreign.id,
      projectId: f.project.id,
      family: "conversation",
      action: "notes.read",
      result: { body: "Other scope" },
    });
  expect(result.voiceContext.status).toBe("unknown");
  expect(result.voiceDisclosure.verified).toBe(false);
});

it("retains exact append retry identity without upgrading an originally unknown speech record", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    speech = await f.speech(context, "Exact speech", "frozen-speech");
  await f.restart();
  const retry = await f.speech(context, "Exact speech", "frozen-speech");
  expect(retry.id).toBe(speech.id);
  expect(retry.projectIds).toEqual([]);
  await expect(f.speech(undefined, "Exact speech", "frozen-speech")).rejects.toThrow(
    "original payload",
  );
  const unknown = await f.speech(undefined, "Originally unknown", "unknown-speech");
  await expect(f.speech(context, "Originally unknown", "unknown-speech")).rejects.toThrow(
    "original payload",
  );
  expect((await f.read(unknown.id)).projectIds).toBeUndefined();
});

it("repairs interrupted disclosure intent to unknown on restart and never blindly executes an existing request again", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    ticket = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "lost-disclosure",
    });
  expect(ticket.id).toBeTruthy();
  await f.restart();
  expect((await f.owner({ op: "voice.context.get", id: context.id })).voiceContext).toMatchObject({
    status: "unknown",
    reason: "unverified-tool",
  });
  await expect(
    f.service.beginVoiceToolDisclosure({ contextId: context.id, requestId: "lost-disclosure" }),
  ).rejects.toThrow("instead of replaying");
  const owner2 = await f.user(),
    continued = await f.open(owner2.id, { previous: context });
  expect(continued.status).toBe("unknown");
});

it("keeps context request IDs/persistent initial seeds stable and refuses synthetic reseeding in the same retained generation", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id, { requestId: "stable-open" });
  expect((await f.open(owner.id, { requestId: "stable-open" })).id).toBe(context.id);
  await expect(
    f.open(owner.id, { requestId: "stable-open", projects: [f.project.id] }),
  ).rejects.toThrow("original accepted source");
  const owner2 = await f.user();
  await expect(f.open(owner2.id, { previous: context, seed: [owner.id] })).rejects.toThrow(
    "Start a fresh generation",
  );
  const next = await f.open(owner2.id, { previous: context });
  expect(next.status).toBe("known");
  expect(
    (await f.speech(context, "Stale old-turn speech retained without retargeting")).projectIds,
  ).toBeUndefined();
  await expect(f.present(context, owner.id)).rejects.toThrow("newer accepted owner turn");
});

it("does not bless summaries or cleared sources as global, and a fresh real generation may omit unknown unused history", async () => {
  const f = await fixture(),
    owner = await f.user(),
    summary = await f.open(owner.id, { summaryUsed: true });
  expect(summary).toMatchObject({ status: "unknown", reason: "unverified-summary" });
  const known = await f.open(owner.id, { generation: "fresh-without-summary" });
  expect(known.status).toBe("known");
  const current = (await f.owner({ op: "snapshot" })).snapshot!.threads.find(
    (thread) => thread.id === f.thread.id,
  )!;
  await f.owner({ op: "threads.clear", threadId: f.thread.id, expectedVersion: current.version });
  expect((await f.owner({ op: "voice.context.get", id: known.id })).voiceContext?.status).toBe(
    "unknown",
  );
  const nextOwner = await f.user("Fresh accepted owner after clear"),
    retained = await f.open(nextOwner.id, { previous: known });
  expect(retained.status).toBe("unknown");
  expect(retained.projectIds).toBeUndefined();
  expect(
    (await f.open(nextOwner.id, { generation: "new-actual-provider-after-clear" })).status,
  ).toBe("known");
});

it("fails a completed-but-not-sent disclosure on owner revocation without erasing independently verified earlier history", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    before = await f.speech(context),
    ticket = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "revoke-after-proof",
    });
  await f.service.finishVoiceToolDisclosure(ticket.id, {
    threadId: f.thread.id,
    projectId: f.project.id,
    family: "conversation",
    action: "notes.read",
    result: { body: "Actual scoped data" },
  });
  await f.service.failVoiceToolDisclosure(ticket.id);
  expect((await f.owner({ op: "voice.context.get", id: context.id })).voiceContext?.status).toBe(
    "unknown",
  );
  expect((await f.read(before.id)).projectIds).toEqual([]);
  expect((await f.speech(context)).projectIds).toBeUndefined();
});

it("bounds malformed causal cycles rather than trusting a private convenience scope", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id),
    speech = await f.speech(context);
  await f.store.db
    .prepare(
      "UPDATE assistant_voice_context_versions SET value=json_set(value,'$.refs',json(?)) WHERE context_id=? AND version=?",
    )
    .run(
      JSON.stringify([{ id: speech.id, fingerprint: "malformed-cycle" }]),
      context.id,
      context.version,
    );
  expect((await f.read(speech.id)).projectIds).toBeUndefined();
});

it("retains the complete stored assistant-job participants in an actual task disclosure even when Goal metadata is narrower", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id);
  await f.store.db.exec("CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const jobId = "captured-multiple-job",
    goalId = `assistant-${jobId}`;
  await f.store.db
    .prepare("INSERT INTO assistant_jobs(id,value,version,updated_at) VALUES(?,?,1,1)")
    .run(
      jobId,
      JSON.stringify({
        id: jobId,
        projectId: f.project.id,
        projectIds: [f.project.id, f.other.id],
        goalId,
      }),
    );
  await f.store.db
    .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
    .run(goalId, JSON.stringify({ projectIds: [f.project.id] }));
  const ticket = await f.service.beginVoiceToolDisclosure({
      contextId: context.id,
      requestId: "retained-job-participants",
    }),
    receipt = await f.service.finishVoiceToolDisclosure(ticket.id, {
      threadId: f.thread.id,
      projectId: f.project.id,
      family: "conversation",
      action: "tasks.get",
      result: { id: "actual-task", projectId: f.project.id, goalId },
    });
  expect(receipt.voiceDisclosure.projectIds).toEqual([f.project.id, f.other.id].sort());
  expect((await f.speech(context)).projectIds).toEqual([f.project.id, f.other.id].sort());
});

it("rejects malformed known metadata and unknown convenience arrays instead of interpreting either as global scope", async () => {
  const f = await fixture(),
    owner = await f.user(),
    context = await f.open(owner.id);
  expect(AssistantVoiceContextSchema.safeParse({ ...context, projectIds: undefined }).success).toBe(
    false,
  );
  expect(
    AssistantVoiceContextSchema.safeParse({ ...context, status: "unknown", projectIds: [] })
      .success,
  ).toBe(false);
  expect(
    AssistantVoiceDisclosureSchema.safeParse({
      id: "receipt",
      contextId: context.id,
      requestId: "request",
      verified: true,
    }).success,
  ).toBe(false);
  expect(
    AssistantVoiceDisclosureSchema.safeParse({
      id: "receipt",
      contextId: context.id,
      requestId: "request",
      verified: false,
      projectIds: [],
    }).success,
  ).toBe(false);
});
