import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ mutateSessionOrganization: vi.fn() }));
vi.mock("./sessionOrganizationStore", () => ({
  mutateSessionOrganization: store.mutateSessionOrganization,
}));

import {
  executeOrganizationOperation,
  retainedGestureCount,
} from "./sessionOrganizationOperations";

const initial = {
  folders: { "/project": [{ id: "a", name: "A", sessionIds: ["s1"], collapsed: false }] },
  order: { "/project": { loose: ["s2"] } },
};
const rename = (name: string) =>
  ({ kind: "rename", cwd: "/project", folderId: "a", name }) as const;

beforeEach(() => {
  store.mutateSessionOrganization.mockReset();
  // The mock applies each gesture to the same starting state, as the real store does on a fresh read.
  store.mutateSessionOrganization.mockImplementation(async (gesture: any) => ({
    state: "applied",
    value: gesture.apply(structuredClone(initial)),
  }));
});

it("keeps the organization and drag-relevant order intact while applying a gesture", async () => {
  const result = await executeOrganizationOperation("keep-state", rename("Renamed"));
  expect(result.state).toBe("applied");
  if (result.state !== "applied") throw new Error("expected applied");
  expect(result.value.folders["/project"]).toEqual([
    { id: "a", name: "Renamed", sessionIds: ["s1"], collapsed: false },
  ]);
  expect(result.value.order).toEqual(initial.order);
});

it("replays a completed gesture without another store mutation", async () => {
  await executeOrganizationOperation("completed-replay", rename("Once"));
  await executeOrganizationOperation("completed-replay", rename("Once"));
  expect(store.mutateSessionOrganization).toHaveBeenCalledTimes(1);
});

it("bounds retained gestures and evicts the oldest completed outcome", async () => {
  for (let index = 0; index < 100; index++)
    await executeOrganizationOperation(`bounded-${index}`, rename(`N${index}`));
  expect(retainedGestureCount()).toBeLessThanOrEqual(64);

  store.mutateSessionOrganization.mockClear();
  await executeOrganizationOperation("bounded-99", rename("N99"));
  expect(store.mutateSessionOrganization).not.toHaveBeenCalled();

  await executeOrganizationOperation("bounded-0", rename("N0"));
  expect(store.mutateSessionOrganization).toHaveBeenCalledTimes(1);
});

it("releases a gesture whose attempt throws so its id no longer pins a record", async () => {
  const before = retainedGestureCount();
  store.mutateSessionOrganization.mockRejectedValueOnce(new Error("cancelled"));
  await expect(executeOrganizationOperation("cancel-cleanup", rename("X"))).rejects.toThrow(
    "cancelled",
  );
  expect(retainedGestureCount()).toBe(before);
  const retry = await executeOrganizationOperation("cancel-cleanup", rename("Y"));
  expect(retry.state).toBe("applied");
});

it("keeps an unknown outcome retryable and still rejects changed input", async () => {
  store.mutateSessionOrganization.mockResolvedValueOnce({ state: "unknown", operationId: "op" });
  const first = await executeOrganizationOperation("unknown-outcome", rename("Z"));
  expect(first.state).toBe("unknown");
  await expect(executeOrganizationOperation("unknown-outcome", rename("Other"))).rejects.toThrow(
    "reused with different input",
  );
  await executeOrganizationOperation("unknown-outcome", rename("Z"));
  expect(store.mutateSessionOrganization).toHaveBeenCalledTimes(2);
});
