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
import { TurnNotReadyError } from "../../../../integrations/harness/core/types";
import { QueueDeferredError } from "../../../../features/connections/model/sharedQueue";
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

it.each(["active", "paused", "restored"] as const)(
  "returns a queued steer to the head without rejecting a %s queue when its turn ended",
  async (queueStatus) => {
    const attachment = {
      id: "file",
      name: "context.txt",
      kind: "file" as const,
      mimeType: "text/plain",
      size: 7,
      path: "/fake/context.txt",
    };
    const selected = { id: "selected", text: "follow-up", attachments: [attachment] };
    const later = { id: "later", text: "next", attachments: [] };
    const session = {
      ...newSession("codex", "/fake"),
      id: "steer-test",
      busy: true,
      queueStatus,
      queuedMessages: [selected, later],
    };
    resetSessionsStore([session]);
    transport.steer.mockRejectedValue(new TurnNotReadyError("The original turn ended"));
    const ctx = {
      dismissNoticesForContinuedSession: vi.fn(),
      enqueueHarnessEvent: vi.fn(),
      flushHarnessEvents: vi.fn(),
      refs: { turnGen: { current: new Map([[session.id, 1]]) } },
    } as unknown as SubmitDeps;
    const input = {
      sessionId: session.id,
      text: selected.text,
      attachments: selected.attachments,
      options: {
        queuedMessageId: selected.id,
        followUpBehavior: "steer",
        sharedQueueClaimed: true,
      },
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

    await expect(steerBusySubmit(ctx, input, pre)).rejects.toBeInstanceOf(QueueDeferredError);

    const retained = getSessions()[0];
    expect(retained.queueStatus).toBe(queueStatus);
    expect(retained.queuedMessages).toEqual([expect.objectContaining(selected), later]);
    expect(retained.blocks.some((block) => block.id === "steer-user")).toBe(false);
    expect(readDeliveryProgress(session.id)).toBeUndefined();
    expect(ctx.enqueueHarnessEvent).not.toHaveBeenCalled();
    expect(transport.steer).toHaveBeenCalledOnce();
  },
);

it("keeps Stop authoritative when a queued steer loses its turn during delivery", async () => {
  const selected = { id: "selected", text: "keep queued", attachments: [] };
  const session = {
    ...newSession("codex", "/fake"),
    id: "steer-test",
    busy: true,
    queueStatus: "active" as const,
    queuedMessages: [selected],
  };
  resetSessionsStore([session]);
  const turnGen = new Map([[session.id, 1]]);
  transport.steer.mockImplementation(async () => {
    turnGen.set(session.id, 2);
    setSessions((entries) =>
      entries.map((entry) => ({ ...entry, busy: false, queueStatus: "paused" })),
    );
    throw new TurnNotReadyError("The original turn ended");
  });
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    refs: { turnGen: { current: turnGen } },
  } as unknown as SubmitDeps;
  const input = {
    sessionId: session.id,
    text: selected.text,
    attachments: selected.attachments,
    options: { queuedMessageId: selected.id, followUpBehavior: "steer", sharedQueueClaimed: true },
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
  expect(getSessions()[0].queueStatus).toBe("paused");
  expect(getSessions()[0].queuedMessages).toEqual([expect.objectContaining(selected)]);
  expect(readDeliveryProgress(session.id)?.stage).toBe("rejected");
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
    adoptedAuthorityGeneration: 2,
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
    expect.objectContaining({ sessionId: session.id, text: input.text, authorityGeneration: 2 }),
  );
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
  expect(transport.steer).not.toHaveBeenCalled();
  // Explicit Queue retains the follow-up instead of steering the host.
  expect(steerBusySubmit(ctx, { ...input, options: { followUpBehavior: "queue" } }, pre)).toBe(
    true,
  );
  expect(getSessions()[0].queuedMessages).toHaveLength(1);
});

it("retains an explicit queue while Claude waits for background commands without writing to the provider", () => {
  const session = {
    ...newSession("claude", "/fake"),
    id: "steer-test",
    busy: true,
    backgroundTasks: ["Wait for test runs to finish"],
    backgroundAgents: 0,
  };
  resetSessionsStore([session]);
  const ctx = {
    dismissNoticesForContinuedSession: vi.fn(),
    refs: { turnGen: { current: new Map([[session.id, 1]]) } },
  } as unknown as SubmitDeps;
  const input = {
    sessionId: session.id,
    text: "after the tests, update the rules",
    attachments: [],
    options: { followUpBehavior: "queue" },
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

  expect(steerBusySubmit(ctx, input, pre)).toBe(true);
  expect(getSessions()[0].queuedMessages).toEqual([
    expect.objectContaining({ text: input.text, attachments: [] }),
  ]);
  expect(getSessions()[0].busy).toBe(true);
  expect(getSessions()[0].blocks).toEqual(session.blocks);
  expect(transport.steer).not.toHaveBeenCalled();
  expect(transport.adopted).not.toHaveBeenCalled();
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

it("queues a repeated adopted Send so the first is not duplicated and the second is not lost", () => {
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
      {
        refs: { turnGen: { current: new Map() } },
        dismissNoticesForContinuedSession: vi.fn(),
      } as unknown as SubmitDeps,
      { sessionId: session.id, text: "second draft", attachments: [] } as SubmitInput,
      pre,
    ),
  ).toBe(true);
  expect(transport.adopted).not.toHaveBeenCalled();
  expect(getSessions()[0].queuedMessages).toEqual([
    expect.objectContaining({ text: "second draft" }),
  ]);
});
