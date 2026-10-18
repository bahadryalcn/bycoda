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
}));

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
