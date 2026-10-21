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
const transport = vi.hoisted(() => ({ steer: vi.fn() }));
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
