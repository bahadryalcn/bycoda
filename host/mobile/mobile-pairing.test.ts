import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostProof } from "./host-proof";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import { MOBILE_PAIRING_TTL_MS } from "../../src/integrations/mobile-pairing";
import { MobilePairing, MobilePairingError, type MobilePairingCreated } from "./mobile-pairing";

const managers: MobilePairing[] = [];
const servers: Server[] = [];
const secret = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function setup() {
  let time = 100_000;
  const owner = secret();
  const otherOwner = secret();
  const deviceHashes = new Set([digest(owner), digest(otherOwner)]);
  const issueDevice = vi.fn((_name: string) => {
    const token = secret();
    deviceHashes.add(digest(token));
    return { id: randomUUID(), token };
  });
  const manager = new MobilePairing(
    {
      environmentId: "test-environment",
      hasDeviceHash: (hash) => deviceHashes.has(hash),
      deviceProofKeys: async () => [...deviceHashes],
      proofOrigins: async () => ["https://host.test"],
      issueDevice,
    },
    () => time,
  );
  managers.push(manager);
  const redeem = (
    ticket: MobilePairingCreated,
    claimId = secret(),
    deviceName = "My test phone",
  ) => ({
    version: 1,
    environmentId: ticket.environmentId,
    ticket: ticket.ticket,
    claimId,
    deviceName,
  });
  return {
    manager,
    owner,
    otherOwner,
    deviceHashes,
    issueDevice,
    redeem,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

async function listen(manager: MobilePairing) {
  const server = createServer(async (request, response) => {
    if (!(await manager.handle(request, response))) response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener missing");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const manager of managers.splice(0)) manager.close();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  vi.useRealTimers();
});

it.each(["desktop", "phone", "invalid", undefined])(
  "carries pairing kind %s into issuance with phone fallback",
  async (kind) => {
    const { manager, owner, issueDevice, redeem } = setup();
    const ticket = await manager.create(owner, { kind });
    await manager.redeem(redeem(ticket));
    expect(issueDevice).toHaveBeenCalledExactlyOnceWith(
      "My test phone",
      kind === "desktop" ? "desktop" : "phone",
    );
  },
);

it("serializes asynchronous claims and never replays an issuance with an uncertain outcome", async () => {
  const owner = secret();
  const allowed = new Set([digest(owner)]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const issued = { id: randomUUID(), token: secret() };
  const issueDevice = vi.fn(async () => {
    await gate;
    allowed.add(digest(issued.token));
    return issued;
  });
  const manager = new MobilePairing({
    environmentId: "test-environment",
    hasDeviceHash: async (hash) => allowed.has(hash),
    issueDevice,
  });
  managers.push(manager);
  const ticket = await manager.create(owner);
  const input = {
    version: 1,
    environmentId: ticket.environmentId,
    ticket: ticket.ticket,
    claimId: secret(),
    deviceName: "Phone",
  };
  const first = manager.redeem(input);
  const second = manager.redeem(input);
  release();
  expect(await first).toEqual(await second);
  expect(issueDevice).toHaveBeenCalledOnce();
  const uncertain = await manager.create(owner);
  const retry = { ...input, ticket: uncertain.ticket, claimId: secret() };
  issueDevice.mockRejectedValueOnce(new Error("durable acknowledgement lost"));
  await expect(manager.redeem(retry)).rejects.toThrow("acknowledgement lost");
  await expect(manager.redeem(retry)).rejects.toThrow("invalid or expired");
  expect(issueDevice).toHaveBeenCalledTimes(2);
});

describe("short-lived mobile pairing", () => {
  it("proves ticket and saved-device possession without receiving either secret or hash", async () => {
    const { manager, owner, deviceHashes, issueDevice } = setup();
    const ticket = await manager.create(owner);
    const base = await listen(manager);
    for (const [kind, key] of [
      ["pairing", digest(ticket.ticket)],
      ["device", digest(owner)],
    ] as const) {
      const nonce = randomBytes(32).toString("hex");
      const challenge = {
        kind,
        nonce,
        environmentId: ticket.environmentId,
        origin: "https://host.test",
        proof: hostProof(key, kind, "request", nonce, ticket.environmentId, "https://host.test"),
      };
      const response = await fetch(`${base}/.well-known/bycoda-host/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challenge),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        result: {
          proof: hostProof(key, kind, "response", nonce, ticket.environmentId, "https://host.test"),
        },
      });
      expect(JSON.stringify(challenge)).not.toContain(key);
    }
    expect(issueDevice).not.toHaveBeenCalled();
    deviceHashes.delete(digest(owner));
    const nonce = randomBytes(32).toString("hex");
    const refused = await fetch(`${base}/.well-known/bycoda-host/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "device",
        nonce,
        environmentId: ticket.environmentId,
        origin: "https://host.test",
        proof: hostProof(
          digest(owner),
          "device",
          "request",
          nonce,
          ticket.environmentId,
          "https://host.test",
        ),
      }),
    });
    expect(refused.status).toBe(403);
  });

  it("refuses forged, cancelled and expired pairing proofs and rate limits challenges", async () => {
    const { manager, owner, advance } = setup();
    const ticket = await manager.create(owner);
    const base = await listen(manager);
    const nonce = randomBytes(32).toString("hex");
    const body = {
      kind: "pairing",
      nonce,
      environmentId: ticket.environmentId,
      origin: "https://host.test",
      proof: hostProof(
        digest(ticket.ticket),
        "pairing",
        "request",
        nonce,
        ticket.environmentId,
        "https://host.test",
      ),
    };
    const send = (input = body) =>
      fetch(`${base}/.well-known/bycoda-host/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    expect((await send({ ...body, proof: "0".repeat(64) })).status).toBe(403);
    expect(
      (
        await send({
          ...body,
          origin: "https://attacker.trycloudflare.com",
          proof: hostProof(
            digest(ticket.ticket),
            "pairing",
            "request",
            nonce,
            ticket.environmentId,
            "https://attacker.trycloudflare.com",
          ),
        })
      ).status,
    ).toBe(403);
    await manager.cancel(owner, ticket.pairingId);
    expect((await send()).status).toBe(403);
    advance(MOBILE_PAIRING_TTL_MS);
    expect((await send()).status).toBe(403);
    for (let i = 0; i < 119; i++) await send();
    expect((await send()).status).toBe(429);
  });
  it("creates a high entropy ticket without issuing a device or exposing secrets in status", async () => {
    const { manager, owner, issueDevice } = setup();
    const ticket = await manager.create(owner, { name: "My phone" });
    expect(ticket.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(ticket.expiresAt)).toBe(100_000 + MOBILE_PAIRING_TTL_MS);
    expect(ticket.environmentId).toBe("test-environment");
    expect(issueDevice).not.toHaveBeenCalled();
    expect(await manager.status(owner, ticket.pairingId)).toEqual({ state: "pending" });
    expect(Object.keys(await manager.status(owner, ticket.pairingId))).toEqual(["state"]);
  });

  it("retries a lost response with the same claim without issuing another credential", async () => {
    const { manager, owner, issueDevice, redeem } = setup();
    const ticket = await manager.create(owner);
    const input = redeem(ticket);
    const result = await manager.redeem(input);
    expect(await manager.redeem(input)).toEqual(result);
    expect(issueDevice).toHaveBeenCalledExactlyOnceWith("My test phone", "phone");
    expect(await manager.status(owner, ticket.pairingId)).toEqual({
      state: "paired",
      deviceName: "My test phone",
    });
    const returnedCopy = await manager.redeem(input);
    returnedCopy.token = "changed-outside-manager";
    expect(await manager.redeem(input)).toEqual(result);
    expect(Object.keys(await manager.status(owner, ticket.pairingId))).toEqual([
      "state",
      "deviceName",
    ]);
  });

  it("rejects a competing claim and changed payload after the first redemption", async () => {
    const { manager, owner, issueDevice, redeem } = setup();
    const input = redeem(await manager.create(owner));
    await manager.redeem(input);
    await expect(
      (async () => await manager.redeem({ ...input, claimId: secret() }))(),
    ).rejects.toThrow("invalid or expired");
    await expect(
      (async () => await manager.redeem({ ...input, deviceName: "Another phone" }))(),
    ).rejects.toThrow("invalid or expired");
    await expect(
      (async () => await manager.redeem({ ...input, environmentId: "different-host" }))(),
    ).rejects.toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("limits cancellation and status to the issuing owner and leaves a paired phone authorized", async () => {
    const { manager, owner, otherOwner, deviceHashes, issueDevice, redeem } = setup();
    const pending = await manager.create(owner);
    expect(await manager.status(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    expect(await manager.cancel(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    expect(await manager.status(owner, pending.pairingId)).toEqual({ state: "pending" });
    expect(await manager.cancel(owner, pending.pairingId)).toEqual({ state: "cancelled" });
    await expect((async () => await manager.redeem(redeem(pending)))()).rejects.toThrow(
      "invalid or expired",
    );
    expect(issueDevice).not.toHaveBeenCalled();
    const paired = await manager.create(owner);
    const input = redeem(paired);
    const result = await manager.redeem(input);
    expect(await manager.cancel(owner, paired.pairingId)).toEqual({
      state: "paired",
      deviceName: "My test phone",
    });
    expect(deviceHashes.has(digest(result.token))).toBe(true);
    expect(await manager.redeem(input)).toEqual(result);
  });

  it("invalidates a replaced pending QR while keeping another owner's QR intact", async () => {
    const { manager, owner, otherOwner, redeem, issueDevice } = setup();
    const first = await manager.create(owner);
    const other = await manager.create(otherOwner);
    const replacement = await manager.create(owner);
    expect(await manager.status(owner, first.pairingId)).toEqual({ state: "cancelled" });
    await expect((async () => await manager.redeem(redeem(first)))()).rejects.toThrow(
      "invalid or expired",
    );
    expect(await manager.status(otherOwner, other.pairingId)).toEqual({ state: "pending" });
    expect(await manager.status(owner, replacement.pairingId)).toEqual({ state: "pending" });
    expect(issueDevice).not.toHaveBeenCalled();
  });

  it("expires pending and retry credentials at the original TTL without extending it", async () => {
    const { manager, owner, otherOwner, redeem, advance, issueDevice } = setup();
    const paired = await manager.create(owner);
    const pending = await manager.create(otherOwner);
    const input = redeem(paired);
    const result = await manager.redeem(input);
    advance(MOBILE_PAIRING_TTL_MS - 1);
    expect(await manager.redeem(input)).toEqual(result);
    advance(1);
    expect(await manager.status(owner, paired.pairingId)).toEqual({ state: "expired" });
    expect(await manager.status(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    await expect((async () => await manager.redeem(input))()).rejects.toThrow("invalid or expired");
    await expect((async () => await manager.redeem(redeem(pending)))()).rejects.toThrow(
      "invalid or expired",
    );
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("drops idle retry credentials with its TTL timer and on host shutdown", async () => {
    vi.useFakeTimers();
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    await manager.redeem(input);
    vi.advanceTimersByTime(MOBILE_PAIRING_TTL_MS);
    await expect((async () => await manager.redeem(input))()).rejects.toThrow("invalid or expired");
    const second = redeem(await manager.create(owner));
    await manager.redeem(second);
    manager.close();
    await expect((async () => await manager.redeem(second))()).rejects.toThrow(
      "invalid or expired",
    );
    expect(issueDevice).toHaveBeenCalledTimes(2);
  });

  it("recovers a redeem response lost near QR expiry with the same claim, then drops the credential", async () => {
    const { manager, owner, redeem, advance, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    advance(MOBILE_PAIRING_TTL_MS - 1_000);
    const result = await manager.redeem(input);
    // The response is lost; the retry arrives after the QR itself has expired.
    advance(2_000);
    expect(await manager.redeem(input)).toEqual(result);
    await expect(
      (async () => await manager.redeem({ ...input, claimId: secret() }))(),
    ).rejects.toThrow("invalid or expired");
    expect(await manager.redeem(input)).toEqual(result);
    expect(issueDevice).toHaveBeenCalledOnce();
    advance(MOBILE_PAIRING_TTL_MS);
    await expect((async () => await manager.redeem(input))()).rejects.toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledOnce();
  });

  it("rechecks revoked issuer authorization before first redemption and every retry", async () => {
    const { manager, owner, otherOwner, deviceHashes, redeem, issueDevice } = setup();
    const pending = redeem(await manager.create(owner));
    const paired = redeem(await manager.create(otherOwner));
    await manager.redeem(paired);
    deviceHashes.delete(digest(owner));
    deviceHashes.delete(digest(otherOwner));
    await expect((async () => await manager.redeem(pending))()).rejects.toThrow(
      "invalid or expired",
    );
    await expect((async () => await manager.redeem(paired))()).rejects.toThrow(
      "invalid or expired",
    );
    await expect((async () => await manager.create(owner))()).rejects.toThrow("invalid or revoked");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("does not return a phone credential that was revoked after pairing", async () => {
    const { manager, owner, deviceHashes, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    const result = await manager.redeem(input);
    deviceHashes.delete(digest(result.token));
    await expect((async () => await manager.redeem(input))()).rejects.toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent tickets without evicting another live retry credential", async () => {
    const { manager, owner, deviceHashes, redeem, issueDevice } = setup();
    const firstInput = redeem(await manager.create(owner));
    const firstResult = await manager.redeem(firstInput);
    for (let index = 1; index < 32; index++) {
      const nextOwner = secret();
      deviceHashes.add(digest(nextOwner));
      await manager.create(nextOwner);
    }
    const overflowOwner = secret();
    deviceHashes.add(digest(overflowOwner));
    await expect((async () => await manager.create(overflowOwner))()).rejects.toThrow(
      "Too many phone connections",
    );
    expect(await manager.redeem(firstInput)).toEqual(firstResult);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("bounds creation and redemption attempts and recovers after the rate window", async () => {
    const { manager, owner, advance, redeem, issueDevice } = setup();
    for (let index = 0; index < 10; index++) await manager.create(owner);
    await expect((async () => await manager.create(owner))()).rejects.toThrow(
      "Too many pairing attempts",
    );
    advance(60_000);
    const input = redeem(await manager.create(owner));
    for (let index = 0; index < 120; index++) {
      await expect(
        (async () => await manager.redeem({ ...input, ticket: secret() }))(),
      ).rejects.toThrow("invalid or expired");
    }
    await expect((async () => await manager.redeem(input))()).rejects.toThrow(MobilePairingError);
    expect(issueDevice).not.toHaveBeenCalled();
    advance(60_000);
    expect((await manager.redeem(input)).environmentId).toBe("test-environment");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });
});

describe("native pairing redemption HTTP boundary", () => {
  it("accepts only the narrow POST JSON route and rejects browser origins", async () => {
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    const base = await listen(manager);
    const endpoint = `${base}/mobile/pairing/redeem`;
    expect((await fetch(endpoint)).status).toBe(403);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { Origin: "https://untrusted.invalid", "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(415);
    expect(issueDevice).not.toHaveBeenCalled();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const result = await response.json();
    expect(result).toEqual({ result: await manager.redeem(input) });
    expect(issueDevice).toHaveBeenCalledTimes(1);
    expect((await fetch(`${endpoint}?ticket=unused`)).status).toBe(404);
  });

  it("bounds both declared and chunked bodies without issuing a device", async () => {
    const { manager, issueDevice } = setup();
    const base = await listen(manager);
    const endpoint = `${base}/mobile/pairing/redeem`;
    const large = JSON.stringify({ padding: "x".repeat(4096) });
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: large,
        })
      ).status,
    ).toBe(413);
    const chunkedStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.once("error", reject);
      request.write(large.slice(0, 2048));
      request.end(large.slice(2048));
    });
    expect(chunkedStatus).toBe(413);
    expect(issueDevice).not.toHaveBeenCalled();
  });

  it("redacts invalid redemption failures and leaves the valid ticket available", async () => {
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    const endpoint = `${await listen(manager)}/mobile/pairing/redeem`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, version: 99 }),
    });
    const error = await response.text();
    expect(response.status).toBe(400);
    for (const value of [input.ticket, input.claimId, owner]) expect(error).not.toContain(value);
    expect(issueDevice).not.toHaveBeenCalled();
    await manager.redeem(input);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });
});

function fakeRequest(
  source: string,
  body: unknown,
  options: { method?: string; contentType?: string } = {},
) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: options.method ?? "POST",
    url: "/mobile/pairing/redeem",
    headers: { "content-type": options.contentType ?? "application/json" },
    socket: { remoteAddress: source },
  }) as unknown as IncomingMessage;
}

async function send(
  manager: MobilePairing,
  source: string,
  body: unknown,
  options?: { method?: string; contentType?: string },
): Promise<{ status: number }> {
  const reply = { status: 200 };
  const response = {
    setHeader: () => undefined,
    writeHead: (status: number) => {
      reply.status = status;
      return { end: () => undefined };
    },
    end: () => undefined,
    destroyed: false,
  } as unknown as ServerResponse;
  await manager.handle(fakeRequest(source, body, options), response);
  return reply;
}

describe("pairing redemption HTTP rate accounting", () => {
  it("does not count requests rejected before ticket validation", async () => {
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    for (let index = 0; index < 130; index++) {
      expect((await send(manager, "192.0.2.10", input, { method: "GET" })).status).toBe(403);
      expect((await send(manager, "192.0.2.10", input, { contentType: "text/plain" })).status).toBe(
        415,
      );
    }
    expect((await send(manager, "192.0.2.10", input)).status).toBe(200);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("limits one source without locking out another source's valid redemption", async () => {
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(await manager.create(owner));
    for (let index = 0; index < 120; index++) {
      expect((await send(manager, "198.51.100.7", { ...input, ticket: secret() })).status).toBe(
        400,
      );
    }
    expect((await send(manager, "198.51.100.7", input)).status).toBe(429);
    expect(issueDevice).not.toHaveBeenCalled();
    expect((await send(manager, "203.0.113.4", input)).status).toBe(200);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("enforces a Host-wide ceiling across sources", async () => {
    const { manager, owner, redeem } = setup();
    const bogus = { ...redeem(await manager.create(owner)), ticket: secret() };
    for (let source = 0; source < 5; source++) {
      for (let index = 0; index < 120; index++) {
        await send(manager, `10.0.0.${source}`, bogus);
      }
    }
    expect((await send(manager, "10.0.1.1", bogus)).status).toBe(429);
  });

  it("bounds the per-source table", async () => {
    const { manager, owner, redeem } = setup();
    const bogus = { ...redeem(await manager.create(owner)), ticket: secret() };
    for (let source = 0; source < 100; source++) {
      await send(manager, `10.1.0.${source}`, bogus);
    }
    const sources = (manager as unknown as { sourceRedemptionRates: Map<string, unknown> })
      .sourceRedemptionRates;
    expect(sources.size).toBeLessThanOrEqual(64);
  });
});
