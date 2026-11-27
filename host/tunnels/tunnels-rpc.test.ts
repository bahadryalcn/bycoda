import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceProofKeyFromSeed } from "../../src/integrations/device-proof";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { hostProof } from "../mobile/host-proof";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import type { ExternalTunnels } from "./tunnels";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-tunnel-rpc-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const tunnels = {
    boot: vi.fn(async () => {}),
    publicHostUrl: vi.fn(() => undefined),
    publicPhoneUrls: vi.fn(() => [] as string[]),
    allowsPhonesOverPublic: vi.fn(() => false),
    setPhonesOverPublic: vi.fn(async (input: { enabled?: unknown }) => ({
      phonesOverPublic: input.enabled === true,
    })),
    status: vi.fn(async () => ({ environmentId: store.environmentId })),
    start: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({})),
    credential: vi.fn(async () => ({ saved: true })),
    close: vi.fn(async () => {}),
  };
  const server = await createHostServer(
    engine,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    tunnels as unknown as ExternalTunnels,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const device = await store.issueDevice("Owner desktop", "desktop", true);
  const call = async (
    method: string,
    options: { token?: string; environmentId?: string; origin?: string; params?: unknown } = {},
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        ...(options.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
      },
      body: JSON.stringify({
        version: 1,
        environmentId: options.environmentId ?? store.environmentId,
        method,
        params: options.params ?? {},
      }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: unknown; error?: string },
    };
  };
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const identity = () => fetch(`http://127.0.0.1:${port}/.well-known/bycoda-host`);
  return { tunnels, store, device, call, identity, origin: `http://127.0.0.1:${port}` };
}

describe("external tunnels use existing authenticated RPC", () => {
  it("real Host proves ticket/device possession and preserves phone redemption", async () => {
    const s = await setup();
    const created = await s.call("mobile.pairing.create", { token: s.device.token });
    expect(created.status).toBe(200);
    const ticket = created.value.result as { ticket: string };
    for (const [kind, secret] of [
      ["pairing", ticket.ticket],
      ["device", s.device.token],
    ] as const) {
      const key = createHash("sha256").update(secret).digest("hex");
      const nonce = randomBytes(32).toString("hex");
      const body = {
        kind,
        nonce,
        environmentId: s.store.environmentId,
        origin: s.origin,
        proof: hostProof(key, kind, "request", nonce, s.store.environmentId, s.origin),
      };
      const response = await fetch(`${s.origin}/.well-known/bycoda-host/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        result: { proof: hostProof(key, kind, "response", nonce, s.store.environmentId, s.origin) },
      });
    }
    const response = await fetch(`${s.origin}/mobile/pairing/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        environmentId: s.store.environmentId,
        ticket: ticket.ticket,
        claimId: randomBytes(32).toString("base64url"),
        deviceName: "Existing phone protocol",
        proofKey: deviceProofKeyFromSeed(new Uint8Array(32).fill(3)).publicJwk,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { environmentId: s.store.environmentId, token: expect.any(String) },
    });
  });
  it("exposes only environment identity before any device credential is sent", async () => {
    const s = await setup();
    const response = await s.identity();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ environmentId: s.store.environmentId });
    expect(s.tunnels.start).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated, browser-origin, revoked and cross-host operations before dispatch", async () => {
    const s = await setup();
    for (const method of [
      "tunnels.status",
      "tunnels.start",
      "tunnels.stop",
      "tunnels.credential",
      "tunnels.phones",
    ]) {
      expect((await s.call(method)).status).toBe(401);
      expect(
        (await s.call(method, { token: s.device.token, origin: "https://evil.example" })).status,
      ).toBe(403);
      expect(
        (await s.call(method, { token: s.device.token, environmentId: "other-host" })).status,
      ).toBe(400);
    }
    await s.store.revokeToken(s.device.token);
    expect((await s.call("tunnels.start", { token: s.device.token })).status).toBe(401);
    for (const method of ["status", "start", "stop", "credential", "setPhonesOverPublic"] as const)
      expect(s.tunnels[method]).not.toHaveBeenCalled();
  });
  it("advertises the capability and routes authorized control calls without returning input credentials", async () => {
    const s = await setup();
    const described = await s.call("environment.describe", { token: s.device.token });
    expect(described.value.result).toMatchObject({
      capabilities: expect.arrayContaining(["tunnels.manage"]),
    });
    const params = { provider: "cloudflare", target: "host" };
    expect((await s.call("tunnels.start", { token: s.device.token, params })).status).toBe(200);
    expect(s.tunnels.start).toHaveBeenCalledWith(params);
    const result = await s.call("tunnels.credential", {
      token: s.device.token,
      params: { provider: "ngrok", token: "synthetic-secret" },
    });
    expect(result.value.result).toEqual({ saved: true });
    expect(JSON.stringify(result.value)).not.toContain("synthetic-secret");
    const phones = await s.call("tunnels.phones", {
      token: s.device.token,
      params: { enabled: true },
    });
    expect(phones.value.result).toEqual({ phonesOverPublic: true });
    expect(s.tunnels.setPhonesOverPublic).toHaveBeenCalledWith({ enabled: true });
  });
});
