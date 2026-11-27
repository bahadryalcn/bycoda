import { afterEach, describe, expect, it } from "vitest";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { ApprovalRegistry } from "../approvals/approval-registry";
import { StoreDatabase } from "../store-db";
import { ExpoPushError, type ExpoPushMessage } from "./expo-push";
import { PushNotifications } from "./push-service";
import { parsePushRegistration, PushDeviceStore } from "./push-store";

// Regression for #413: dead tokens reported by Expo before a later batch failed must still be forgotten.

const GONE = "ExponentPushToken[gone0000001]";
const ALIVE = "ExponentPushToken[alive000002]";
const LATE = "ExponentPushToken[late0000003]";

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

function registration(pushToken: string) {
  return parsePushRegistration({
    pushToken,
    platform: "android",
    title: "bycoda · Home PC",
    texts: { finished: "Agent finished", input: "Needs your input", failed: "Turn failed" },
    events: { finished: true, input: true, failed: true },
  });
}

async function setup(tokens: Record<string, string>) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec(
    "CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
  );
  const store = new PushDeviceStore(db);
  for (const [hash, token] of Object.entries(tokens)) {
    await db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run(hash, hash, hash);
    await store.register(hash, registration(token));
  }
  const approvals = new ApprovalRegistry();
  approvals.noteDesktop("desk");
  const control = {
    send: undefined as undefined | ((messages: readonly ExpoPushMessage[]) => Promise<never>),
  };
  const service = new PushNotifications({
    store,
    approvals,
    environmentId: "env-1",
    sessions: async () => [],
    send: async (messages) => {
      if (control.send) return control.send(messages);
      return { unregistered: [], failed: 0 };
    },
  });
  const add = async (id: string) => {
    const item = {
      id,
      title: "Approval",
      message: "Confirm",
      confirmLabel: "Yes",
      cancelLabel: "No",
      deadline: Date.now() + 200_000,
      remote: true,
    };
    await approvals.mirror("desk", {
      upsert: [{ ...item, signature: await ownerApprovalSignature(item) }],
      remove: [],
    });
  };
  const tokensLeft = async () => (await store.recipients()).map((recipient) => recipient.pushToken);
  return { store, service, control, add, tokensLeft };
}

/** Expo accepted batch 1 (reporting GONE as dead) and then failed a later batch with an outage. */
const laterBatchFailed = (unregistered: string[]) =>
  new ExpoPushError("Expo push rejected the request (503)", { unregistered, failed: 0 }, true);

describe("partial Expo results from an earlier batch", () => {
  it("forgets a dead token reported before a later batch failed (approval channel)", async () => {
    const t = await setup({ gone: GONE, alive: ALIVE });
    await t.add("a");
    t.control.send = async () => {
      throw laterBatchFailed([GONE]);
    };
    await t.service.tick();
    expect(await t.tokensLeft()).toEqual([ALIVE]);
  });

  it("forgets every dead token of the partial result, not only the first", async () => {
    const t = await setup({ gone: GONE, late: LATE, alive: ALIVE });
    await t.add("a");
    t.control.send = async () => {
      throw laterBatchFailed([GONE, LATE]);
    };
    await t.service.tick();
    expect(await t.tokensLeft()).toEqual([ALIVE]);
  });

  it("keeps forgetting later dead tokens when one store write fails", async () => {
    const t = await setup({ gone: GONE, late: LATE, alive: ALIVE });
    const realForget = t.store.forgetToken.bind(t.store);
    t.store.forgetToken = async (token: string) => {
      if (token === GONE) throw new Error("database is locked");
      return realForget(token);
    };
    await t.add("a");
    t.control.send = async () => {
      throw laterBatchFailed([GONE, LATE]);
    };
    await expect(t.service.tick()).resolves.toBeUndefined();
    // GONE stays registered (its write failed), so Expo reports it again on a later send.
    expect(await t.tokensLeft()).toEqual([GONE, ALIVE]);
  });

  it("forgets the dead token on the direct test-send path too", async () => {
    const t = await setup({ gone: GONE, alive: ALIVE });
    t.control.send = async () => {
      throw laterBatchFailed([GONE]);
    };
    await expect(t.service.test("gone", "hello")).rejects.toBeInstanceOf(ExpoPushError);
    expect(await t.tokensLeft()).toEqual([ALIVE]);
  });
});
