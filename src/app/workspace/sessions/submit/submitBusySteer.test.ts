// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { steerBusySubmit } from "./submitBusySteer";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../../features/sessions/model/sessionsStore";
import { newSession } from "../../../../features/sessions/model/session";
import {
  clearDeliveryProgress,
  readDeliveryProgress,
  beginDeliveryProgress,
  updateDeliveryProgress,
} from "../../../../features/sessions/model/deliveryProgress";
import {
  DeliveryUnknownError,
  type DeliverySettlement,
} from "../../../../shared/lib/deliveryUnknown";
const transport = vi.hoisted(() => ({ steer: vi.fn(), adopted: vi.fn(), pending: vi.fn() }));
vi.mock("../../../../features/connections/model/adoptedSessionCommands", () => ({
  sendAdoptedFollowUp: transport.adopted,
  adoptedFollowUpPending: transport.pending,
}));
vi.mock("../../../../integrations/harness", () => ({
  canSteerHarness: () => true,
  isLiveHarness: () => true,
  appendSteerUser: (session: { blocks: unknown[] }, text: string) => ({
    ...session,
    blocks: [...session.blocks, { id: "steer-user", role: "user", text }],
  }),
  steerHarnessTurn: (input: { onReady?: () => void }) => {
    input.onReady?.();
    return transport.steer();
  },
}));
vi.mock("../../../../features/sessions/model/attachments", () => ({
  displayAttachments: () => [],
  prepareAttachments: async () => [],
}));
vi.mock("../../../../features/sessions/model/promptPreparation", () => ({
  preparePrompt: async (text: string) => text,
}));
beforeEach(() => {
  transport.steer.mockReset();
  transport.adopted.mockReset().mockResolvedValue(true);
  transport.pending.mockReset().mockReturnValue(false);
  resetSessionsStore([]);
  for (
    let progress = readDeliveryProgress("steer-test");
    progress;
    progress = readDeliveryProgress("steer-test")
  )
    clearDeliveryProgress("steer-test", progress);
});

it.each(["unreviewed", "kept", "kept-with-new-send", "edited"])(
  "reconciles late acceptance after %s without replaying or losing a newer draft",
  async (review) => {
    const session = { ...newSession("codex", "/fake"), id: "steer-test", busy: true };
    resetSessionsStore([session]);
    let settle!: (value: DeliverySettlement) => void;
    const settlement = new Promise<DeliverySettlement>((resolve) => {
      settle = resolve;
    });
    transport.steer.mockRejectedValue(new DeliveryUnknownError("timeout", settlement));
    const ctx = {
      dismissNoticesForContinuedSession: vi.fn(),
      enqueueHarnessEvent: vi.fn(),
      flushHarnessEvents: vi.fn(),
      refs: { turnGen: { current: new Map([[session.id, 1]]) } },
    } as unknown as SubmitDeps;
    const input = {
      sessionId: session.id,
      text: "synthetic follow-up",
      attachments: [],
    } as SubmitInput;
    const pre = {
      storedCurrent: session,
      current: session,
      intent: "default",
      submittedText: input.text,
      harnessText: input.text,
      operatorCommand: { matched: false },
      initialWorkCwd: session.cwd,
    } as unknown as SubmitPreflight;
    expect(await steerBusySubmit(ctx, input, pre)).toBe(false);
    expect(getSessions()[0].queuedMessages?.[0].deliveryUnknown).toBe(true);
    expect(getSessions()[0].queueStatus).toBe("paused");
    expect(readDeliveryProgress(session.id)?.stage).toBe("unknown");
    const owner = readDeliveryProgress(session.id)!;
    if (review !== "unreviewed") {
      setSessions((sessions) =>
        sessions.map((entry) => ({
          ...entry,
          queuedMessages: entry.queuedMessages?.map((row) => ({
            ...row,
            deliveryUnknown: undefined,
          })),
        })),
      );
      updateDeliveryProgress(session.id, owner, "rejected");
      if (review === "kept-with-new-send")
        beginDeliveryProgress(session.id, "new-send", "provider");
      if (review === "edited") {
        clearDeliveryProgress(session.id, owner);
        setSessions((sessions) =>
          sessions.map((entry) => ({
            ...entry,
            queuedMessages: entry.queuedMessages?.map((row) => ({
              ...row,
              text: "New unsent draft",
            })),
          })),
        );
      }
    }
    settle("accepted");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (review === "edited")
      expect(getSessions()[0].queuedMessages?.[0].text).toBe("New unsent draft");
    else expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
    expect(getSessions()[0].blocks.filter((block) => block.id === "steer-user")).toHaveLength(1);
    expect(transport.steer).toHaveBeenCalledOnce();
    if (review !== "edited")
      expect(readDeliveryProgress(session.id, owner.messageId)?.stage).toBe("accepted");
  },
);

it("steers a message through the host running the adopted conversation", async () => {
  const session = {
    ...newSession("codex", "/fake"),
    id: "steer-test",
    continuingElsewhere: true,
  };
  resetSessionsStore([session]);
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    refs: { turnGen: { current: new Map([[session.id, 1]]) } },
  } as unknown as SubmitDeps;
  const input = {
    sessionId: session.id,
    text: "from this desk",
    attachments: [],
  } as SubmitInput;
  const pre = {
    storedCurrent: session,
    current: session,
    intent: "default",
    submittedText: input.text,
    harnessText: input.text,
    operatorCommand: { matched: false },
    initialWorkCwd: session.cwd,
  } as unknown as SubmitPreflight;
  expect(await steerBusySubmit(ctx, input, pre)).toBe(true);
  expect(transport.adopted).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: session.id, text: input.text }),
  );
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
  expect(transport.steer).not.toHaveBeenCalled();
  // Explicit Queue retains the follow-up instead of steering the host.
  expect(steerBusySubmit(ctx, { ...input, options: { followUpBehavior: "queue" } }, pre)).toBe(
    true,
  );
  expect(getSessions()[0].queuedMessages).toHaveLength(1);
});

it("queues a message typed while two versions of the conversation await the user's choice", () => {
  const session = {
    ...newSession("codex", "/fake"),
    id: "steer-test",
    adoptedSyncConflict: true,
    adoptedDivergence: { key: "k" },
  };
  resetSessionsStore([session]);
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    refs: { turnGen: { current: new Map([[session.id, 1]]) } },
  } as unknown as SubmitDeps;
  const input = { sessionId: session.id, text: "while choosing", attachments: [] } as SubmitInput;
  const pre = {
    storedCurrent: session,
    current: session,
    intent: "default",
    submittedText: input.text,
    harnessText: input.text,
    operatorCommand: { matched: false },
    initialWorkCwd: session.cwd,
  } as unknown as SubmitPreflight;
  // It does not run, so it cannot grow the conflict; it waits for the answer.
  expect(steerBusySubmit(ctx, input, pre)).toBe(true);
  expect(getSessions()[0].queuedMessages?.map((row) => row.text)).toEqual(["while choosing"]);
  expect(getSessions()[0].queueStatus).not.toBe("paused");
});

it("retains an unconfirmed adopted steer once, with a visible held delivery state", async () => {
  const session = { ...newSession("codex", "/fake"), id: "steer-test", continuingElsewhere: true };
  resetSessionsStore([session]);
  transport.adopted.mockRejectedValue(
    new DeliveryUnknownError("lost host acknowledgement", Promise.resolve("unknown")),
  );
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    refs: { turnGen: { current: new Map([[session.id, 1]]) } },
  } as unknown as SubmitDeps;
  const input = {
    sessionId: session.id,
    text: "retained follow-up",
    attachments: [],
  } as SubmitInput;
  const pre = {
    storedCurrent: session,
    current: session,
    intent: "default",
    operatorCommand: { matched: false },
  } as unknown as SubmitPreflight;
  expect(await steerBusySubmit(ctx, input, pre)).toBe(true);
  expect(getSessions()[0].queuedMessages).toEqual([
    expect.objectContaining({ text: input.text, deliveryUnknown: true }),
  ]);
  expect(getSessions()[0].queueStatus).toBe("paused");
  expect(readDeliveryProgress(session.id)?.stage).toBe("unknown");
  expect(transport.steer).not.toHaveBeenCalled();
});

it("removes an adopted queued steer only after the host confirms its atomic consumption", async () => {
  const row = { id: "queued", text: "selected", attachments: [] };
  const session = {
    ...newSession("codex", "/fake"),
    id: "steer-test",
    continuingElsewhere: true,
    queuedMessages: [row],
  };
  resetSessionsStore([session]);
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    refs: { turnGen: { current: new Map([[session.id, 1]]) } },
  } as unknown as SubmitDeps;
  const input = {
    sessionId: session.id,
    text: row.text,
    attachments: [],
    options: { queuedMessageId: row.id, followUpBehavior: "steer" },
  } as SubmitInput;
  const pre = {
    storedCurrent: session,
    current: session,
    intent: "default",
    operatorCommand: { matched: false },
  } as unknown as SubmitPreflight;
  expect(await steerBusySubmit(ctx, input, pre)).toBe(true);
  expect(transport.adopted).toHaveBeenCalledWith(
    expect.objectContaining({ queuedMessageId: row.id }),
  );
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
});

it.each(["rejected", "stopped"])(
  "preserves a fresh adopted follow-up when %s after the composer accepted deferred work",
  async (failure) => {
    const session = {
      ...newSession("codex", "/fake"),
      id: "steer-test",
      continuingElsewhere: true,
    };
    resetSessionsStore([session]);
    if (failure === "stopped") transport.adopted.mockResolvedValue(false);
    else transport.adopted.mockRejectedValue(new Error("Upload failed"));
    const ctx = {
      dismissNoticesForContinuedSession: vi.fn(),
      refs: { turnGen: { current: new Map([[session.id, 1]]) } },
    } as unknown as SubmitDeps;
    const input = {
      sessionId: session.id,
      text: "keep this message",
      attachments: [],
    } as SubmitInput;
    const pre = {
      storedCurrent: session,
      current: session,
      intent: "default",
      operatorCommand: { matched: false },
    } as unknown as SubmitPreflight;
    await steerBusySubmit(ctx, input, pre);
    expect(getSessions()[0].queuedMessages).toEqual([
      expect.objectContaining({ text: input.text }),
    ]);
    expect(getSessions()[0].queueStatus).toBe("paused");
    expect(readDeliveryProgress(session.id)?.stage).toBe("rejected");
  },
);

it("rejects a repeated adopted Send synchronously so its second draft is not cleared", () => {
  transport.pending.mockReturnValue(true);
  const session = { ...newSession("codex", "/fake"), id: "steer-test", continuingElsewhere: true };
  resetSessionsStore([session]);
  const pre = {
    storedCurrent: session,
    current: session,
    intent: "default",
    operatorCommand: { matched: false },
  } as unknown as SubmitPreflight;
  expect(
    steerBusySubmit(
      { refs: { turnGen: { current: new Map() } } } as unknown as SubmitDeps,
      { sessionId: session.id, text: "second draft", attachments: [] } as SubmitInput,
      pre,
    ),
  ).toBe(false);
  expect(transport.adopted).not.toHaveBeenCalled();
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
});
