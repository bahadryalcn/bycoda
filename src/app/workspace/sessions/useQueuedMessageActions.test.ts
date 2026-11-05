// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  QueueDeferredError,
  QueueNotReadyError,
} from "../../../features/connections/model/sharedQueue";
import { trackLateSettlement } from "../../../features/sessions/model/deliveryReview";
import type { DeliverySettlement } from "../../../shared/lib/deliveryUnknown";
import { useQueuedMessageActions } from "./useQueuedMessageActions";
import { requeueQueuedRowHead } from "./submit/submitBusySteer";
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
  // The send gate reads the budget itself: a refusal from `assert` is a budget reached.
  createBudgetReader: () => async () => {
    try {
      return (await budget.assert()) ?? { state: "ok" };
    } catch {
      return { state: "exceeded" };
    }
  },
  blockingUsageBudgets: budget.rules,
}));
vi.mock("../../../features/connections/model/useSharedLocalQueues", () => ({
  sharedLocalQueueReady: () => true,
  sharedLocalQueueLeaseHeld: () => false,
  settleSharedSend: async () => undefined,
  sharedLocalDeliveryUnconfirmed: async () => false,
  resumeSharedLocalQueue: (...args: unknown[]) => shared.resume(...args),
  requeueSharedLocalHead: () => false,
  sharedLocalQueueKept: () => false,
  wakeSharedLocalQueues: () => undefined,
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

it.each([QueueNotReadyError, QueueDeferredError])(
  "keeps an active queue running and offers its head again after %s",
  async (WaitError) => {
    // Another computer changed the queue, or the host was busy, while the head was
    // being claimed. Nothing was sent: that is a wait, not "you interrupted".
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new WaitError("The shared queue changed."))
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
      if (WaitError === QueueDeferredError) {
        // The first safe deferral explains the wait once; the queue is not paused.
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            type: "status",
            text: expect.stringContaining("will be retried automatically"),
          }),
        );
      } else {
        expect(enqueue).not.toHaveBeenCalled();
      }
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
  },
);

it("keeps retrying repeated safe deferrals with capped backoff without removing or replaying the head", async () => {
  vi.useFakeTimers();
  const submit = vi.fn<Submit>(() => Promise.reject(new QueueDeferredError("Turn not ready")));
  const harness = await queueHarness("active", false, submit);
  try {
    // Retry delays double from 2 s and cap at 60 s: attempts land at 0, 2, 6, 14, 30, 62, 122 s.
    for (const [index, delay] of [1, 2_001, 4_001, 8_001, 16_001, 32_001, 60_001].entries()) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(submit).toHaveBeenCalledTimes(index + 1);
    }
    expect(getSessions()[0].queueStatus).toBe("active");
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
    // The cap holds: the next attempt is 60 s after the seventh, not later and not sooner.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_500);
    });
    expect(submit).toHaveBeenCalledTimes(7);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(submit).toHaveBeenCalledTimes(8);
    expect(getSessions()[0].queueStatus).toBe("active");
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
  } finally {
    await harness.cleanup();
    vi.useRealTimers();
  }
});

it("pauses only after real refusals: deferrals neither count nor reset the count", async () => {
  vi.useFakeTimers();
  // Real refusals are `false`; a deferral is a temporary hold (busy elsewhere, turn changed).
  const outcomes: (boolean | Error)[] = [
    false,
    new QueueDeferredError("Busy elsewhere"),
    false,
    false,
    false,
  ];
  const submit = vi.fn<Submit>(() => {
    const next = outcomes.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? false);
  });
  const harness = await queueHarness("active", false, submit);
  try {
    // Retry delays double from 2 s: the attempts land at 0, 2, 6, 14 and 30 s.
    for (const delay of [1, 2_001, 4_001, 8_001, 16_001]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    expect(submit).toHaveBeenCalledTimes(5);
    // The fourth real refusal, at 30 s, pauses the queue; the deferral does not count.
    expect(getSessions()[0].queueStatus).toBe("paused");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(submit).toHaveBeenCalledTimes(5);
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
  } finally {
    await harness.cleanup();
    vi.useRealTimers();
  }
});

it("keeps a queue active through repeated busy-elsewhere holds", async () => {
  vi.useFakeTimers();
  const submit = vi.fn<Submit>(() => Promise.reject(new QueueDeferredError("Busy elsewhere")));
  const harness = await queueHarness("active", false, submit);
  try {
    for (const delay of [1, 2_001, 4_001, 8_001, 16_001, 32_001, 60_001]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    // Attempts at 0, 2, 6, 14, 30, 62 and 122 s: every deferral was retried.
    expect(submit).toHaveBeenCalledTimes(7);
    expect(getSessions()[0].queueStatus).toBe("active");
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
  } finally {
    await harness.cleanup();
    vi.useRealTimers();
  }
});

/** A provider refusal after an accepted dispatch: the row goes back to the head, as the dispatcher does. */
function refuseAfterAccept(
  sessionId: string,
  text: string,
  attachments: unknown[],
  options?: Parameters<Submit>[3],
) {
  requeueQueuedRowHead(
    sessionId,
    { sessionId, text, attachments, options } as Parameters<typeof requeueQueuedRowHead>[1],
    { storedCurrent: getSessions()[0] } as unknown as SubmitPreflight,
  );
  return true;
}

it("spaces repeated provider refusals of the queued head by the backoff and never pauses the queue", async () => {
  vi.useFakeTimers();
  const submit = vi.fn<Submit>((sessionId, text, attachments, options) =>
    refuseAfterAccept(sessionId, text, attachments, options),
  );
  const harness = await queueHarness("active", false, submit);
  // Effects flush at each act boundary, so a tick flushes before and after advancing:
  // a retry scheduled or a dispatch queued at the current time lands where it belongs.
  const tick = async (ms: number) => {
    for (const step of [0, ms, 0])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
  };
  try {
    // Offers at 0, 2, 6, 14 and 30 s: each refusal waits the next doubled delay.
    await tick(1);
    expect(submit).toHaveBeenCalledTimes(1);
    let at = 1;
    for (const [index, next] of [2_000, 6_000, 14_000, 30_000].entries()) {
      await tick(next - 1 - at);
      at = next - 1;
      expect(submit).toHaveBeenCalledTimes(index + 1);
      await tick(2);
      at = next + 1;
      expect(submit).toHaveBeenCalledTimes(index + 2);
      expect(getSessions()[0].queueStatus).toBe("active");
      expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
    }
  } finally {
    await harness.cleanup();
    vi.useRealTimers();
  }
});

it("starts the backoff afresh for the next row once a row was sent after refusals", async () => {
  vi.useFakeTimers();
  let headRefusals = 2;
  const submit = vi.fn<Submit>((sessionId, text, attachments, options) => {
    if (options?.queuedMessageId === "head" && headRefusals === 0) {
      // The provider takes the head now: the row leaves the queue as it is sent.
      setSessions((all) =>
        all.map((session) =>
          session.id === sessionId ? sentQueuedMessage(session, "head") : session,
        ),
      );
      return true;
    }
    if (options?.queuedMessageId === "head") headRefusals -= 1;
    return refuseAfterAccept(sessionId, text, attachments, options);
  });
  const harness = await queueHarness("active", false, submit, {
    queuedMessages: [
      { id: "head", text: "Saved task", attachments: [] },
      { id: "tail", text: "Next task", attachments: [] },
    ],
  });
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    // Effects run at the act flush, after the clock moved: their zero-delay dispatch fires here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  try {
    // The head is refused at 0 s and 2 s (delays 2 s, 4 s) and sent at 6 s. The tail is
    // refused at 6 s and its next offer waits the first delay again, about 2 s later. A
    // streak that carried on would wait 8 s, so the tail is still refused at 12 s.
    await tick(1);
    expect(submit).toHaveBeenCalledTimes(1);
    await tick(2_000);
    expect(submit).toHaveBeenCalledTimes(2);
    await tick(4_000);
    expect(submit).toHaveBeenCalledTimes(3);
    await tick(1_000);
    expect(submit).toHaveBeenCalledTimes(4);
    expect(submit).toHaveBeenLastCalledWith(
      harness.id,
      "Next task",
      [],
      expect.objectContaining({ queuedMessageId: "tail" }),
    );
    await tick(5_000);
    expect(submit).toHaveBeenCalledTimes(5);
    expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["tail"]);
    expect(getSessions()[0].queueStatus).toBe("active");
  } finally {
    await harness.cleanup();
    vi.useRealTimers();
  }
});

it.each(["paused", "restored"] as const)(
  "returns waiting when a manual steer is deferred from a %s queue",
  async (status) => {
    const submit = vi.fn<Submit>(() => Promise.reject(new QueueDeferredError("Turn not ready")));
    const harness = await queueHarness(status, true, submit);
    try {
      await act(async () => {
        expect(await harness.actions.onSteerQueuedMessage(harness.id, "head")).toEqual({
          kind: "waiting",
          message: "Turn not ready",
        });
      });
      expect(getSessions()[0].queueStatus).toBe(status);
      expect(getSessions()[0].queuedMessages?.map((message) => message.id)).toEqual(["head"]);
      expect(submit).toHaveBeenCalledOnce();
    } finally {
      await harness.cleanup();
    }
  },
);

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
