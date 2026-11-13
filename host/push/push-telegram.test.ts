import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostAssistant } from "../assistant/service";
import type { SocialService } from "../social/social";
import type {
  BackgroundEffectActor,
  BackgroundEffectStatus,
  BackgroundEffectSource,
} from "../assistant/native/assistant-background-effect";
import { StoreDatabase } from "../store-db";
import { AssistantPushLedger } from "./push-assistant";
import { tickAssistantTelegram, type TelegramBackgroundEffect } from "./push-telegram";

const state = vi.hoisted(() => ({ snapshot: "canonical" }));
const send = vi.hoisted(() => vi.fn(async () => ({ accepted: true })));
vi.mock("../social/notifications/assistant-telegram-delivery", () => ({
  prepareAssistantTelegramDelivery: async (
    _social: unknown,
    input: { notificationId: string },
    current: () => Promise<boolean>,
  ) => ({
    operation: {
      action: "social.send",
      input: { notificationId: input.notificationId, snapshotHash: state.snapshot },
    },
    execute: async (actor: BackgroundEffectActor) => {
      if (!(await actor.authorized()) || !(await current())) throw new Error("authority changed");
      return send();
    },
  }),
}));
beforeEach(() => {
  send.mockClear();
  state.snapshot = "canonical";
});
const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

function fixture() {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  const ledger = new AssistantPushLedger(db);
  const profile = {
    enabled: true,
    setupComplete: true,
    notificationTelegram: { accountId: "telegram", conversationId: "owner" },
  };
  let pending = [
    {
      id: "urgent",
      kind: "owner.question",
      title: "Question",
      body: "Body",
      createdAt: 1,
      eligible: true,
    },
  ];
  let now = 1000;
  let valid = true;
  let roomId = "global-room";
  const receipts = new Map<string, BackgroundEffectStatus>();
  const ids: string[] = [];
  const assistant = {
    profile: async () => profile,
    globalRoomBinding: async () => ({ id: roomId }),
    notifications: async () => pending,
    notificationDeliveryActive: async () => true,
  } as unknown as HostAssistant;
  const execute = vi.fn<TelegramBackgroundEffect>(async (input) => {
    ids.push(input.operationId);
    receipts.set(input.operationId, { state: "unknown" });
    const result = await input.execute({ deviceHash: "native", authorized: async () => true });
    receipts.set(input.operationId, { state: "completed", result });
    return result;
  });
  const status = vi.fn(
    async ({ operationId }: BackgroundEffectSource): Promise<BackgroundEffectStatus> =>
      receipts.get(operationId) ?? { state: "missing" },
  );
  const tick = () =>
    tickAssistantTelegram({
      assistant,
      social: { store: { environmentId: "host" } } as unknown as SocialService,
      ledger,
      execute,
      now: () => now,
      status,
      withSources: async (_notification, _threadId, _accountId, effect) => effect(() => valid),
    });
  return {
    tick,
    execute,
    status,
    receipts,
    ids,
    ledger,
    replaceRoom: () => {
      roomId = "replacement-room";
    },
    add: () => {
      pending.push({ ...pending[0], id: "second" });
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    ack: () => {
      pending = [];
    },
    revoke: () => {
      valid = false;
    },
  };
}

it("dispatches configured Telegram with two bounded reminders and stops on acknowledgement", async () => {
  const f = fixture();
  await f.tick();
  await f.tick();
  expect(send).toHaveBeenCalledTimes(1);
  f.advance(30 * 60000);
  await f.tick();
  expect(send).toHaveBeenCalledTimes(2);
  f.ack();
  f.advance(30 * 60000);
  await f.tick();
  expect(send).toHaveBeenCalledTimes(2);
});

it("retries a proven-zero unavailable Native effect using the same occurrence identity", async () => {
  const f = fixture();
  let firstId = "";
  f.execute.mockImplementationOnce(async (input) => {
    firstId = input.operationId;
    throw new Error("Native unavailable");
  });
  await f.tick();
  expect(send).not.toHaveBeenCalled();
  await f.tick();
  expect(f.ids).toEqual([firstId]);
  expect(send).toHaveBeenCalledOnce();
});

it.each(["denied", "unknown"] as const)(
  "does not redispatch a %s Native occurrence",
  async (state) => {
    const f = fixture();
    f.execute.mockImplementationOnce(async (input) => {
      f.receipts.set(
        input.operationId,
        state === "denied" ? { state, expiresAt: 2000 } : { state },
      );
      throw new Error(state);
    });
    await f.tick();
    f.advance(60 * 60000);
    await f.tick();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  },
);

it("rechecks source disclosure inside the Native callback before sending", async () => {
  const f = fixture();
  f.execute.mockImplementationOnce(async (input) => {
    f.revoke();
    return input.execute({ deviceHash: "native", authorized: async () => true });
  });
  await f.tick();
  expect(send).not.toHaveBeenCalled();
});

it("reconciles the original completed envelope even after current canonical source changes", async () => {
  const f = fixture();
  let originalId = "";
  f.execute.mockImplementationOnce(async (input) => {
    originalId = input.operationId;
    throw new Error("receipt lost");
  });
  await f.tick();
  f.receipts.set(originalId, { state: "completed", result: { accepted: true } });
  state.snapshot = "new-inbound-message";
  f.replaceRoom();
  f.status.mockImplementationOnce(async (source) => {
    expect(source.threadId).toBe("global-room");
    expect(source.input.snapshotHash).toBe("canonical");
    return { state: "completed", result: { accepted: true } };
  });
  await f.tick();
  expect(f.execute).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  // A reconciled accepted occurrence can produce its next reminder with fresh authority.
  f.advance(30 * 60000);
  await f.tick();
  expect(send).toHaveBeenCalledOnce();
});

it("holds a proven-zero retry when fresh immutable operation input changed", async () => {
  const f = fixture();
  f.execute.mockImplementationOnce(async () => {
    throw new Error("Native unavailable");
  });
  await f.tick();
  state.snapshot = "changed-grant-or-thread";
  await f.tick();
  expect(f.execute).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

it("continues later reports when an earlier occurrence fails", async () => {
  const f = fixture();
  f.add();
  f.execute.mockImplementationOnce(async () => {
    throw new Error("unavailable first occurrence");
  });
  await f.tick();
  expect(f.execute).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledOnce();
});

it("retries an expired unclaimed Native preparation with its original occurrence", async () => {
  const f = fixture();
  let originalId = "";
  f.execute.mockImplementationOnce(async (input) => {
    originalId = input.operationId;
    f.receipts.set(originalId, { state: "prepared", expiresAt: 2000 });
    throw new Error("Native disconnected before claim");
  });
  await f.tick();
  await f.tick();
  expect(f.execute).toHaveBeenCalledOnce();
  f.advance(1001);
  await f.tick();
  expect(f.ids).toEqual([originalId]);
  expect(send).toHaveBeenCalledOnce();
});
