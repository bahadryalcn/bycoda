import { expect, it, vi } from "vitest";
import { VoiceCausalGeneration, VoiceContextScopeUnavailable } from "./voiceCausalContext";
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
it("registers the exact seed before connecting and rejects revoked pending registration", async () => {
  let current = true;
  const ack = Promise.withResolvers<{ ok: boolean }>();
  const request = vi.fn(() => ack.promise);
  const binding = {
    request, remote: false, current: () => current,
    open: async () => ({ thread: { id: "thread" }, messages: [], request }),
    environmentId: async () => "host",
    scope: async () => ({ complete: true, projectIds: [], current: () => current, liveProjectIds: () => new Set<string>() }),
  } as unknown as VoiceHistoryBinding;
  const generation = new VoiceCausalGeneration(["seed"], true, () => current, vi.fn(), () => "generation", "proof");
  const work = generation.bindRuntimeIdentity(binding);
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith({ op: "voice.runtime.register", threadId: "thread", generationKey: "generation", seedMessageIds: ["seed"], summaryProofId: "proof" }));
  current = false;
  ack.resolve({ ok: true });
  await expect(work).rejects.toThrow("not confirmed");
});
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
it("retains the immutable summary proof actually seeded across accepted turns", async () => {
  const f = fixture();
  let requestId = 0;
  const generation = new VoiceCausalGeneration(
    [],
    true,
    () => true,
    f.failed,
    () => `summary-request-${++requestId}`,
    "original-summary-proof",
  );
  await generation.accept(f.binding, f.source(), "Owner text");
  await generation.accept(f.binding, f.source("later-owner", "Continue"), "Continue");
  expect(
    f.request.mock.calls
      .filter(([input]) => input.op === "voice.context.open")
      .map(([input]) => input),
  ).toEqual([
    expect.objectContaining({ summaryUsed: true, summaryProofId: "original-summary-proof" }),
    expect.objectContaining({
      summaryUsed: true,
      summaryProofId: "original-summary-proof",
      previousContextId: expect.any(String),
    }),
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
it("bounds invalidation behind a stuck owner receipt without restoring proof", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(),
      generation = f.generation();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const opening = generation.accept(
      f.binding,
      ready.then(() => f.source()),
      "Owner text",
    );
    const invalidating = generation.invalidate();
    await vi.advanceTimersByTimeAsync(5001);
    await invalidating;
    expect(f.failed).toHaveBeenCalledOnce();
    release();
    await opening;
    expect(await generation.proof()).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
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

it("keeps the newest context when an exact earlier tool response arrives out of order", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source(), "Owner text");
  const tool = (await generation.tool())!,
    head = f.head;
  const disclosure = (requestId: string) => ({
    id: "proof-" + requestId,
    contextId: head.id,
    requestId,
    verified: true,
    projectIds: ["p"],
  });
  tool.receive({ ...head, version: 5 }, disclosure("second"), "second");
  expect(() =>
    tool.receive(
      { ...head, version: 4, status: "pending", projectIds: undefined },
      disclosure("first"),
      "first",
    ),
  ).not.toThrow();
  expect(await generation.context()).toMatchObject({ id: head.id, version: 5, status: "known" });
  expect(await generation.proof()).toBe(head.id);
});

it("does not replace a new owner turn's head with the result of its captured earlier turn", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source("first-owner"), "Owner text");
  const tool = (await generation.tool())!,
    old = f.head;
  await generation.accept(f.binding, f.source("second-owner"), "Owner text");
  const current = f.head;
  tool.receive(
    { ...old, version: 4 },
    { id: "proof", contextId: old.id, requestId: "earlier", verified: true, projectIds: ["p"] },
    "earlier",
  );
  expect(await generation.context()).toMatchObject({
    id: current.id,
    ownerMessageId: "second-owner",
  });
  expect(await generation.proof()).toBe(current.id);
});

it.each(["desktop.status", "desktop.snapshot", "browser.open"])(
  "accepts authenticated %s output without certifying it for retained history",
  async (action) => {
    const f = fixture(),
      generation = f.generation();
    await generation.accept(f.binding, f.source(), "Owner text");
    const head = f.head,
      tool = (await generation.tool())!;
    const source = {
      environmentId: "host",
      projectId: "p",
      threadId: "thread",
      family: "conversation" as const,
      action,
    };
    expect(() =>
      tool.receive(
        {
          ...head,
          version: 2,
          status: "unknown",
          projectIds: undefined,
          reason: "unverified-tool",
        },
        { id: "operation-proof", contextId: head.id, requestId: "tool", verified: false, source },
        "tool",
        source,
      ),
    ).not.toThrow();
    expect(await generation.proof()).toBeUndefined();
    expect((await generation.context())?.status).toBe("unknown");
    expect(f.failed).not.toHaveBeenCalled();
    await generation.accept(f.binding, f.source("next-owner"), "Owner text");
    expect(await generation.proof()).toBeUndefined();
  },
);

it("accepts exact global Host/thread provenance without certifying data for history", async () => {
  const f = fixture(),
    generation = f.generation();
  await generation.accept(f.binding, f.source(), "Owner text");
  const tool = (await generation.tool())!,
    head = f.head;
  const source = {
    environmentId: "host",
    threadId: "thread",
    family: "conversation" as const,
    action: "preferences.read",
  };
  expect(tool.environmentId).toBe("host");
  expect(() =>
    tool.receive(
      { ...head, version: 2, status: "unknown", projectIds: undefined },
      { id: "proof", contextId: head.id, requestId: "global", verified: false, source },
      "global",
      source,
    ),
  ).not.toThrow();
  expect(await generation.proof()).toBeUndefined();
  expect(() =>
    tool.receive(
      { ...head, version: 3, status: "unknown", projectIds: undefined },
      {
        id: "proof",
        contextId: head.id,
        requestId: "global",
        verified: false,
        source: { ...source, projectId: "p" },
      },
      "global",
      source,
    ),
  ).toThrow("could not be verified");
});

it("refuses unscoped results without authenticated exact source metadata or with a hidden source project", async () => {
  for (const bad of ["missing", "foreign-host", "foreign-project", "hidden"]) {
    const f = fixture(),
      generation = f.generation();
    await generation.accept(f.binding, f.source(), "Owner text");
    const head = f.head,
      tool = (await generation.tool())!;
    const source = {
      environmentId: "host",
      projectId: "p",
      threadId: "thread",
      family: "conversation" as const,
      action: "desktop.status",
    };
    const received = {
      ...source,
      ...(bad === "foreign-host"
        ? { environmentId: "other" }
        : bad === "foreign-project"
          ? { projectId: "different" }
          : {}),
    };
    if (bad === "hidden") f.visible = false;
    expect(() =>
      tool.receive(
        { ...head, version: 2, status: "unknown", projectIds: undefined },
        {
          id: "proof",
          contextId: head.id,
          requestId: "tool",
          verified: false,
          ...(bad === "missing" ? {} : { source: received }),
        },
        "tool",
        source,
      ),
    ).toThrow();
    expect(await generation.proof()).toBeUndefined();
  }
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

it("reports an incomplete global directory as unavailable without granting proof, until a fresh generation", async () => {
  const f = fixture();
  const scope = await f.binding.scope!();
  const incomplete = {
    ...f.binding,
    global: true,
    scope: async () => ({ ...scope, complete: false }),
  };
  const generation = f.generation();
  await generation.accept(incomplete, f.source(), "Owner text");
  expect(f.failed).toHaveBeenCalledWith(expect.any(VoiceContextScopeUnavailable));
  expect(f.request).not.toHaveBeenCalled();
  expect(await generation.proof()).toBeUndefined();
  await generation.accept(f.binding, f.source("later"), "Owner text");
  expect(await generation.proof()).toBeUndefined();
  const fresh = f.generation();
  await fresh.accept(f.binding, f.source("fresh"), "Owner text");
  expect(await fresh.proof()).toBeDefined();
});

it("does not classify a foreign owner receipt as directory unavailability", async () => {
  const f = fixture();
  const scope = await f.binding.scope!();
  const incomplete = {
    ...f.binding,
    global: true,
    scope: async () => ({ ...scope, complete: false }),
  };
  await f.generation().accept(incomplete, f.source(), "different text");
  expect(f.failed).toHaveBeenCalledOnce();
  expect(f.failed.mock.calls[0][0]).not.toBeInstanceOf(VoiceContextScopeUnavailable);
  expect(f.request).not.toHaveBeenCalled();
});
