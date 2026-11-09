import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";
import { assistantDomain } from "../../domains/assistant/service";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../../../src/shared/model/host-contracts/assistant";
import {
  AssistantOwnerQuestionDraft,
  pendingOwnerQuestions,
  type OwnerQuestionPort,
} from "../../../src/features/assistant/model/assistantOwnerQuestions";
import { VoiceThreadTranscript } from "../../../src/features/voice/model/voiceThreads";
import {
  persistVoiceOwnerChoice,
  VoiceOwnerChoicePending,
} from "../../../src/features/voice/model/voiceOwnerChoice";
import { pendingOwnerQuestionPresentations } from "../../../src/features/assistant/model/assistantOwnerQuestionPresentations";
import { parseVoiceChoice } from "../../../src/features/voice/model/voiceChoices";
import { VoiceCausalGeneration } from "../../../src/features/voice/model/voiceCausalContext";
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "owner-question-renderer-")),
    store = new HostStore(join(folder, "host.db"));
  await store.ready;
  let assistant = new HostAssistant(store);
  await assistant.ready;
  const owner = (input: unknown) =>
    assistantDomain(assistant, store)(AssistantRequestValidationSchema.parse(input), {
      principalId: "captured-owner",
      authorized: async () => true,
    });
  const thread = (await owner({ op: "threads.open" })).thread!;
  const turn = (
    await owner({
      op: "threads.append",
      threadId: thread.id,
      role: "user",
      via: "voice",
      text: "Compare the options for me",
      idempotencyKey: "actual-owner-turn",
    })
  ).message!;
  const question = (
    await owner({
      op: "questions.present",
      threadId: thread.id,
      ownerMessageId: turn.id,
      contextProjectIds: [],
      requestId: "captured-presentation",
      title: "Exact owner choice",
      questions: [
        {
          prompt: "Which result should I prepare?",
          multiSelect: false,
          allowCustom: true,
          options: [{ label: "Existing scope" }, { label: "Other" }],
        },
      ],
    })
  ).ownerQuestion!;
  const records = new Map<string, string>(),
    storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => {
        records.set(key, value);
      },
      removeItem: (key: string) => {
        records.delete(key);
      },
    };
  let dropAck = false;
  const mutations: string[] = [];
  const port: OwnerQuestionPort = async (input, environmentId) => {
    expect(environmentId).toBe(store.environmentId);
    const result = AssistantResponseValidationSchema.parse(await owner(input));
    if (input.op !== "questions.get") {
      mutations.push(input.op);
      if (dropAck) throw new Error("reply lost after actual DB commit");
    }
    return result;
  };
  closes.push(async () => {
    await assistant.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const model = () =>
    new AssistantOwnerQuestionDraft(
      question,
      store.environmentId,
      storage,
      () => "actual-owner-answer",
      () => true,
    );
  const answer = {
    kind: "answered" as const,
    answers: { [question.prompt.questions[0].id]: [question.prompt.questions[0].options[0].id] },
  };
  return {
    store,
    owner,
    question,
    thread,
    turn,
    storage,
    port,
    model,
    answer,
    mutations,
    set dropAck(value: boolean) {
      dropAck = value;
    },
    restart: async () => {
      await assistant.close();
      assistant = new HostAssistant(store);
      await assistant.ready;
    },
  };
}
it("round-trips actual Host-generated IDs through the renderer model/domain and resolves a lost ACK after Host restart", async () => {
  const f = await fixture();
  expect(f.question).toMatchObject({
    jobId: null,
    origin: "voice-proposal",
    projectIds: [],
    sourceCurrent: true,
  });
  expect(f.question.prompt.questions[0].id).not.toBe("Which result should I prepare?");
  f.dropAck = true;
  await expect(f.model().submit(f.answer, f.port, Date.now() + 3600000)).rejects.toThrow(
    "after actual DB commit",
  );
  expect(pendingOwnerQuestions(f.storage, f.store.environmentId)).toHaveLength(1);
  await f.restart();
  const recorded = await f.model().retry(f.port);
  expect(recorded.answer?.answers).toEqual(f.answer.answers);
  expect(recorded.version).toBe(f.question.version + 1);
  expect(f.mutations).toEqual(["questions.answer"]);
  expect(pendingOwnerQuestions(f.storage, f.store.environmentId)).toEqual([]);
  const transcript = (await f.owner({ op: "threads.messages", threadId: f.thread.id })).messages!;
  const linked = transcript.filter((message) => message.ownerQuestionId === f.question.id);
  expect(linked).toHaveLength(1);
  expect(linked[0]).toMatchObject({
    ownerQuestionRequestId: "actual-owner-answer",
    projectIds: [],
    role: "user",
  });
  expect(linked[0].text).toContain("Existing scope");
  const snapshot = (await f.owner({ op: "snapshot" })).snapshot!;
  expect(snapshot.jobs).toEqual([]);
  expect(snapshot.usage.total).toBe(0);
});
it("refuses to answer a canonical proposal after its actual owner history source was cleared", async () => {
  const f = await fixture(),
    thread = (await f.owner({ op: "snapshot" })).snapshot!.threads.find(
      (thread) => thread.id === f.thread.id,
    )!;
  await f.owner({ op: "threads.clear", threadId: thread.id, expectedVersion: thread.version });
  await expect(f.model().submit(f.answer, f.port, Date.now() + 3600000)).rejects.toThrow(
    "changed with its work",
  );
  expect(f.mutations).toEqual([]);
  expect(pendingOwnerQuestions(f.storage, f.store.environmentId)).toHaveLength(1);
  expect((await f.owner({ op: "questions.get", id: f.question.id })).ownerQuestion?.status).toBe(
    "open",
  );
});
it("uses the exact original receipt payload when an acknowledged snooze was followed by a later owner action", async () => {
  const f = await fixture(),
    until = Date.now() + 3600000;
  f.dropAck = true;
  await expect(f.model().submit({ kind: "skipped" }, f.port, until)).rejects.toThrow(
    "after actual DB commit",
  );
  const current = (await f.owner({ op: "questions.get", id: f.question.id })).ownerQuestion!;
  await f.owner({
    op: "questions.snooze",
    id: current.id,
    expectedVersion: current.version,
    requestId: "later-explicit-owner-action",
    until: until + 3600000,
  });
  const latest = await f.model().retry(f.port);
  expect(latest.version).toBe(f.question.version + 2);
  expect(latest.snoozedUntil).toBe(until + 3600000);
  expect(f.mutations).toEqual(["questions.snooze"]);
  expect(pendingOwnerQuestions(f.storage, f.store.environmentId)).toEqual([]);
});
it("persists an ordinary Voice choice on its exact owner receipt and maps Host-generated IDs back only to the captured model options", async () => {
  const f = await fixture();
  vi.stubGlobal("localStorage", f.storage);
  const transcript = new VoiceThreadTranscript(f.owner, () => {});
  transcript.bind(f.thread, undefined, f.owner);
  transcript.record("user", "Choose the next local plan");
  transcript.finish();
  await transcript.retry();
  const original = parseVoiceChoice({
    question: "Which plan?",
    options: [
      { id: "model-small", label: "Small" },
      { id: "model-existing", label: "Existing" },
    ],
    kind: "pick",
    allowCustom: true,
  });
  const binding = {
    remote: false,
    request: f.owner,
    environmentId: async () => f.store.environmentId,
    current: () => true,
    open: async () => {
      throw new Error("already captured");
    },
    scope: async () => ({
      projectIds: [],
      complete: true,
      current: () => true,
      liveProjectIds: () => new Set<string>(),
    }),
  };
  const saved = await persistVoiceOwnerChoice(original, binding, transcript, () => true);
  expect(saved).toBeDefined();
  const canonical = saved!.choice.prompt.questions[0];
  expect(canonical.options[0].id).not.toBe("model-small");
  expect(saved!.deferred()).toMatchObject({
    status: "awaiting_owner",
    ownerQuestionId: saved!.question.id,
  });
  expect(
    (await f.owner({ op: "questions.get", id: saved!.question.id })).ownerQuestion?.status,
  ).toBe("open");
  const result = await saved!.answer({
    kind: "answered",
    answers: { [canonical.id]: [canonical.options[1].id] },
  });
  expect(result.reply).toEqual({ kind: "answered", answers: { choice: ["model-existing"] } });
  const transcriptRows = (await f.owner({ op: "threads.messages", threadId: f.thread.id }))
    .messages!;
  expect(
    transcriptRows.filter((message) => message.ownerQuestionId === saved!.question.id),
  ).toHaveLength(1);
  const confirm = parseVoiceChoice({
    question: "Delete?",
    kind: "confirm",
    allowCustom: false,
    options: [
      { id: "confirm", label: "Confirm" },
      { id: "cancel", label: "Cancel" },
    ],
  });
  expect(await persistVoiceOwnerChoice(confirm, binding, transcript, () => true)).toBeUndefined();
});
it("chains actual accepted Voice turns through durable causal speech proof into a retained choice without certifying an unknown generation", async () => {
  const f = await fixture();
  vi.stubGlobal("localStorage", f.storage);
  const transcript = new VoiceThreadTranscript(f.owner, () => {});
  transcript.bind(f.thread, undefined, f.owner);
  const binding = {
    remote: false,
    request: f.owner,
    environmentId: async () => f.store.environmentId,
    current: () => true,
    open: async () => {
      throw new Error("captured");
    },
    scope: async () => ({
      projectIds: [],
      complete: true,
      current: () => true,
      liveProjectIds: () => new Set<string>(),
    }),
  };
  const generation = new VoiceCausalGeneration(
    [f.turn.id],
    false,
    () => true,
    (error) => {
      throw error;
    },
  );
  transcript.record("user", "Keep comparing the local options");
  transcript.finish();
  await generation.accept(binding, transcript.ownerReceipt(), "Keep comparing the local options");
  expect(await generation.proof()).toBeDefined();
  transcript.record(
    "assistant",
    "I compared the existing local options.",
    false,
    generation.proof(),
  );
  transcript.finish();
  await transcript.retry();
  const spoken = (await f.owner({ op: "threads.messages", threadId: f.thread.id })).messages!.find(
    (message) => message.role === "assistant",
  )!;
  expect(spoken.projectIds).toEqual([]);
  transcript.record("user", "Show a planning card for the next step");
  transcript.finish();
  await generation.accept(
    binding,
    transcript.ownerReceipt(),
    "Show a planning card for the next step",
  );
  const original = parseVoiceChoice({
    question: "Which next step?",
    kind: "pick",
    allowCustom: true,
    options: [
      { id: "a", label: "Existing scope" },
      { id: "b", label: "New scope" },
    ],
  });
  const saved = await persistVoiceOwnerChoice(
    original,
    binding,
    transcript,
    () => true,
    generation.proof(),
  );
  expect(saved?.question.origin).toBe("voice-proposal");
  expect(saved?.question.projectIds).toEqual([]);
  await generation.invalidate("unverified-tool");
  expect(await generation.proof()).toBeUndefined();
  // A later unknown disclosure does not rewrite the already valid earlier speech proof.
  expect(
    (await f.owner({ op: "threads.messages", threadId: f.thread.id })).messages!.find(
      (message) => message.id === spoken.id,
    )?.projectIds,
  ).toEqual([]);
  transcript.record("user", "Another planning card");
  transcript.finish();
  await generation.accept(binding, transcript.ownerReceipt(), "Another planning card");
  expect(await generation.proof()).toBeUndefined();
  await expect(
    persistVoiceOwnerChoice(
      parseVoiceChoice({
        question: "Should remain unverified",
        kind: "pick",
        options: [
          { id: "x", label: "One" },
          { id: "y", label: "Two" },
        ],
      }),
      binding,
      transcript,
      () => true,
      generation.proof(),
    ),
  ).rejects.toThrow("could not be verified");
  await f.restart();
  const rotated = new VoiceCausalGeneration(
    [spoken.id],
    false,
    () => true,
    (error) => {
      throw error;
    },
  );
  await rotated.accept(binding, transcript.ownerReceipt(), "Another planning card");
  expect(await rotated.proof()).toBeDefined();
});
it("keeps a lost presentation ACK as one durable exact intent across Voice off and Host restart", async () => {
  const f = await fixture();
  vi.stubGlobal("localStorage", f.storage);
  let lost = true;
  const calls: unknown[] = [];
  const request = async (input: Parameters<typeof f.owner>[0]) => {
    const result = await f.owner(input);
    if ((input as { op: string }).op === "questions.present") {
      calls.push(structuredClone(input));
      if (lost) {
        lost = false;
        throw new Error("presentation acknowledgement lost after commit");
      }
    }
    return result;
  };
  const transcript = new VoiceThreadTranscript(request, () => {});
  transcript.bind(f.thread, undefined, request);
  transcript.record("user", "Keep this exact planning question");
  transcript.finish();
  await transcript.retry();
  const binding = {
    remote: false,
    request,
    environmentId: async () => f.store.environmentId,
    current: () => true,
    open: async () => {
      throw new Error("captured");
    },
    scope: async () => ({
      projectIds: [],
      complete: true,
      current: () => true,
      liveProjectIds: () => new Set<string>(),
    }),
  };
  const original = parseVoiceChoice({
    question: "Keep the draft?",
    kind: "pick",
    options: [
      { id: "keep", label: "Keep" },
      { id: "review", label: "Review" },
    ],
  });
  let pending: VoiceOwnerChoicePending | undefined;
  try {
    await persistVoiceOwnerChoice(original, binding, transcript, () => true);
  } catch (error) {
    expect(error).toBeInstanceOf(VoiceOwnerChoicePending);
    pending = error as VoiceOwnerChoicePending;
  }
  expect(pendingOwnerQuestionPresentations(f.storage, f.store.environmentId)).toHaveLength(1);
  expect(pending!.deferred()).toMatchObject({ status: "presentation_unconfirmed" });
  await f.restart();
  const recovered = await pending!.retry();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(pendingOwnerQuestionPresentations(f.storage, f.store.environmentId)).toEqual([]);
  const snapshot = (await f.owner({ op: "snapshot" })).snapshot!;
  expect(
    snapshot.ownerQuestions!.filter(
      (question) => question.ownerMessageId === recovered.question.ownerMessageId,
    ),
  ).toHaveLength(1);
  const q = recovered.choice.prompt.questions[0];
  expect(
    (await recovered.answer({ kind: "answered", answers: { [q.id]: [q.options[0].id] } })).reply,
  ).toEqual({ kind: "answered", answers: { choice: ["keep"] } });
});
