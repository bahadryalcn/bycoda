// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { QueueNotReadyError } from "../../../features/connections/model/sharedQueue";
import { trackLateSettlement } from "../../../features/sessions/model/deliveryReview";
import type { DeliverySettlement } from "../../../shared/lib/deliveryUnknown";
import { useQueuedMessageActions } from "./useQueuedMessageActions";
import { gateUsageBudget } from "./submit/submitUsageBudget";
import type { SubmitDeps, SubmitPreflight } from "./submit/submitTypes";
import type { Submit } from "../helpers/types";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { sentQueuedMessage } from "../../../features/sessions/model/messageQueue";
import {
  getSessions,
  resetSessionsStore,
  sessionsRef,
  setSessions,
  useLiveSessions,
} from "../../../features/sessions/model/sessionsStore";

const budget = vi.hoisted(() => ({ assert: vi.fn(), rules: vi.fn() }));
const shared = vi.hoisted(() => ({
  resume: vi.fn<(...args: unknown[]) => Promise<"resumed" | "pending" | "review">>(
    async () => "resumed",
  ),
}));
vi.mock("../../../features/usage/model/usageBudgetReadings", () => ({
  assertUsageBudgets: budget.assert,
  blockingUsageBudgets: budget.rules,
}));
vi.mock("../../../features/connections/model/useSharedLocalQueues", () => ({
  sharedLocalQueueReady: () => true,
  sharedLocalQueueLeaseHeld: () => false,
  settleSharedSend: async () => undefined,
  sharedLocalDeliveryUnconfirmed: async () => false,
  resumeSharedLocalQueue: (...args: unknown[]) => shared.resume(...args),
}));

async function queueHarness(
  status: "paused" | "restored" | "active",
  busy: boolean,
  submit: Submit,
  patch: Partial<Session> = {},
  onStop: (sessionId: string) => void = () => undefined,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = {
    ...newSession("codex", "/fake"),
    busy,
    queueStatus: status,
    queuedMessages: [{ id: "head", text: "Saved task", attachments: [] }],
    ...patch,
  };
  resetSessionsStore([initial]);
  let actions!: ReturnType<typeof useQueuedMessageActions>;
  function Harness() {
    const sessions = useLiveSessions();
    const moves = useRef(new Set<string>());
    const retiring = useRef(new Map<string, number>());
    const pending = useRef(false);
    actions = useQueuedMessageActions({
      sessions,
      sessionsRef,
      setSessions,
      movingWindows: moves.current,
      movingSessionIds: moves,
      retiringTurns: retiring,
      windowTransferPending: false,
      windowTransferPendingRef: pending,
      onSubmit: submit,
      enqueueHarnessEvent: vi.fn(),
      flushHarnessEvents: vi.fn(),
      onStopRef: { current: onStop },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  return {
    id: initial.id,
    actions,
    cleanup: async () => {
      await act(async () => root.unmount());
      resetSessionsStore([]);
      vi.unstubAllGlobals();
    },
  };
}

it("stops the running turn before steering a row queued for another model", async () => {
  const running = { harness: "codex" as const, model: "running", modelSettings: {} };
  const saved = { ...running, model: "saved" };
  const submit = vi.fn<Submit>((sessionId, _text, _attachments, options) => {
    expect(getSessions()[0].busy).toBe(false);
    // Accepted production submits consume their queued row before returning.
    setSessions((all) =>
      all.map((session) =>
        session.id === sessionId
          ? { ...sentQueuedMessage(session, options!.queuedMessageId!), busy: true }
          : session,
      ),
    );
    return true;
  });
  const stop = vi.fn((sessionId: string) =>
    setSessions((all) =>
      all.map((s) => (s.id === sessionId ? { ...s, busy: false, queueStatus: "paused" } : s)),
    ),
  );
  const harness = await queueHarness(
    "active",
    true,
    submit,
    {
      runningModelTarget: running,
      queuedMessages: [
        { id: "head", text: "Saved task", attachments: [], modelTarget: saved },
        { id: "tail", text: "Next task", attachments: [], modelTarget: saved },
      ],
    },
    stop,
  );
  try {
    await act(async () => {
      expect(await harness.actions.onSteerQueuedMessage(harness.id, "head")).toBe(true);
    });
    expect(stop).toHaveBeenCalledExactlyOnceWith(harness.id);
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      harness.id,
      "Saved task",
      [],
      expect.objectContaining({ queuedMessageId: "head", followUpBehavior: "steer" }),
    );
    expect(getSessions()[0].queueStatus).toBe("active");
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["tail"]);
  } finally {
    await harness.cleanup();
  }
});

it("steers a row queued for the running model without stopping the turn", async () => {
  const running = { harness: "codex" as const, model: "running", modelSettings: {} };
  const submit = vi.fn<Submit>(() => true);
  const stop = vi.fn();
  const harness = await queueHarness(
    "active",
    true,
    submit,
    {
      runningModelTarget: running,
      queuedMessages: [{ id: "head", text: "Saved task", attachments: [], modelTarget: running }],
    },
    stop,
  );
  try {
    await act(async () => {
      expect(await harness.actions.onSteerQueuedMessage(harness.id, "head")).toBe(true);
    });
    expect(stop).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  } finally {
    await harness.cleanup();
  }
});

it("resumes a busy queue without submitting an extra continue turn", async () => {
  const submit = vi.fn<Submit>(() => true);
  const harness = await queueHarness("paused", true, submit);
  try {
    await act(async () => {
      expect(await harness.actions.onResumeQueue(harness.id)).toMatchObject({ kind: "waiting" });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(getSessions()[0].queueStatus).toBe("active");
  } finally {
    await harness.cleanup();
  }
});

it("sends the restored head on Resume instead of a synthetic continue message", async () => {
  const submit = vi.fn<Submit>(() => false);
  const harness = await queueHarness("restored", false, submit);
  try {
    await act(async () => {
      expect(await harness.actions.onResumeQueue(harness.id)).toBe(false);
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      harness.id,
      "Saved task",
      [],
      expect.objectContaining({ queuedMessageId: "head" }),
    );
    expect(getSessions()[0].queueStatus).toBe("restored");
    expect(getSessions()[0].queuedMessages).toHaveLength(1);
  } finally {
    await harness.cleanup();
  }
});

it("resumes an idle paused queue by releasing it, never by sending a continue message", async () => {
  const submit = vi.fn<Submit>(() => true);
  shared.resume.mockClear();
  const harness = await queueHarness("paused", false, submit);
  try {
    let result: unknown;
    await act(async () => {
      result = await harness.actions.onResumeQueue(harness.id);
    });
    expect(result).toMatchObject({ kind: "waiting" });
    expect(shared.resume).toHaveBeenCalledOnce();
    expect(getSessions()[0].queueStatus).toBe("active");
    // The head is the only thing the dispatcher may send; Resume itself sends nothing.
    expect(submit).not.toHaveBeenCalledWith(
      harness.id,
      "Continue from where you left off.",
      expect.anything(),
      expect.anything(),
    );
    expect(
      submit.mock.calls.every(
        ([, text, , options]) => options?.queuedMessageId === "head" && text === "Saved task",
      ),
    ).toBe(true);
  } finally {
    await harness.cleanup();
  }
});

it("does not undo Stop while Resume is waiting for the shared release", async () => {
  let release!: (value: "resumed") => void;
  shared.resume.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const submit = vi.fn<Submit>(() => true);
  const harness = await queueHarness("paused", false, submit);
  try {
    let result!: ReturnType<typeof harness.actions.onResumeQueue>;
    await act(async () => {
      result = harness.actions.onResumeQueue(harness.id);
    });
    expect(getSessions()[0].queueStatus).toBe("resuming");
    await act(async () => setSessions((all) => all.map((s) => ({ ...s, queueStatus: "paused" }))));
    await act(async () => {
      release("resumed");
      await result;
    });
    expect(getSessions()[0].queueStatus).toBe("paused");
  } finally {
    await harness.cleanup();
  }
});

it("holds a budget-rejected head exactly once until an explicit queue resume", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  budget.rules.mockReturnValue([{}]);
  budget.assert.mockRejectedValue(new Error("Budget reached"));
  const head = { id: "head", text: "Retained task", attachments: [] };
  const tail = { id: "tail", text: "Later task", attachments: [] };
  const initial = {
    ...newSession("codex", "/fake"),
    busy: false,
    queueStatus: "active" as const,
    queuedMessages: [head, tail],
  };
  resetSessionsStore([initial]);
  const ctx = {
    refs: { turnGen: { current: new Map() } },
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
  } as unknown as SubmitDeps;
  const provider = vi.fn(() => true);
  const submit = vi.fn<Submit>((sessionId, text, attachments, options) => {
    const current = getSessions()[0];
    return gateUsageBudget(
      ctx,
      { sessionId, text, attachments, options },
      { current, storedCurrent: current, intent: "default" } as SubmitPreflight,
      provider,
    )!;
  });
  function Harness() {
    const sessions = useLiveSessions();
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const moves = useRef(new Set<string>());
    const retiring = useRef(new Map<string, number>());
    const pending = useRef(false);
    useQueuedMessageActions({
      sessions,
      sessionsRef,
      setSessions,
      movingWindows: moves.current,
      movingSessionIds: moves,
      retiringTurns: retiring,
      windowTransferPending: false,
      windowTransferPendingRef: pending,
      onSubmit: submit,
      enqueueHarnessEvent: ctx.enqueueHarnessEvent,
      flushHarnessEvents: ctx.flushHarnessEvents,
      onStopRef: { current: () => undefined },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const drain = async () => {
    for (let n = 0; n < 5; n++)
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      });
  };
  try {
    await act(async () => root.render(createElement(Harness)));
    await drain();
    expect(budget.assert).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
    expect(getSessions()[0]).toMatchObject({
      busy: false,
      queueStatus: "paused",
      queuedMessages: [head, tail],
    });
    await act(async () => setSessions((all) => all.map((s) => ({ ...s, queueStatus: "active" }))));
    await drain();
    expect(budget.assert).toHaveBeenCalledTimes(2);
    expect(getSessions()[0]).toMatchObject({ queueStatus: "paused", queuedMessages: [head, tail] });
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});

it("keeps an active queue running and offers its head again when the shared queue could not be coordinated", async () => {
  // Another computer changed the queue, or the host was busy, while the head was
  // being claimed. Nothing was sent: that is a wait, not "you interrupted".
  const submit = vi
    .fn<Submit>()
    .mockRejectedValueOnce(new QueueNotReadyError("The shared queue changed."))
    .mockResolvedValue(true);
  const enqueue = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([
    {
      ...newSession("codex", "/fake"),
      busy: false,
      queueStatus: "active",
      queuedMessages: [{ id: "head", text: "Saved task", attachments: [] }],
    },
  ]);
  function Harness() {
    const sessions = useLiveSessions();
    const moves = useRef(new Set<string>());
    const retiring = useRef(new Map<string, number>());
    const pending = useRef(false);
    useQueuedMessageActions({
      sessions,
      sessionsRef,
      setSessions,
      movingWindows: moves.current,
      movingSessionIds: moves,
      retiringTurns: retiring,
      windowTransferPending: false,
      windowTransferPendingRef: pending,
      onSubmit: submit,
      enqueueHarnessEvent: enqueue,
      flushHarnessEvents: vi.fn(),
      onStopRef: { current: () => undefined },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getSessions()[0].queueStatus).toBe("active");
    expect(enqueue).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_300));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(getSessions()[0].queueStatus).toBe("active");
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});

it("does not resume a queue while a given-up send may still be answered, and does after it was", async () => {
  const submit = vi.fn<Submit>(() => true);
  shared.resume.mockClear();
  const harness = await queueHarness("paused", false, submit);
  try {
    let answer!: (value: DeliverySettlement) => void;
    trackLateSettlement(
      harness.id,
      new Promise<DeliverySettlement>((resolve) => (answer = resolve)),
    );
    let result: unknown;
    await act(async () => {
      result = await harness.actions.onResumeQueue(harness.id);
    });
    expect(result).toMatchObject({
      kind: "waiting",
      message: expect.stringContaining("may still deliver this message"),
    });
    expect(shared.resume).not.toHaveBeenCalled();
    expect(getSessions()[0].queueStatus).toBe("paused");
    await act(async () => answer("rejected"));
    await act(async () => {
      result = await harness.actions.onResumeQueue(harness.id);
    });
    expect(shared.resume).toHaveBeenCalledOnce();
    expect(getSessions()[0].queueStatus).toBe("active");
  } finally {
    await harness.cleanup();
  }
});
