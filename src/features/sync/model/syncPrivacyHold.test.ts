import { beforeEach, expect, it, vi } from "vitest";

const privacy = vi.hoisted(() => ({
  held: null as string | null,
  settle: vi.fn<() => Promise<void>>(),
}));

// A held projection refuses every local write, as the real fence does in the desktop app.
vi.mock("../../group-lock/public/roomPrivacy", () => ({
  getRoomPrivacyStatus: () => ({ pending: false, error: privacy.held }),
  settleHeldRoomPrivacyProjection: privacy.settle,
  withRoomPrivacyMutation: async <T>(mutate: () => T | Promise<T>) => {
    if (privacy.held) throw new Error(privacy.held);
    return mutate();
  },
}));

import { getSyncStatus, runSyncCycle } from "./syncClient";
import { summarizeSync } from "../../connections/model/syncSummary";

const HOST_DEADLINE =
  "The host request did not complete [RPC_TIMEOUT] (environment.describe). The host exceeded the request deadline.";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

const request = vi.fn(async (method: string) =>
  method === "sync.pull"
    ? { rev: 0, records: [] }
    : { rev: 0, applied: [], invalid: [], rejected: [] },
);

beforeEach(() => {
  mockLocalStorage();
  privacy.held = HOST_DEADLINE;
  privacy.settle.mockReset();
});

it("retries a privacy failure held from an earlier Host outage, then syncs", async () => {
  privacy.settle.mockImplementation(async () => {
    privacy.held = null;
  });

  await runSyncCycle("held-then-settled", request);

  expect(privacy.settle).toHaveBeenCalledTimes(1);
  expect(getSyncStatus("held-then-settled").state).toBe("ok");
});

it("names held privacy protection instead of blaming the machine", async () => {
  privacy.settle.mockRejectedValue(new Error(HOST_DEADLINE));

  await expect(runSyncCycle("still-held", request)).rejects.toThrow(
    "Room privacy protection is not confirmed",
  );

  const status = getSyncStatus("still-held");
  expect(status.state).toBe("error");
  expect(summarizeSync(status, Date.now()).text).toBe(
    "Sync is paused until room privacy protection is confirmed. It retries automatically.",
  );
});
