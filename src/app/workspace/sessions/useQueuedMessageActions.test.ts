// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useQueuedMessageActions } from "./useQueuedMessageActions";
import { gateUsageBudget } from "./submit/submitUsageBudget";
import type { SubmitDeps, SubmitPreflight } from "./submit/submitTypes";
import type { Submit } from "../helpers/types";
import { newSession } from "../../../features/sessions/model/session";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
  useLiveSessions,
} from "../../../features/sessions/model/sessionsStore";

const budget = vi.hoisted(() => ({ assert: vi.fn(), rules: vi.fn() }));
vi.mock("../../../features/usage/model/usageBudgetReadings", () => ({
  assertUsageBudgets: budget.assert,
  blockingUsageBudgets: budget.rules,
}));
vi.mock("../../../features/connections/model/useSharedLocalQueues", () => ({
  sharedLocalQueueReady: () => true,
  resumeSharedLocalQueue: async () => {},
}));

async function queueHarness(status: "paused" | "restored", busy: boolean, submit: Submit) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = {
    ...newSession("codex", "/fake"),
    busy,
    queueStatus: status,
    queuedMessages: [{ id: "head", text: "Saved task", attachments: [] }],
  };
  resetSessionsStore([initial]);
  let actions!: ReturnType<typeof useQueuedMessageActions>;
  function Harness() {
    const sessions = useLiveSessions();
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
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

it("awaits interrupted-turn acceptance and does not release the head after rejection", async () => {
  let finish!: (value: boolean) => void;
  const submit = vi.fn<Submit>(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const harness = await queueHarness("paused", false, submit);
  try {
    let result!: ReturnType<typeof harness.actions.onResumeQueue>;
    await act(async () => {
      result = harness.actions.onResumeQueue(harness.id);
    });
    expect(getSessions()[0].queueStatus).toBe("resuming");
    expect(await harness.actions.onResumeQueue(harness.id)).toBe(false);
    const rejected = expect(result).rejects.toThrow("still paused");
    await act(async () => {
      finish(false);
      await rejected;
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(getSessions()[0].queueStatus).toBe("paused");
    expect(getSessions()[0].queuedMessages).toHaveLength(1);
  } finally {
    await harness.cleanup();
  }
});

it("does not undo Stop while Resume is awaiting acceptance", async () => {
  let finish!: (value: boolean) => void;
  const submit = vi.fn<Submit>(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const harness = await queueHarness("paused", false, submit);
  try {
    let result!: ReturnType<typeof harness.actions.onResumeQueue>;
    await act(async () => {
      result = harness.actions.onResumeQueue(harness.id);
    });
    await act(async () => setSessions((all) => all.map((s) => ({ ...s, queueStatus: "paused" }))));
    await act(async () => {
      finish(true);
      expect(await result).toBe(false);
    });
    expect(getSessions()[0].queueStatus).toBe("paused");
    expect(submit).toHaveBeenCalledOnce();
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
