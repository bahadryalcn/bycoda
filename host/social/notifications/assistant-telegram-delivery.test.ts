import { expect, it, vi } from "vitest";
import type { SocialService } from "../social";
import { prepareAssistantTelegramDelivery } from "./assistant-telegram-delivery";
import type { SocialJob } from "../../../src/features/social/model/social";
import type { SocialAdapter } from "../../../src/integrations/social/adapter";

vi.mock("../execution/social-job-gates", () => ({ assertContactSendable: vi.fn(async () => {}) }));

function fixture() {
  const account = {
    id: "telegram",
    platform: "telegram",
    connected: true,
    paused: false,
    executorId: "host",
    assistantGrant: { permissions: ["read", "draft"], version: "grant" },
  };
  const thread = {
    id: "conversation",
    accountId: account.id,
    kind: "message",
    contactId: "contact",
    platformThreadId: "platform-chat",
    events: [],
  };
  const contact = {
    id: "contact",
    accountId: account.id,
    name: "Owner",
    platformId: "recipient",
    optedOut: false,
  };
  const records = new Map<string, unknown>([
    ["account", account],
    ["thread", thread],
    ["contact", contact],
  ]);
  const jobs = new Map<string, SocialJob>();
  const send = vi.fn<SocialAdapter["send"]>(
    async (_account, _job, _token, _media, _checkpoint, check) => {
      await check?.();
      return { platformId: "message" };
    },
  );
  const social = {
    ready: Promise.resolve(),
    now: () => 1000,
    store: {
      environmentId: "host",
      db: { prepare: () => ({ get: async (id: string) => jobs.get(id) }) },
    },
    get: async (kind: string) => records.get(kind),
    setting: async (key: string) => (key === "sending" ? "true" : "false"),
    assistantAccountProofsValid: async () => true,
    roomSendSourceAdmission: async () => true,
    capability: () => {},
    assertLength: async () => {},
    policy: async () => ({}),
    credentialFor: async () => ({ accessToken: "test-token" }),
    transaction: async (effect: () => Promise<unknown>) => effect(),
    writeJob: async (job: SocialJob) => {
      jobs.set(job.id, { ...job });
      return job;
    },
    adapterFor: () => ({ send }),
  } as unknown as SocialService;
  const input = {
    operationId: "occurrence",
    notificationId: "notification",
    accountId: account.id,
    conversationId: thread.id,
    text: "Urgent report",
    threadId: "global-room",
  };
  return {
    social,
    account,
    thread,
    contact,
    jobs,
    send,
    input,
    actor: { deviceHash: "native", authorized: async () => true },
  };
}

it("uses existing Telegram adapter only inside the admitted callback and persists its exact occurrence", async () => {
  const f = fixture();
  const plan = await prepareAssistantTelegramDelivery(f.social, f.input, async () => true);
  expect(f.send).not.toHaveBeenCalled();
  expect(plan.operation.input).toMatchObject({
    accountId: "telegram",
    conversationId: "conversation",
    notificationId: "notification",
  });
  expect(plan.operation.input.bodyDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await plan.execute(f.actor)).toMatchObject({ accepted: true });
  expect(f.send).toHaveBeenCalledOnce();
  expect([...f.jobs.values()][0]).toMatchObject({
    status: "succeeded",
    operationId: "occurrence",
    platformId: "message",
  });
  await expect(plan.execute(f.actor)).rejects.toThrow("already dispatched");
  expect(f.send).toHaveBeenCalledOnce();
});

it("fences recipient changes and revoked Native authority before dispatch", async () => {
  const f = fixture();
  const plan = await prepareAssistantTelegramDelivery(f.social, f.input, async () => true);
  f.contact.platformId = "changed-recipient";
  await expect(plan.execute(f.actor)).rejects.toThrow("source changed");
  f.contact.platformId = "recipient";
  await expect(plan.execute({ ...f.actor, authorized: async () => false })).rejects.toThrow(
    "authority",
  );
  expect(f.send).not.toHaveBeenCalled();
  expect(f.jobs.size).toBe(0);
});

it("retains unknown provider outcomes without a second dispatch", async () => {
  const f = fixture();
  f.send.mockRejectedValueOnce(new Error("receipt lost"));
  const plan = await prepareAssistantTelegramDelivery(f.social, f.input, async () => true);
  expect(await plan.execute(f.actor)).toMatchObject({ accepted: false });
  expect([...f.jobs.values()][0]).toMatchObject({
    status: "review",
    dispatchedAt: 1000,
    reviewReason: "needs_human",
  });
  const restart = await prepareAssistantTelegramDelivery(f.social, f.input, async () => true);
  await expect(restart.execute(f.actor)).rejects.toThrow("already dispatched");
  expect(f.send).toHaveBeenCalledOnce();
});

it("fences Native authority expiring while the final beforeSubmit source read awaits", async () => {
  const f = fixture();
  let authorized = true;
  let beforeSubmit = false;
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const providerSubmit = vi.fn();
  vi.spyOn(f.social, "policy").mockImplementation(async () => {
    if (beforeSubmit) {
      entered();
      await waiting;
    }
    return {} as Awaited<ReturnType<SocialService["policy"]>>;
  });
  f.send.mockImplementation(async (_account, _job, _token, _media, _checkpoint, check) => {
    beforeSubmit = true;
    await check?.();
    providerSubmit();
    return { platformId: "message" };
  });
  const plan = await prepareAssistantTelegramDelivery(f.social, f.input, async () => true);
  const sending = plan.execute({ ...f.actor, authorized: async () => authorized });
  await reading;
  authorized = false;
  release();
  expect(await sending).toMatchObject({ accepted: false });
  expect(providerSubmit).not.toHaveBeenCalled();
});
