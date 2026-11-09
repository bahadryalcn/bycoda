// @vitest-environment happy-dom
// Isolated fixture: actual Pi JSONL/parser, reducer and persistence admission;
// synthetic Native metadata and SQL ACKs never establish Native/FULL authority.
import { processConstructions } from "../processConstruction.testSupport";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";
import type { Session } from "../../../../features/sessions/model/session";

const mocks = vi.hoisted(() => ({
  line: null as null | ((line: string) => void),
  invoke: vi.fn(),
  write: vi.fn(),
  spawn: vi.fn(),
}));
const originalCleanups: Array<() => Promise<void>> = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolvePiBinary: async () => ({ path: "/fixture/pi" }),
    resolveOmpBinary: async () => ({ path: "/fixture/omp" }),
    spawnChild: mocks.spawn,
    killChild: async () => undefined,
    acquireHarnessBridge: async () => () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      mocks.line = line;
    },
    unwatchChild: () => undefined,
    writeChild: (id: string, line: string) => mocks.write(id, line),
  }),
);
beforeEach(() => {
  processConstructions.reset();
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  mocks.invoke.mockReset();
  mocks.write.mockReset();
  mocks.spawn.mockReset().mockResolvedValue(undefined);
  mocks.line = null;
});
afterEach(async () => {
  const outcomes = await Promise.allSettled(originalCleanups.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
  const failures = outcomes.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) throw new AggregateError(failures, "Original Pi fixture cleanup failed");
});

async function fixture(
  options: {
    framedSetup?: boolean;
    untrackedState?: boolean;
    flavor?: "pi" | "omp";
    model?: string;
    modelSettings?: Record<string, string>;
    state?: Record<string, unknown>;
    setModelData?: Record<string, unknown>;
    waitForPrompt?: boolean;
    manualSetModel?: boolean;
    manualState?: boolean;
  } = {},
) {
  const output = await import("../../core/nativeOutputDelivery");
  const { nativeOutputStream } = await import("../../core/nativeOutputDelivery.testSupport");
  const pi = await import("./piFamily");
  const { PI_FLAVOR, OMP_FLAVOR } = await import("./piFlavor");
  const flavor = options.flavor === "omp" ? OMP_FLAVOR : PI_FLAVOR;
  const model = await import("../../../../features/sessions/model/sessionsStore");
  const projection = await import("../../../../features/sessions/data/sessionOutputProjection");
  const persistence = await import("../../../../features/sessions/data/sessionStore");
  const { applyHarnessEvents } = await import("../../core/apply");
  const sessionId = "pi-native-lineage";
  // Retain the actual module/flavor that issued this fixture's handles. Module
  // reset happens only after all those source-owned stop obligations settle.
  originalCleanups.push(() => pi.stopSession(flavor, sessionId));
  const initial: Session = {
    id: sessionId,
    cwd: "/fixture",
    harness: flavor.id,
    model: options.model ?? `${flavor.id}:default`,
    modelSettings: options.modelSettings ?? {},
    runtimeMode: "supervised",
    title: "Fixture",
    context: { used: 0, window: 100 },
    blocks: [{ id: "user", role: "user", text: "fixture" }],
  };
  model.resetSessionsStore([initial]);
  let revision = 0;
  mocks.invoke.mockImplementation(async (_command: string, args: any) => ({
    ...args.session,
    updatedAt: ++revision,
    transcriptRevision: revision,
    nativeWriteId: "55555555-5555-4555-8555-555555555555",
  }));
  const deliver = nativeOutputStream(sessionId);
  function frame(record: object) {
    const line = JSON.stringify(record);
    return deliver(line, () => mocks.line!(line));
  }
  mocks.write.mockImplementation(async (_id: string, line: string) => {
    const command = JSON.parse(line);
    if (options.manualState && command.type === "get_state") return;
    if (options.manualSetModel && command.type === "set_model") return;
    const response = {
      type: "response",
      command: command.type,
      id: command.id,
      success: true,
      data:
        command.type === "get_state"
          ? (options.state ?? { sessionId: "provider-fixture" })
          : command.type === "set_model"
            ? (options.setModelData ?? {})
            : command.type === "set_fast_mode"
              ? { enabled: command.enabled }
              : {},
    };
    if (
      options.framedSetup &&
      !(options.untrackedState && command.type === "get_state") &&
      ["get_state", "set_model", "set_thinking_level", "set_fast_mode"].includes(command.type)
    )
      frame(response);
    else mocks.line!(JSON.stringify(response));
  });
  const events: HarnessEvent[] = [];
  function onEvent(event: HarnessEvent) {
    output.captureNativeOutputEvent(sessionId, event);
    events.push(event);
    const before = model.getSessions()[0];
    const next = applyHarnessEvents(before, [event]);
    if (next !== before) model.setSessions([next]);
    output.markNativeOutputEventsApplied(sessionId, [event]);
    projection.recordAppliedSessionOutput(next, [event]);
  }
  const done = pi.sendTurn(flavor, {
    sessionId,
    cwd: initial.cwd,
    model: initial.model,
    modelSettings: initial.modelSettings,
    runtimeMode: "supervised",
    text: "fixture",
    attachments: [],
    onEvent,
  });
  void done.catch(() => undefined);
  if (options.waitForPrompt !== false) {
    await vi.waitFor(() =>
      expect(mocks.write.mock.calls.some(([, line]) => JSON.parse(line).type === "prompt")).toBe(
        true,
      ),
    );
  }
  function fragment(delta: string) {
    return frame({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta },
    });
  }
  if (options.waitForPrompt !== false)
    frame({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        id: "tool",
        toolName: "bash",
      },
    });
  const current = () => model.getSessions()[0];
  async function stop() {
    await pi.cancelTurn(flavor, sessionId);
    await done.catch(() => undefined);
    await pi.stopSession(flavor, sessionId);
  }
  return {
    output,
    pi,
    flavor,
    sessionId,
    projection,
    persistence,
    events,
    onEvent,
    done,
    current,
    frame,
    fragment,
    stop,
  };
}

it("joins actual startup state/model responses into initialization and later context-window projection", async () => {
  const f = await fixture({
    framedSetup: true,
    model: "pi:fixture/selected",
    state: {
      sessionId: "initial-provider",
      model: { provider: "fixture", id: "initial", contextWindow: 1024 },
    },
    setModelData: { contextWindow: 4096 },
  });
  let inspect!: ReturnType<typeof f.frame>;
  try {
    const started = f.events.find((event) => event.type === "session.started")!;
    const bound = f.events.find((event) => event.type === "session.providerBound")!;
    for (const event of [started, bound]) {
      const origin = f.output.getNativeOutputEventOrigin(event)!;
      await vi.waitFor(() =>
        expect(f.output.getNativeOutputEventOriginComparisons(origin)).toHaveLength(2),
      );
      expect(
        f.output.getNativeOutputEventOriginComparisons(origin)!.map((item) => item.batch.sequence),
      ).toEqual([1, 2]);
    }
    inspect = f.frame({ type: "message_update", usage: { totalTokens: 12 } });
    const context = f.events.findLast((event) => event.type === "context")!;
    expect(context).toEqual({ type: "context", used: 12, window: 4096 });
    const origin = f.output.getNativeOutputEventOrigin(context)!;
    await vi.waitFor(() =>
      expect(f.output.getNativeOutputEventOriginComparisons(origin)).toHaveLength(3),
    );
    expect(
      f.output.getNativeOutputEventOriginComparisons(origin)!.map((item) => item.batch.sequence),
    ).toEqual([1, 2, 4]);
    await f.persistence.upsertSession(f.current());
    const candidate = f.projection.getSessionOutputFullCandidate(f.current())!;
    await vi.waitFor(() =>
      expect(f.projection.getSessionOutputFullCandidateComparison(candidate)).not.toBeNull(),
    );
    const comparison = f.projection.getSessionOutputFullCandidateComparison(candidate)!;
    expect(comparison.items.map((item) => item.batch.sequence)).toEqual([1, 2, 3, 4]);
    expect(comparison).toMatchObject({
      qualified: false,
      fullCheckpoint: false,
      applicationThrough: null,
    });
    expect(inspect().unavailableReason).toBeNull();
    expect(inspect().pendingCausalWork).toBe(1); // retained live binding state
  } finally {
    await f.stop();
  }
  expect(inspect().pendingCausalWork).toBe(0);
});

it("retains actual OMP fast/thinking/config/binding updates in subsequent dependent events and the full candidate", async () => {
  const f = await fixture({
    flavor: "omp",
    framedSetup: true,
    modelSettings: { fast: "true" },
    state: {
      sessionId: "initial-provider",
      fastModeEnabled: false,
      model: { contextWindow: 1024 },
    },
  });
  try {
    // Exercise a subsequent real configuration response without queueing behind
    // the still-active turn; the actual OMP config update then changes capacity.
    f.frame({
      type: "prompt_result",
      id: JSON.parse(
        mocks.write.mock.calls.find(([, line]) => JSON.parse(line).type === "prompt")![1],
      ).id,
      agentInvoked: false,
    });
    await f.done;
    await f.pi.compactContext(f.flavor, {
      sessionId: f.sessionId,
      cwd: "/fixture",
      model: "omp:default",
      modelSettings: { fast: "true", thinking: "high" },
      runtimeMode: "supervised",
      onEvent: f.onEvent,
    });
    f.frame({
      type: "config_update",
      model: { provider: "fixture", id: "configured", contextWindow: 8192 },
      thinkingLevel: "high",
      fastModeEnabled: true,
    });
    f.frame({ type: "session_info_update", sessionId: "configured-provider" });
    const inspect = f.frame({ type: "message_update", usage: { totalTokens: 18 } });
    const context = f.events.findLast((event) => event.type === "context")!;
    expect(context).toEqual({ type: "context", used: 18, window: 8192 });
    const origin = f.output.getNativeOutputEventOrigin(context)!;
    await vi.waitFor(() =>
      expect(f.output.getNativeOutputEventOriginComparisons(origin)).toHaveLength(6),
    );
    expect(
      f.output.getNativeOutputEventOriginComparisons(origin)!.map((item) => item.batch.sequence),
    ).toEqual([1, 2, 5, 6, 7, 8]);
    await f.persistence.upsertSession(f.current());
    const candidate = f.projection.getSessionOutputFullCandidate(f.current())!;
    await vi.waitFor(() =>
      expect(f.projection.getSessionOutputFullCandidateComparison(candidate)).not.toBeNull(),
    );
    expect(
      f.projection
        .getSessionOutputFullCandidateComparison(candidate)!
        .items.map((item) => item.batch.sequence),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(inspect().unavailableReason).toBeNull();
  } finally {
    await f.stop();
  }
});

it("preserves ordinary startup/config values without claiming a framed suffix of an untracked state response", async () => {
  const f = await fixture({
    framedSetup: true,
    untrackedState: true,
    model: "pi:fixture/selected",
    state: { sessionId: "initial-provider", model: { provider: "fixture", id: "initial" } },
    setModelData: { contextWindow: 4096 },
  });
  try {
    const initialized = f.events.filter(
      (event) => event.type === "session.started" || event.type === "session.providerBound",
    );
    expect(initialized).toHaveLength(2);
    expect(initialized.every((event) => f.output.getNativeOutputEventOrigin(event) === null)).toBe(
      true,
    );
    const inspect = f.frame({ type: "message_update", usage: { totalTokens: 12 } });
    expect(f.events.findLast((event) => event.type === "context")).toEqual({
      type: "context",
      used: 12,
      window: 4096,
    });
    expect(inspect().unavailableReason).toBe("pi-binding-input-untracked");
    await f.persistence.upsertSession(f.current());
    expect(f.projection.getSessionOutputFullCandidate(f.current())).toBeNull();
  } finally {
    await f.stop();
  }
});

it("bounds retained live configuration ancestry while preserving ordinary updates at capacity", async () => {
  const f = await fixture({ framedSetup: true, flavor: "omp" });
  try {
    for (let index = 0; index < 128; index++) {
      await vi.waitFor(
        () => {
          const stream = f.output.inspectNativeOutputDelivery(f.sessionId).streams[0];
          expect(stream.receivedThrough).toBe(stream.outcomes.length);
        },
        { interval: 1 },
      );
      f.frame({
        type: "config_update",
        model: { provider: "fixture", id: `model-${index}`, contextWindow: 4096 },
      });
    }
    const stream = f.output.inspectNativeOutputDelivery(f.sessionId).streams[0];
    expect(stream.unavailableReason).toBe("causal-join-capacity");
    const last = f.events.findLast((event) => event.type === "session.configChanged")!;
    expect(last).toMatchObject({ type: "session.configChanged", model: "omp:fixture/model-127" });
    expect(f.output.getNativeOutputEventOrigin(last)).toBeNull();
    expect(stream.pendingCausalWork).toBe(
      f.projection.sessionOutputStorageObservation(f.sessionId).pendingOrigins,
    );
    await f.persistence.upsertSession(f.current());
    expect(f.output.inspectNativeOutputDelivery(f.sessionId).streams[0].pendingCausalWork).toBe(0);
    expect(f.projection.getSessionOutputFullCandidate(f.current())).toBeNull();
  } finally {
    await f.stop();
  }
});

it.each(["failed", "cancelled"])(
  "retires real startup response ownership on %s startup and refuses late binding",
  async (action) => {
    const f = await fixture({
      framedSetup: true,
      model: "pi:fixture/selected",
      state: { sessionId: "initial-provider", model: { provider: "fixture", id: "initial" } },
      manualSetModel: true,
      waitForPrompt: false,
    });
    try {
      await vi.waitFor(() =>
        expect(
          mocks.write.mock.calls.some(([, line]) => JSON.parse(line).type === "set_model"),
        ).toBe(true),
      );
      expect(f.output.inspectNativeOutputDelivery(f.sessionId).streams[0].pendingCausalWork).toBe(
        1,
      );
      const command = JSON.parse(
        mocks.write.mock.calls.find(([, line]) => JSON.parse(line).type === "set_model")![1],
      );
      const rejected = expect(f.done).rejects.toThrow(
        action === "failed" ? "Model unavailable" : "startup cancelled",
      );
      if (action === "failed")
        f.frame({
          type: "response",
          id: command.id,
          command: "set_model",
          success: false,
          error: "Model unavailable",
        });
      else await f.pi.stopSession(f.flavor, f.sessionId);
      await rejected;
      expect(
        f.events.filter(
          (event) => event.type === "session.started" || event.type === "session.providerBound",
        ),
      ).toHaveLength(0);
      expect(f.output.inspectNativeOutputDelivery(f.sessionId).streams[0].pendingCausalWork).toBe(
        0,
      );
      const previousOutcomes = f.output.inspectNativeOutputDelivery(f.sessionId).streams[0].outcomes
        .length;
      const inspect = f.frame({
        type: "response",
        id: command.id,
        command: "set_model",
        success: true,
        data: { contextWindow: 9999 },
      });
      // A retired source declines new tracking; its ordinary late frame still
      // routes but cannot manufacture another retained original or binding.
      expect(inspect().outcomes).toHaveLength(previousOutcomes);
      expect(inspect().unavailableReason).not.toBeNull();
      expect(inspect().pendingCausalWork).toBe(0);
      expect(
        f.events.filter(
          (event) => event.type === "session.started" || event.type === "session.providerBound",
        ),
      ).toHaveLength(0);
    } finally {
      await f.stop();
    }
  },
);

it("cancels a delivered startup response before its actual consumer and prevents old-client ABA into a replacement", async () => {
  const f = await fixture({ manualState: true, waitForPrompt: false });
  let replacement: Promise<void> | undefined;
  try {
    await vi.waitFor(() =>
      expect(
        mocks.write.mock.calls.filter(([, line]) => JSON.parse(line).type === "get_state"),
      ).toHaveLength(1),
    );
    const oldLine = mocks.line!;
    const oldRequest = JSON.parse(mocks.write.mock.calls[0][1]);
    f.frame({
      type: "response",
      id: oldRequest.id,
      command: "get_state",
      success: true,
      data: { sessionId: "stale-before-consumer" },
    });
    const rejected = expect(f.done).rejects.toThrow("startup cancelled");
    await f.pi.stopSession(f.flavor, f.sessionId);
    await rejected;
    await vi.waitFor(() =>
      expect(f.output.inspectNativeOutputDelivery(f.sessionId).streams[0].pendingCausalWork).toBe(
        0,
      ),
    );
    expect(f.events.filter((event) => event.type === "session.providerBound")).toHaveLength(0);
    replacement = f.pi.sendTurn(f.flavor, {
      sessionId: f.sessionId,
      cwd: "/fixture",
      model: "pi:default",
      runtimeMode: "supervised",
      text: "replacement",
      attachments: [],
      onEvent: f.onEvent,
    });
    void replacement.catch(() => undefined);
    await vi.waitFor(() =>
      expect(
        mocks.write.mock.calls.filter(([, line]) => JSON.parse(line).type === "get_state"),
      ).toHaveLength(2),
    );
    const replacementRequest = JSON.parse(
      mocks.write.mock.calls.filter(([, line]) => JSON.parse(line).type === "get_state")[1][1],
    );
    expect(mocks.line).not.toBe(oldLine);
    // Both PiRpc instances begin at mc_1. A late original is delivered only to
    // its genuine old child callback and cannot satisfy the new client's waiter.
    expect(replacementRequest.id).toBe(oldRequest.id);
    oldLine(
      JSON.stringify({
        type: "response",
        id: oldRequest.id,
        command: "get_state",
        success: true,
        data: { sessionId: "stale-after-replacement" },
      }),
    );
    await Promise.resolve();
    expect(f.events.filter((event) => event.type === "session.providerBound")).toHaveLength(0);
    expect(mocks.spawn.mock.calls[1][2]).not.toContain("stale-before-consumer");
    mocks.line!(
      JSON.stringify({
        type: "response",
        id: replacementRequest.id,
        command: "get_state",
        success: true,
        data: { sessionId: "fresh-provider" },
      }),
    );
    await vi.waitFor(() =>
      expect(f.events.filter((event) => event.type === "session.providerBound")).toEqual([
        { type: "session.providerBound", providerSessionId: "fresh-provider" },
      ]),
    );
  } finally {
    await f.stop();
    await replacement?.catch(() => undefined);
  }
});

it("conserves two actual Pi JSON fragments into one accepted event and covering ordinary/FULL candidate", async () => {
  const f = await fixture();
  try {
    const inspect = f.fragment('{"command":"');
    const before = f.current();
    expect(f.events.filter((event) => event.type === "tool.updated")).toHaveLength(0);
    expect(inspect().outcomes.at(-1)).toMatchObject({ sequence: 2, outcome: "pending-parser" });
    await f.persistence.upsertSession(before);
    const early = f.projection.getSessionOutputFullCandidate(before)!;
    await vi.waitFor(() =>
      expect(f.projection.getSessionOutputFullCandidateComparison(early)).not.toBeNull(),
    );
    expect(
      f.projection
        .getSessionOutputFullCandidateComparison(early)!
        .items.map((item) => item.batch.sequence),
    ).toEqual([1]);
    f.fragment('echo conserved"}');
    const update = f.events.filter((event) => event.type === "tool.updated");
    expect(update).toHaveLength(1);
    const origin = f.output.getNativeOutputEventOrigin(update[0])!;
    expect(f.output.getNativeOutputEventOriginComparison(origin)).toBeNull();
    await vi.waitFor(() =>
      expect(f.output.getNativeOutputEventOriginComparisons(origin)).toHaveLength(2),
    );
    expect(
      f.output.getNativeOutputEventOriginComparisons(origin)!.map((item) => item.batch.sequence),
    ).toEqual([2, 3]);
    expect(f.projection.getSessionOutputFullCandidateComparison(early)).toBeNull();
    expect(f.projection.sessionOutputStorageObservation(f.sessionId).pendingOrigins).toBe(2);
    await f.persistence.upsertSession(f.current());
    const candidate = f.projection.getSessionOutputFullCandidate(f.current())!;
    await vi.waitFor(() =>
      expect(f.projection.getSessionOutputFullCandidateComparison(candidate)).not.toBeNull(),
    );
    const comparison = f.projection.getSessionOutputFullCandidateComparison(candidate)!;
    expect(comparison.items.map((item) => item.batch.sequence)).toEqual([1, 2, 3]);
    expect(comparison).toMatchObject({
      qualified: false,
      fullCheckpoint: false,
      applicationThrough: null,
    });
    expect(f.projection.sessionOutputStorageObservation(f.sessionId).pendingOrigins).toBe(0);
    expect(inspect().outcomes.slice(1)).toMatchObject([
      { outcome: "accepted-projection" },
      { outcome: "accepted-projection" },
    ]);
  } finally {
    await f.stop();
  }
});

it("keeps late ACK of a pre-completion write from covering the new multi-fragment event", async () => {
  const f = await fixture();
  try {
    const inspect = f.fragment('{"command":"');
    let release!: (value: object) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const before = f.current();
    const saving = f.persistence.upsertSession(before);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    f.fragment('echo after-admission"}');
    const current = f.current();
    expect(current).not.toBe(before);
    release({
      id: f.sessionId,
      updatedAt: 1,
      transcriptRevision: 1,
      nativeWriteId: "55555555-5555-4555-8555-555555555555",
    });
    await saving;
    expect(f.projection.getSessionOutputFullCandidate(before)).toBeNull();
    expect(f.projection.getSessionOutputFullCandidate(current)).toBeNull();
    expect(f.projection.sessionOutputStorageObservation(f.sessionId).pendingOrigins).toBe(2);
    // Parser ownership plus both actual projection owners survive the old ACK.
    expect(inspect().pendingCausalWork).toBe(3);
    await f.persistence.upsertSession(current);
    const candidate = f.projection.getSessionOutputFullCandidate(current)!;
    await vi.waitFor(() =>
      expect(f.projection.getSessionOutputFullCandidateComparison(candidate)).not.toBeNull(),
    );
    expect(
      f.projection
        .getSessionOutputFullCandidateComparison(candidate)!
        .items.map((item) => item.batch.sequence),
    ).toEqual([1, 2, 3]);
  } finally {
    await f.stop();
  }
});

it.each(["cancel", "replace", "final"])(
  "retires incomplete Pi parser ownership honestly on %s",
  async (action) => {
    const f = await fixture();
    try {
      const inspect = f.fragment('{"command":');
      expect(inspect().pendingCausalWork).toBeGreaterThan(0);
      if (action === "cancel") await f.pi.cancelTurn(f.flavor, f.sessionId);
      else if (action === "replace")
        f.frame({
          type: "message_update",
          assistantMessageEvent: {
            type: "toolcall_start",
            contentIndex: 0,
            id: "replacement",
            toolName: "bash",
          },
        });
      else
        f.frame({
          type: "message_update",
          assistantMessageEvent: {
            type: "toolcall_end",
            toolCall: { id: "tool", name: "bash", arguments: { command: "complete-snapshot" } },
          },
        });
      expect(inspect().unavailableReason).toMatch(/pi-fragment/);
      // The parser owner is gone; genuine accepted-model owners still await their
      // actual ordinary save rather than being dropped by parser retirement.
      expect(inspect().pendingCausalWork).toBe(
        f.projection.sessionOutputStorageObservation(f.sessionId).pendingOrigins,
      );
      await f.persistence.upsertSession(f.current());
      expect(inspect().pendingCausalWork).toBe(0);
      expect(inspect().outcomes[1]).toMatchObject({ outcome: "unsupported" });
    } finally {
      await f.stop();
    }
  },
);

it("keeps ordinary Pi updates usable when 129 genuine fragments exceed bounded lineage capacity", async () => {
  const f = await fixture();
  try {
    let inspect = f.fragment('{"command":"');
    for (let index = 0; index < 128; index++) {
      await vi.waitFor(() => expect(inspect().receivedThrough).toBe(inspect().outcomes.length), {
        interval: 1,
      });
      inspect = f.fragment(index === 127 ? '"}' : "x");
    }
    expect(inspect().unavailableReason).toBe("causal-join-capacity");
    await f.persistence.upsertSession(f.current());
    expect(inspect().pendingCausalWork).toBe(0);
    const update = f.events.find((event) => event.type === "tool.updated")!;
    expect(update).toBeDefined();
    expect(f.output.getNativeOutputEventOrigin(update)).toBeNull();
  } finally {
    await f.stop();
  }
});
