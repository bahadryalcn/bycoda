import { describe, expect, it } from "vitest";
import type { PushDeviceStore, PushRecipient } from "./push-store";
import { PushNotifications } from "./push-service";

function recipient(patch: Partial<PushRecipient["events"]>): PushRecipient {
  return {
    pushToken: "ExponentPushToken[abcdefghij123]",
    platform: "android",
    title: "bycoda",
    texts: { finished: "Done", input: "Input", failed: "Failed", assistant: "A", approvals: "B" },
    events: {
      finished: false,
      input: false,
      failed: false,
      assistant: true,
      approvals: true,
      ...patch,
    },
    assistantUrgentDuringQuiet: true,
    deviceHash: "device-a",
  } as PushRecipient;
}

/** A mock device store whose fingerprint and recipient list the test controls directly. */
function mockStore(initial: PushRecipient[]) {
  const state = { recipients: initial, fingerprint: "1:1", recipientReads: 0 };
  const store = {
    recipientsFingerprint: async () => state.fingerprint,
    recipients: async () => {
      state.recipientReads += 1;
      return state.recipients;
    },
  } as unknown as PushDeviceStore;
  return { state, store };
}

function service(store: PushDeviceStore) {
  return new PushNotifications({
    store,
    environmentId: "env",
    sessions: async () => [],
  });
}

describe("ownedEvents heartbeat lookup", () => {
  it("reuses the owned set while the recipient fingerprint is unchanged", async () => {
    const { state, store } = mockStore([recipient({ finished: true })]);
    const push = service(store);

    expect(await push.ownedEvents()).toEqual(["finished"]);
    expect(await push.ownedEvents()).toEqual(["finished"]);
    expect(state.recipientReads).toBe(1);
  });

  it("recomputes when a registration write changes the fingerprint", async () => {
    const { state, store } = mockStore([recipient({ finished: true })]);
    const push = service(store);
    await push.ownedEvents();

    // A phone registered again with input on: the store bumps its revision.
    state.recipients = [recipient({ finished: true, input: true })];
    state.fingerprint = "2:1";
    expect(await push.ownedEvents()).toEqual(["finished", "input"]);
    expect(state.recipientReads).toBe(2);
  });

  it("drops a revoked phone's events once the live count changes", async () => {
    // Revocation deletes the devices row; the joined count falls even though no push write happened.
    const { state, store } = mockStore([recipient({ failed: true })]);
    const push = service(store);
    expect(await push.ownedEvents()).toEqual(["failed"]);

    state.recipients = [];
    state.fingerprint = "1:0";
    expect(await push.ownedEvents()).toEqual([]);
  });
});
