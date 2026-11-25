import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceProofKeyFromSeed,
  signDeviceProof,
  type DeviceProofKey,
} from "../../src/integrations/device-proof";
import { WS_SUBPROTOCOL } from "../../src/shared/model/host-contracts/policy";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import { HostStore } from "../store";
import type { ExternalTunnels } from "../tunnels/tunnels";
import {
  DeviceProofReplayCache,
  checkDeviceProof,
  createDeviceProofGate,
  requireDeviceProof,
} from "./device-proof";
import { MOBILE_INGRESS_HEADER } from "./ingress";

const ENVIRONMENT = "00000000-0000-4000-8000-000000000001";
const TOKEN = "t".repeat(43);

function seedOf(byte: number) {
  return new Uint8Array(32).fill(byte);
}
function bindingOf(seed: Uint8Array) {
  const key: DeviceProofKey = deviceProofKeyFromSeed(seed);
  return { jkt: key.jkt, x: key.publicJwk.x };
}
/** The minimum of an IncomingMessage the verifier reads. */
function fake(method: string, url: string, proof?: string | string[]): IncomingMessage {
  const rawHeaders = (Array.isArray(proof) ? proof : proof ? [proof] : []).flatMap((value) => [
    "DPoP",
    value,
  ]);
  return { method, url, rawHeaders } as unknown as IncomingMessage;
}

describe("requireDeviceProof", () => {
  const seed = seedOf(7);
  const binding = bindingOf(seed);
  const sign = (overrides = {}) =>
    signDeviceProof({
      seed,
      token: TOKEN,
      method: "POST",
      path: "/rpc",
      environmentId: ENVIRONMENT,
      ...overrides,
    });
  const check = (request: IncomingMessage, cache = new DeviceProofReplayCache()) =>
    requireDeviceProof({ request, token: TOKEN, environmentId: ENVIRONMENT, binding, cache });

  it("accepts one valid proof, refuses its replay and ignores the query", () => {
    const cache = new DeviceProofReplayCache();
    const proof = sign();
    expect(check(fake("POST", "/rpc?x=1", proof), cache)).toEqual({ ok: true });
    expect(check(fake("POST", "/rpc", proof), cache)).toEqual({
      ok: false,
      reason: "replayed-proof",
    });
  });

  it("refuses a missing, repeated, foreign-key, wrong-route or stale proof", () => {
    expect(check(fake("POST", "/rpc"))).toEqual({ ok: false, reason: "proof-required" });
    expect(check(fake("POST", "/rpc", [sign(), sign()]))).toEqual({
      ok: false,
      reason: "proof-required",
    });
    const foreign = signDeviceProof({
      seed: seedOf(8),
      token: TOKEN,
      method: "POST",
      path: "/rpc",
      environmentId: ENVIRONMENT,
    });
    expect(check(fake("POST", "/rpc", foreign))).toEqual({ ok: false, reason: "invalid-proof" });
    expect(check(fake("GET", "/rpc", sign()))).toEqual({ ok: false, reason: "invalid-proof" });
    expect(check(fake("POST", "/ws", sign()))).toEqual({ ok: false, reason: "invalid-proof" });
    expect(check(fake("POST", "/rpc", sign({ iat: Math.floor(Date.now() / 1000) - 600 })))).toEqual(
      { ok: false, reason: "invalid-proof" },
    );
  });

  it("refuses new proofs once the replay cache is full instead of evicting live entries", () => {
    let now = 1_000;
    const cache = new DeviceProofReplayCache(2, 300_000, () => now);
    expect(cache.claim("a")).toBe(true);
    expect(cache.claim("b")).toBe(true);
    expect(cache.claim("c")).toBe(false);
    expect(cache.claim("a")).toBe(false);
    now += 300_001;
    expect(cache.claim("c")).toBe(true);
    expect(cache.claim("a")).toBe(true);
  });

  it("requires a proof of a bound device on every ingress and refuses an unbound one on the tunnel only", () => {
    const request = fake("POST", "/rpc");
    const base = { request, token: TOKEN, environmentId: ENVIRONMENT };
    for (const ingress of ["direct", "mobile", "tunnel"] as const)
      expect(checkDeviceProof({ ...base, ingress, binding })).toEqual({
        ok: false,
        reason: "proof-required",
      });
    expect(checkDeviceProof({ ...base, ingress: "direct", binding: undefined })).toEqual({
      ok: true,
    });
    expect(checkDeviceProof({ ...base, ingress: "mobile", binding: undefined })).toEqual({
      ok: true,
    });
    expect(checkDeviceProof({ ...base, ingress: "tunnel", binding: undefined })).toEqual({
      ok: false,
      reason: "proof-required",
    });
  });

  it("gates by the credential's own binding and the request's ingress", async () => {
    const secret = "s".repeat(72);
    const gate = createDeviceProofGate({
      environmentId: ENVIRONMENT,
      mobileIngressSecret: () => secret,
      authority: async (token) => (token === TOKEN ? { binding } : undefined),
      cache: new DeviceProofReplayCache(),
    });
    const withIngress = (value: string, proof?: string) => {
      const request = fake("POST", "/rpc", proof);
      request.headers = { [MOBILE_INGRESS_HEADER]: value };
      return request;
    };
    expect(await gate(withIngress(secret, sign()), TOKEN)).toEqual({ ok: true });
    expect((await gate(withIngress(secret), TOKEN)).ok).toBe(false);
    // A forged phone-listener claim is refused whatever the credential.
    expect((await gate(withIngress("forged", sign()), TOKEN)).ok).toBe(false);
    // Not a paired device: the policy leaves it to the other principals' own checks.
    expect(await gate(withIngress(secret), "u".repeat(43))).toEqual({ ok: true });
  });
});

type Fixture = Awaited<ReturnType<typeof setup>>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-device-proof-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  let phonesPublic = false;
  const tunnels = {
    boot: vi.fn(async () => {}),
    publicHostUrl: vi.fn(() => undefined),
    publicPhoneUrls: vi.fn(() => [] as string[]),
    allowsPhonesOverPublic: vi.fn(() => phonesPublic),
    setPhonesOverPublic: vi.fn(async (input: { enabled?: unknown }) => {
      phonesPublic = input.enabled === true;
      return { phonesOverPublic: phonesPublic };
    }),
    status: vi.fn(async () => ({})),
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
  // The tunnel ingress listens on its own port once the Host is listening.
  while (server.tunnelIngress.port() === undefined) await new Promise((r) => setTimeout(r, 5));
  const directPort = (server.address() as { port: number }).port;
  const tunnelPort = server.tunnelIngress.port()!;
  const environmentId = store.environmentId;
  const sockets = new Set<Duplex>();
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const proofFor = (seed: Uint8Array, token: string, method: string, path: string) =>
    signDeviceProof({ seed, token, method, path, environmentId });
  const call = async (
    port: number,
    token: string,
    method: string,
    params: unknown = {},
    proof?: string,
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(proof ? { DPoP: proof } : {}) },
      body: JSON.stringify({ version: 1, environmentId, method, params }),
    });
    return {
      status: response.status,
      headers: response.headers,
      value: (await response.json()) as { result?: any; error?: string; reason?: string },
    };
  };
  /** Calls with a fresh proof signed by `seed` for this exact request. */
  const signed = (port: number, seed: Uint8Array, token: string, method: string, params = {}) =>
    call(port, token, method, params, proofFor(seed, token, "POST", "/rpc"));
  const upgrade = (port: number, token: string, proof?: string) =>
    new Promise<{ status: number; headers: IncomingMessage["headers"]; socket?: Duplex }>(
      (resolve) => {
        const request = httpRequest({
          host: "127.0.0.1",
          port,
          path: "/ws",
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
            "Sec-WebSocket-Protocol": WS_SUBPROTOCOL,
            Authorization: `Bearer ${token}`,
            ...(proof ? { DPoP: proof } : {}),
          },
        });
        request.on("upgrade", (response, socket) => {
          sockets.add(socket);
          resolve({ status: 101, headers: response.headers, socket });
        });
        request.on("response", (response) => {
          response.resume();
          resolve({ status: response.statusCode ?? 0, headers: response.headers });
        });
        request.on("error", () => resolve({ status: 0, headers: {} }));
        request.end();
      },
    );
  const bulk = async (token: string, proof?: string) => {
    const response = await fetch(`http://127.0.0.1:${directPort}/ws-bulk/unknown?offset=0`, {
      headers: { Authorization: `Bearer ${token}`, ...(proof ? { DPoP: proof } : {}) },
    });
    return { status: response.status, stage: response.headers.get("x-bycoda-auth-stage") };
  };
  return {
    store,
    server,
    tunnels,
    directPort,
    tunnelPort,
    environmentId,
    call,
    signed,
    upgrade,
    bulk,
    proofFor,
    setPhonesPublic: (value: boolean) => (phonesPublic = value),
  };
}

const ownerSeed = seedOf(1);
const phoneSeed = seedOf(2);

describe("Host enforces device proofs", () => {
  async function devices(s: Fixture) {
    const unbound = await s.store.issueDevice("Old desktop", "desktop", true);
    const bound = await s.store.issueDevice(
      "Bound desktop",
      "desktop",
      false,
      bindingOf(ownerSeed),
    );
    return { unbound, bound };
  }

  it("refuses a bound device without a valid proof on direct and tunnel HTTP, and a replay", async () => {
    const s = await setup();
    const { bound } = await devices(s);
    for (const port of [s.directPort, s.tunnelPort]) {
      const missing = await s.call(port, bound.token, "environment.describe");
      expect(missing.status).toBe(401);
      expect(missing.headers.get("x-bycoda-auth-stage")).toBe("proof");
      expect(missing.headers.get("www-authenticate")).toBe('DPoP error="invalid_dpop_proof"');
      expect(missing.value.reason).toBe("proof-required");
      const proof = s.proofFor(ownerSeed, bound.token, "POST", "/rpc");
      expect((await s.call(port, bound.token, "environment.describe", {}, proof)).status).toBe(200);
      const replay = await s.call(port, bound.token, "environment.describe", {}, proof);
      expect(replay.status).toBe(401);
      expect(replay.value.reason).toBe("replayed-proof");
      // Another key's proof, and a proof for another route, never pass.
      expect((await s.signed(port, phoneSeed, bound.token, "environment.describe")).status).toBe(
        401,
      );
      expect(
        (
          await s.call(
            port,
            bound.token,
            "environment.describe",
            {},
            s.proofFor(ownerSeed, bound.token, "POST", "/ws"),
          )
        ).status,
      ).toBe(401);
    }
  });

  it("accepts an unbound device directly and refuses it on the tunnel", async () => {
    const s = await setup();
    const { unbound } = await devices(s);
    expect((await s.call(s.directPort, unbound.token, "environment.describe")).status).toBe(200);
    const tunnel = await s.call(s.tunnelPort, unbound.token, "environment.describe");
    expect(tunnel.status).toBe(401);
    expect(tunnel.value.reason).toBe("proof-required");
  });

  it("enforces the same policy at the WebSocket upgrade and on bulk reads", async () => {
    const s = await setup();
    const { bound, unbound } = await devices(s);
    expect((await s.upgrade(s.directPort, bound.token)).status).toBe(401);
    const refused = await s.upgrade(s.directPort, bound.token);
    expect(refused.headers["x-bycoda-auth-stage"]).toBe("proof");
    const proof = () => s.proofFor(ownerSeed, bound.token, "GET", "/ws");
    expect((await s.upgrade(s.directPort, bound.token, proof())).status).toBe(101);
    const replayed = proof();
    expect((await s.upgrade(s.directPort, bound.token, replayed)).status).toBe(101);
    expect((await s.upgrade(s.directPort, bound.token, replayed)).status).toBe(401);
    expect((await s.upgrade(s.tunnelPort, bound.token, proof())).status).toBe(101);
    expect((await s.upgrade(s.directPort, unbound.token)).status).toBe(101);
    expect((await s.upgrade(s.tunnelPort, unbound.token)).status).toBe(401);
    // Bulk transfers: the proof is checked before the transfer is even looked up.
    expect(await s.bulk(bound.token)).toEqual({ status: 401, stage: "proof" });
    const withProof = await s.bulk(
      bound.token,
      s.proofFor(ownerSeed, bound.token, "GET", "/ws-bulk/unknown?offset=0"),
    );
    expect(withProof.stage).not.toBe("proof");
  });

  it("binds an unbound credential once, by proof of the new key, and never over the tunnel", async () => {
    const s = await setup();
    const { unbound } = await devices(s);
    const key = deviceProofKeyFromSeed(phoneSeed);
    const bind = { proofKey: key.publicJwk };
    // The request itself must be signed by the key being bound.
    expect(
      (await s.call(s.directPort, unbound.token, "devices.bindProofKey", bind)).status,
    ).not.toBe(200);
    expect(
      (await s.signed(s.directPort, ownerSeed, unbound.token, "devices.bindProofKey", bind)).status,
    ).not.toBe(200);
    expect((await s.store.deviceAuthority(unbound.token))?.binding).toBeUndefined();
    const bound = await s.signed(
      s.directPort,
      phoneSeed,
      unbound.token,
      "devices.bindProofKey",
      bind,
    );
    expect(bound.status).toBe(200);
    expect(bound.value.result).toEqual({ proofBound: true, jkt: key.jkt });
    expect((await s.store.deviceAuthority(unbound.token))?.binding).toEqual({
      jkt: key.jkt,
      x: key.publicJwk.x,
    });
    // Bearer alone is no longer enough; the same key again is idempotent.
    expect((await s.call(s.directPort, unbound.token, "environment.describe")).status).toBe(401);
    expect(
      (await s.signed(s.directPort, phoneSeed, unbound.token, "devices.bindProofKey", bind)).status,
    ).toBe(200);
    // A different key never replaces the first, even with a proof signed by it.
    const other = deviceProofKeyFromSeed(ownerSeed);
    const different = await s.signed(
      s.directPort,
      phoneSeed,
      unbound.token,
      "devices.bindProofKey",
      {
        proofKey: other.publicJwk,
      },
    );
    expect(different.status).not.toBe(200);
    expect(different.value.error).toMatch(/different key/);
    // Over a public tunnel the call is refused even for the bound key.
    const overTunnel = await s.signed(
      s.tunnelPort,
      phoneSeed,
      unbound.token,
      "devices.bindProofKey",
      bind,
    );
    expect(overTunnel.status).toBe(400);
    expect(overTunnel.value.error).toMatch(/private connection/);
  });

  it("describes only the caller's own credential and advertises the capability", async () => {
    const s = await setup();
    const { unbound, bound } = await devices(s);
    const mine = await s.call(s.directPort, unbound.token, "environment.describe");
    expect(mine.value.result.credential).toEqual({
      kind: "desktop",
      localDesktop: true,
      proofBound: false,
    });
    expect(mine.value.result.capabilities).toContain("auth.deviceProof.v1");
    const theirs = await s.signed(s.directPort, ownerSeed, bound.token, "environment.describe");
    expect(theirs.value.result.credential).toEqual({
      kind: "desktop",
      localDesktop: false,
      proofBound: true,
    });
  });

  it("requires a proof key to pair and binds the new credential to it", async () => {
    const s = await setup();
    const { unbound } = await devices(s);
    const ticket = (await s.call(s.directPort, unbound.token, "mobile.pairing.create")).value
      .result as { ticket: string };
    const redeem = async (body: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${s.directPort}/mobile/pairing/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          environmentId: s.environmentId,
          ticket: ticket.ticket,
          ...body,
        }),
      });
      return { status: response.status, value: (await response.json()) as any };
    };
    const claimId = randomBytes(32).toString("base64url");
    expect((await redeem({ claimId })).status).toBe(400);
    expect(
      (await redeem({ claimId, proofKey: { kty: "OKP", crv: "Ed25519", x: "AAAA" } })).status,
    ).toBe(400);
    const key = deviceProofKeyFromSeed(phoneSeed);
    const paired = await redeem({ claimId, proofKey: key.publicJwk });
    expect(paired.status).toBe(200);
    const credential = paired.value.result as { token: string };
    expect((await s.store.deviceAuthority(credential.token))?.binding?.jkt).toBe(key.jkt);
    // A retry must present the same key; another key cannot recover the credential.
    expect((await redeem({ claimId, proofKey: key.publicJwk })).status).toBe(200);
    expect(
      (await redeem({ claimId, proofKey: deviceProofKeyFromSeed(ownerSeed).publicJwk })).status,
    ).toBe(400);
    expect((await s.call(s.directPort, credential.token, "environment.describe")).status).toBe(401);
  });

  it("closes the phone sockets a public tunnel carries when public phone access is turned off", async () => {
    const s = await setup();
    const owner = await s.store.issueDevice("Owner", "desktop", true);
    const phone = await s.store.issueDevice("Phone", "phone", false, bindingOf(phoneSeed));
    const desktop = await s.store.issueDevice(
      "Other desktop",
      "desktop",
      false,
      bindingOf(ownerSeed),
    );
    s.setPhonesPublic(true);
    const phoneSocket = (
      await s.upgrade(s.tunnelPort, phone.token, s.proofFor(phoneSeed, phone.token, "GET", "/ws"))
    ).socket!;
    const desktopSocket = (
      await s.upgrade(
        s.tunnelPort,
        desktop.token,
        s.proofFor(ownerSeed, desktop.token, "GET", "/ws"),
      )
    ).socket!;
    expect(phoneSocket).toBeDefined();
    const closed = new Promise<void>((resolve) => phoneSocket.once("close", () => resolve()));
    const result = await s.call(s.directPort, owner.token, "tunnels.phones", { enabled: false });
    expect(result.status).toBe(200);
    await closed;
    expect(phoneSocket.destroyed).toBe(true);
    // Other credentials keep their sockets.
    expect(desktopSocket.destroyed).toBe(false);
  });
});
