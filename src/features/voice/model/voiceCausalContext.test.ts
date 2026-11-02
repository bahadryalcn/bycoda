import { expect, it, vi } from "vitest";
import { VoiceCausalGeneration } from "./voiceCausalContext";
import {
  AssistantVoiceContextOpenSchema,
  AssistantVoiceContextInvalidateSchema,
  type AssistantVoiceContext,
} from "../../../shared/model/assistantVoiceContext";
import type { VoiceHistoryBinding } from "./voiceHistory";
import type {
  AssistantMessage,
  AssistantRequest,
} from "../../../shared/model/host-contracts/assistant";
function fixture() {
  let head: AssistantVoiceContext | undefined,
    active = true,
    visible = true,
    next = 0;
  const request = vi.fn(async (raw: AssistantRequest) => {
    const opened = AssistantVoiceContextOpenSchema.safeParse(raw);
    if (opened.success) {
      const input = opened.data;
      head = {
        id: `ctx-${++next}`,
        version: 1,
        environmentId: "host",
        threadId: input.threadId,
        generationKey: input.generationKey,
        ownerMessageId: input.ownerMessageId,
        status: "known",
        projectIds: ["p"],
        createdAt: 1,
        updatedAt: 1,
      };
      return { voiceContext: head };
    }
    const input = AssistantVoiceContextInvalidateSchema.parse(raw);
    if (!head || head.id !== input.id) throw new Error("foreign context");
    head = { ...head, status: "unknown", projectIds: undefined, version: head.version + 1 };
    return { voiceContext: head };
  });
  const binding: VoiceHistoryBinding = {
    request,
    remote: false,
    environmentId: async () => "host",
    current: () => visible,
    scope: async () => ({
      projectIds: ["p"],
      complete: true,
      current: () => visible,
      liveProjectIds: () => new Set(visible ? ["p"] : []),
    }),
    open: async () => {
      throw new Error("not used");
    },
  };
  const source = (id = "owner", text = "Owner text") =>
    Promise.resolve({
      message: {
        id,
        threadId: "thread",
        role: "user",
        via: "voice",
        text,
        jobIds: [],
        createdAt: 1,
      } as AssistantMessage,
      request,
    });
  const failed = vi.fn();
  let ids = 0;
  const generation = () =>
    new VoiceCausalGeneration(
      ["seed-a", "seed-b"],
      false,
      () => active,
      failed,
      () => `request-${++ids}`,
    );
  return {
    binding,
    request,
    source,
    generation,
    failed,
    get head() {
      return head!;
    },
    set visible(value: boolean) {
      visible = value;
    },
    set active(value: boolean) {
      active = value;
    },
  };
}
it("retains the immutable summary proof actually seeded across accepted turns",async()=>{
  const f=fixture();let requestId=0;
  const generation=new VoiceCausalGeneration([],true,()=>true,f.failed,()=>`summary-request-${++requestId}`,"original-summary-proof");
  await generation.accept(f.binding,f.source(),"Owner text");
  await generation.accept(f.binding,f.source("later-owner","Continue"),"Continue");
  expect(f.request.mock.calls.filter(([input])=>input.op==="voice.context.open").map(([input])=>input)).toEqual([
    expect.objectContaining({summaryUsed:true,summaryProofId:"original-summary-proof"}),
    expect.objectContaining({summaryUsed:true,summaryProofId:"original-summary-proof",previousContextId:expect.any(String)}),
  ]);
});
it("chains the exact initial canonical seeds and accepted owner receipts in one actual generation", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source(), "Owner text");
  const first = f.head;
  expect(await generation.proof()).toBe(first.id);
  await generation.accept(f.binding, f.source("owner-2", "Next text"), "Next text");
  expect(f.request.mock.calls[1][0]).toMatchObject({
    op: "voice.context.open",
    generationKey: first.generationKey,
    seedMessageIds: ["seed-a", "seed-b"],
    ownerMessageId: "owner-2",
    previousContextId: first.id,
    contextProjectIds: ["p"],
    summaryUsed: false,
  });
});
it("keeps unknown monotonic before disclosure and across new owner turns until an actual new generation", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source(), "Owner text");
  const invalidating = generation.invalidate("unverified-tool");
  expect(await generation.proof()).toBeUndefined();
  await invalidating;
  await generation.accept(f.binding, f.source("later", "New owner"), "New owner");
  expect(await generation.proof()).toBeUndefined();
  expect(f.request.mock.calls.at(-1)![0]).toMatchObject({ op: "voice.context.invalidate" });
  const rotated = f.generation();
  await rotated.accept(f.binding, f.source("new-connection", "Fresh owner"), "Fresh owner");
  expect(await rotated.proof()).toBeDefined();
});
it("does not turn a deferred open into known after an earlier unverified disclosure", async () => {
  const f = fixture(),
    generation = f.generation();
  let resolve!: () => void;
  const ready = new Promise<void>((done) => (resolve = done));
  const opening = generation.accept(
    f.binding,
    ready.then(() => f.source()),
    "Owner text",
  );
  const invalidating = generation.invalidate("unverified-tool");
  resolve();
  await opening;
  await invalidating;
  expect(await generation.proof()).toBeUndefined();
  expect(f.head.status).toBe("unknown");
});
it("requires every actual disclosure contributor to remain in captured and current visibility", async () => {
  for (const hiddenAfterRead of [false, true]) {
    const f = fixture(),
      generation = f.generation();
    await generation.accept(f.binding, f.source(), "Owner text");
    const tool = (await generation.tool())!;
    if (hiddenAfterRead) f.visible = false;
    expect(() =>
      tool.receive(
        f.head,
        {
          id: "proof",
          contextId: f.head.id,
          requestId: "tool-request",
          verified: true,
          projectIds: hiddenAfterRead ? ["p"] : ["p", "hidden"],
        },
        "tool-request",
      ),
    ).toThrow("could not be verified");
    expect(await generation.proof()).toBeUndefined();
  }
});
it("holds proof while tools are pending and accepts only the current exact result receipt", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source(), "Owner text");
  const tool = (await generation.tool())!,
    head = f.head;
  const disclosure = {
    id: "proof",
    contextId: head.id,
    requestId: "tool-request",
    verified: true,
    projectIds: ["p"],
  };
  tool.receive(
    { ...head, version: 2, status: "pending", projectIds: undefined },
    disclosure,
    "tool-request",
  );
  expect(await generation.proof()).toBeUndefined();
  tool.receive({ ...head, version: 3 }, disclosure, "tool-request");
  expect(await generation.proof()).toBe(head.id);
  expect(() =>
    tool.receive(
      { ...head, version: 4 },
      { ...disclosure, requestId: "different" },
      "tool-request",
    ),
  ).toThrow();
  expect(await generation.proof()).toBeUndefined();
});
it("rejects a foreign captured source or truncated owner text before context admission", async () => {
  const f = fixture();
  for (const text of ["different text", "Owner text plus unrecorded words"]) {
    const generation = f.generation();
    await generation.accept(f.binding, f.source(), text);
    expect(await generation.proof()).toBeUndefined();
  }
  expect(f.request).not.toHaveBeenCalled();
  const generation = f.generation();
  await generation.accept({ ...f.binding, request: vi.fn() }, f.source(), "Owner text");
  expect(await generation.proof()).toBeUndefined();
  expect(f.request).not.toHaveBeenCalled();
});
