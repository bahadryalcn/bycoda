import { afterEach, expect, it, vi } from "vitest";
import { queueWhileStarting } from "./submitStarting";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import { QueueDeferredError } from "../../../../features/connections/model/sharedQueue";
import { newSession } from "../../../../features/sessions/model/session";
import { getSessions, resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";

afterEach(() => resetSessionsStore([]));

const ctx = { refs: {}, dismissNoticesForContinuedSession: vi.fn() } as unknown as SubmitDeps;

it("defers a queued row that meets a send still starting instead of refusing it", () => {
  const row = {
    id: "row-1",
    text: "next on codex",
    attachments: [],
    modelTarget: { harness: "codex" as const, model: "codex:gpt", modelSettings: {} },
  };
  const session = { ...newSession("claude", "/repo"), queuedMessages: [row] };
  resetSessionsStore([session]);
  const input: SubmitInput = {
    sessionId: session.id,
    text: row.text,
    attachments: [],
    options: { queuedMessageId: row.id },
  };
  const pre = { storedCurrent: session, current: session, intent: "default" } as SubmitPreflight;
  // A refusal (false) counts toward the drain's pause; a deferral only waits.
  expect(() =>
    queueWhileStarting(ctx, input, pre, "Message not sent: wait for the provider handoff."),
  ).toThrow(QueueDeferredError);
  expect(getSessions()[0].queuedMessages).toEqual([row]);
  expect(getSessions()[0].queueStatus).toBeUndefined();
});

it("still refuses a managed send that cannot wait in the queue", () => {
  const session = newSession("claude", "/repo");
  resetSessionsStore([session]);
  const input: SubmitInput = {
    sessionId: session.id,
    text: "managed",
    attachments: [],
    options: { managed: true },
  };
  const pre = { storedCurrent: session, current: session, intent: "default" } as SubmitPreflight;
  expect(queueWhileStarting(ctx, input, pre, "busy")).toBe(false);
});
