import { afterEach, expect, it, vi } from "vitest";
import { steerBusySubmit } from "./submitBusySteer";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import { newSession } from "../../../../features/sessions/model/session";
import { getSessions, resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";

afterEach(() => resetSessionsStore([]));

it.each([false, true])(
  "retains explicit Queue through busy=%s with a pending provider switch",
  (busy) => {
    const session = { ...newSession("claude", "/repo"), busy, model: "claude:opus" };
    resetSessionsStore([session]);
    const ctx = { refs: {}, dismissNoticesForContinuedSession: vi.fn() } as unknown as SubmitDeps;
    const input: SubmitInput = {
      sessionId: session.id,
      text: "after this turn",
      attachments: [],
      options: { followUpBehavior: "queue" },
    };
    const pre = {
      storedCurrent: session,
      current: session,
      intent: "default",
      pendingSwitch: {},
    } as SubmitPreflight;
    expect(steerBusySubmit(ctx, input, pre)).toBe(true);
    expect(getSessions()[0].blocks).toEqual(session.blocks);
    expect(getSessions()[0].queuedMessages).toMatchObject([
      { text: input.text, modelTarget: { harness: "claude", model: "claude:opus" } },
    ]);
  },
);
