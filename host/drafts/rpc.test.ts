import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { reportDraftPresence } from "./rpc";
import type { DraftPresenceRegistry } from "./presence";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const device = await store.issueDevice("phone");
  const report = vi.fn(async () => ({ accepted: true as const }));
  const registry = { report } as unknown as DraftPresenceRegistry;
  const context = {
    principalId: createHash("sha256").update(device.token).digest("hex"),
    authorized: async () => true,
  };
  return { store, device, report, registry, context };
}
it("binds report to authenticated device; clientId never selects another device", async () => {
  const { store, device, registry, report, context } = await setup();
  const params = { clientId: "another-client-label", sessionIds: ["s"], complete: true };
  expect(await reportDraftPresence(store, registry, params, context)).toEqual({ accepted: true });
  expect(report).toHaveBeenCalledWith(device.id, params);
  await expect(
    reportDraftPresence(store, registry, { ...params, deviceId: "other" }, context),
  ).rejects.toThrow();
  expect(report).toHaveBeenCalledTimes(1);
});
it("missing, revoked or unauthorized principals cannot report", async () => {
  const { store, device, registry, report, context } = await setup();
  const params = { clientId: "phone", sessionIds: [], complete: true };
  await expect(
    reportDraftPresence(store, registry, params, { ...context, principalId: undefined }),
  ).rejects.toThrow("unavailable");
  await expect(
    reportDraftPresence(store, registry, params, { ...context, authorized: async () => false }),
  ).rejects.toThrow("revoked");
  await store.revokeDevice(device.id);
  await expect(reportDraftPresence(store, registry, params, context)).rejects.toThrow(
    "unavailable",
  );
  expect(report).not.toHaveBeenCalled();
});
