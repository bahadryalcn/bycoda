import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "./store";
import { readHostAccess } from "./access-center";
import type { TunnelOverview } from "../src/integrations/external-tunnels";
it("lists only bounded paired-device identity and prevents the other-device action revoking self", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-device-center-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    const caller = await store.issueDevice("Current phone");
    const other = await store.issueDevice("Other phone");
    const result = await store.pairedDevices(caller.token);
    expect(result).toEqual({
      devices: [
        { id: caller.id, name: "Current phone", isCurrent: true },
        { id: other.id, name: "Other phone", isCurrent: false },
      ],
      devicesTruncated: false,
    });
    expect(JSON.stringify(result)).not.toContain(caller.token);
    expect(JSON.stringify(result)).not.toContain("hash");
    await expect(store.revokeOtherDevice(caller.id, caller.token)).rejects.toThrow("revoke-self");
    expect(await store.authenticated(caller.token)).toBe(true);
    expect(await store.revokeOtherDevice(other.id, caller.token)).toBe(true);
    expect(await store.authenticated(other.token)).toBe(false);
    expect(await store.revokeOtherDevice(other.id, caller.token)).toBe(false);
    await store.revokeToken(caller.token);
    await expect(store.pairedDevices(caller.token)).rejects.toThrow("revoked");
    await expect(store.revokeOtherDevice(other.id, caller.token)).rejects.toThrow("revoked");
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
const overview: TunnelOverview = {
  environmentId: "host",
  hostLocalUrl: "http://127.0.0.1:9090",
  providers: [{ provider: "cloudflare", installed: true, credential: "not-required" }],
  tunnels: [
    {
      id: "tunnel",
      provider: "cloudflare",
      target: "host",
      state: "ready",
      startedAt: 42,
      localUrl: "http://127.0.0.1:9090",
      publicUrl: "https://fixture.trycloudflare.com",
      canStop: true,
    },
  ],
  publicReachability: "unverified",
};
const dependencies = () => ({
  devices: async () => ({
    devices: [{ id: "phone", name: "Phone", isCurrent: true }],
    devicesTruncated: false,
  }),
  lan: async () => ({
    state: "ready" as const,
    lanKey: "PRIVATE_FIXTURE_KEY",
    approvalUrl: "https://fixture.invalid/private-ticket",
    endpoint: "http://192.168.1.1",
  }),
  privateNetwork: async () => ({
    state: "offline" as const,
    machineName: "PRIVATE_FIXTURE_MACHINE",
  }),
  tunnels: async () => overview,
});
it("projects connection states without pairing keys, tickets, private names, vault material or host-local URL", async () => {
  const result = await readHostAccess("host", dependencies(), () => 42);
  expect(result.lan).toEqual({ state: "ready" });
  expect(result.privateNetwork).toEqual({ state: "offline" });
  expect(result.tunnels?.tunnels[0].publicUrl).toBe("https://fixture.trycloudflare.com");
  for (const forbidden of ["PRIVATE_FIXTURE", "approvalUrl", "endpoint", "lanKey", "hostLocalUrl"])
    expect(JSON.stringify(result)).not.toContain(forbidden);
});
it("isolates unavailable services and refuses credential-bearing tunnel URLs", async () => {
  const data = dependencies();
  data.privateNetwork = async () => {
    throw new Error("PRIVATE_FIXTURE_ERROR");
  };
  data.tunnels = async () => ({
    ...overview,
    tunnels: [
      { ...overview.tunnels[0], publicUrl: "https://user:password@fixture.trycloudflare.com" },
    ],
  });
  const result = await readHostAccess("host", data, () => 42);
  expect(result.privateNetwork.state).toBe("unavailable");
  expect(result.tunnels).toBeNull();
  expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_ERROR");
});
