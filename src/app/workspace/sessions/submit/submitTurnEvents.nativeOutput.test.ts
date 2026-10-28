// @vitest-environment happy-dom
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../../../integrations/harness/core/types";
import type { Session } from "../../../../features/sessions/model/session";
import type { SubmitDeps, SubmitInput, SubmitPreflight, SubmitSetup } from "./submitTypes";
vi.mock("../../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { observe: vi.fn(), forSession: () => null },
}));
vi.mock("../../helpers/workspaceNotify", () => ({
  nudgeOpenEditors: vi.fn(),
  trackSessionEdits: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());
async function fixture(intent: string = "build") {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  const output = await import("../../../../integrations/harness/core/nativeOutputDelivery");
  const { createSubmitTurnEvents } = await import("./submitTurnEvents");
  const model = await import("../../../../features/sessions/model/sessionsStore");
  const queued: HarnessEvent[] = [];
  let accepted = false;
  const turnGen = { current: new Map([["session", 1]]) };
  const current: Session = {
    id: "session",
    cwd: "/fixture",
    harness: "claude",
    model: "fixture",
    title: "Fixture",
    blocks: [{ id: "user", role: "user", text: "hello" }],
  };
  model.resetSessionsStore([current]);
  const recover = vi.fn((session: Session) => ({ ...session, title: "Recovered old turn" }));
  const setup = {
    traceId: "fixture",
    gen: 1,
    commitSubmittedTurn: vi.fn(),
    turn: { proposalDraft: false, controlOutcome: {} },
  };
  const events = createSubmitTurnEvents(
    {
      enqueueHarnessEvent: (_id: string, event: HarnessEvent) => {
        output.captureNativeOutputEvent("session", event);
        queued.push(event);
      },
      deferWorkspaceWork: vi.fn(),
      refs: { retiringTurns: { current: new Map() }, turnGen },
    } as unknown as SubmitDeps,
    { sessionId: "session" } as SubmitInput,
    {
      current,
      intent,
      editedResend: {
        isAccepted: () => accepted,
        markAccepted: () => {
          accepted = true;
        },
        recoverAfterFailure: recover,
      },
    } as unknown as SubmitPreflight,
    setup as unknown as SubmitSetup,
    "/fixture",
  );
  function receive(event: HarnessEvent) {
    const items = [JSON.stringify(event)];
    const frame = output.frameNativeOutputItems("stdout", items);
    const tokens = output.observeNativeOutputBatch("session", "stdout", items, {
      version: 1,
      qualified: false,
      processEpoch: "11111111-1111-4111-8111-111111111111",
      streamEpoch: "22222222-2222-4222-8222-222222222222",
      streamKind: "process",
      sessionId: "session",
      sourceStoreId: "store",
      sourceProfileId: "profile",
      storeInstance: "33333333-3333-4333-8333-333333333333",
      processId: 42,
      ownerEpoch: "44444444-4444-4444-8444-444444444444",
      sequence: 1,
      channel: "stdout",
      itemCount: 1,
      utf8Bytes: new TextEncoder().encode(items[0]).length,
      payloadSha256: createHash("sha256").update(frame).digest("hex"),
      digestEncoding: "bycoda-output-items-le/v1",
      available: true,
      unavailableReason: null,
    });
    output.deliverNativeOutputItem(tokens![0], () => events.routeTurnEvent(event));
  }
  const state = () => output.inspectNativeOutputDelivery("session").streams[0];
  return { output, events, queued, receive, state, turnGen, setup, recover, model, current };
}
it("edited-resend replay preserves original event ownership after the parser scope returns", async () => {
  const f = await fixture();
  const event: HarnessEvent = { type: "message.delta", text: "retained" };
  f.receive(event);
  expect(f.queued).toHaveLength(0);
  expect(f.output.getNativeOutputEventOrigin(event)).not.toBeNull();
  f.events.acceptEditedResend();
  expect(f.queued).toEqual([event]);
  f.output.markNativeOutputEventsApplied("session", f.queued);
  expect(f.state()).toMatchObject({
    queuedEvents: 1,
    appliedEvents: 1,
    applicationThrough: null,
    unavailableReason: null,
  });
});
it("a buffered plan replacement transfers one logical event without a phantom queued origin", async () => {
  const f = await fixture("plan");
  const event: HarnessEvent = { type: "plan", text: "retained plan" };
  f.receive(event);
  f.events.acceptEditedResend();
  expect(f.queued).toHaveLength(1);
  expect(f.queued[0]).not.toBe(event);
  expect(f.output.getNativeOutputEventOrigin(f.queued[0])).toBe(
    f.output.getNativeOutputEventOrigin(event),
  );
  f.output.markNativeOutputEventsApplied("session", f.queued);
  expect(f.state()).toMatchObject({ queuedEvents: 1, appliedEvents: 1, unavailableReason: null });
});
it("a rejected edited resend cannot silently discard its captured output", async () => {
  const f = await fixture();
  f.receive({ type: "message.delta", text: "unaccepted" });
  f.events.recoverEditedResend();
  expect(f.queued).toHaveLength(0);
  expect(f.state().unavailableReason).toBe("edited-resend-not-accepted");
});
it("a retired turn invalidates original output rather than giving it a zero-event success", async () => {
  const f = await fixture();
  f.turnGen.current.set("session", 2);
  f.receive({ type: "message.delta", text: "stale" });
  expect(f.queued).toHaveLength(0);
  expect(f.state().unavailableReason).toBe("turn-generation-retired");
});

it.each(["accept", "recover"])(
  "a buffered old turn cannot %s after a newer generation starts",
  async (action) => {
    const f = await fixture();
    f.receive({ type: "message.delta", text: "old buffered data" });
    f.turnGen.current.set("session", 2);
    f.model.setSessions([{ ...f.current, title: "New turn" }]);
    if (action === "accept") f.events.acceptEditedResend();
    else f.events.recoverEditedResend();
    expect(f.queued).toHaveLength(0);
    expect(f.setup.commitSubmittedTurn).not.toHaveBeenCalled();
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.model.getSessions()[0].title).toBe("New turn");
    expect(f.state().unavailableReason).toBe("turn-generation-retired");
  },
);
