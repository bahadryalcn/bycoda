import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import { MOBILE_PAIRING_TTL_MS } from "../src/integrations/mobile-pairing";
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

describe("short-lived mobile pairing", () => {
  it("creates a high entropy ticket without issuing a device or exposing secrets in status", () => {
    const { manager, owner, issueDevice } = setup();
    const ticket = manager.create(owner, { name: "My phone" });
    expect(ticket.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(ticket.expiresAt)).toBe(100_000 + MOBILE_PAIRING_TTL_MS);
    expect(ticket.environmentId).toBe("test-environment");
    expect(issueDevice).not.toHaveBeenCalled();
    expect(manager.status(owner, ticket.pairingId)).toEqual({ state: "pending" });
    expect(Object.keys(manager.status(owner, ticket.pairingId))).toEqual(["state"]);
  });

  it("retries a lost response with the same claim without issuing another credential", () => {
    const { manager, owner, issueDevice, redeem } = setup();
    const ticket = manager.create(owner);
    const input = redeem(ticket);
    const result = manager.redeem(input);
    expect(manager.redeem(input)).toEqual(result);
    expect(issueDevice).toHaveBeenCalledExactlyOnceWith("My test phone");
    expect(manager.status(owner, ticket.pairingId)).toEqual({
      state: "paired",
      deviceName: "My test phone",
    });
    const returnedCopy = manager.redeem(input);
    returnedCopy.token = "changed-outside-manager";
    expect(manager.redeem(input)).toEqual(result);
    expect(Object.keys(manager.status(owner, ticket.pairingId))).toEqual(["state", "deviceName"]);
  });

  it("rejects a competing claim and changed payload after the first redemption", () => {
    const { manager, owner, issueDevice, redeem } = setup();
    const input = redeem(manager.create(owner));
    manager.redeem(input);
    expect(() => manager.redeem({ ...input, claimId: secret() })).toThrow("invalid or expired");
    expect(() => manager.redeem({ ...input, deviceName: "Another phone" })).toThrow(
      "invalid or expired",
    );
    expect(() => manager.redeem({ ...input, environmentId: "different-host" })).toThrow(
      "invalid or expired",
    );
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("limits cancellation and status to the issuing owner and leaves a paired phone authorized", () => {
    const { manager, owner, otherOwner, deviceHashes, issueDevice, redeem } = setup();
    const pending = manager.create(owner);
    expect(manager.status(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    expect(manager.cancel(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    expect(manager.status(owner, pending.pairingId)).toEqual({ state: "pending" });
    expect(manager.cancel(owner, pending.pairingId)).toEqual({ state: "cancelled" });
    expect(() => manager.redeem(redeem(pending))).toThrow("invalid or expired");
    expect(issueDevice).not.toHaveBeenCalled();
    const paired = manager.create(owner);
    const input = redeem(paired);
    const result = manager.redeem(input);
    expect(manager.cancel(owner, paired.pairingId)).toEqual({
      state: "paired",
      deviceName: "My test phone",
    });
    expect(deviceHashes.has(digest(result.token))).toBe(true);
    expect(manager.redeem(input)).toEqual(result);
  });

  it("invalidates a replaced pending QR while keeping another owner's QR intact", () => {
    const { manager, owner, otherOwner, redeem, issueDevice } = setup();
    const first = manager.create(owner);
    const other = manager.create(otherOwner);
    const replacement = manager.create(owner);
    expect(manager.status(owner, first.pairingId)).toEqual({ state: "cancelled" });
    expect(() => manager.redeem(redeem(first))).toThrow("invalid or expired");
    expect(manager.status(otherOwner, other.pairingId)).toEqual({ state: "pending" });
    expect(manager.status(owner, replacement.pairingId)).toEqual({ state: "pending" });
    expect(issueDevice).not.toHaveBeenCalled();
  });

  it("expires pending and retry credentials at the original TTL without extending it", () => {
    const { manager, owner, otherOwner, redeem, advance, issueDevice } = setup();
    const paired = manager.create(owner);
    const pending = manager.create(otherOwner);
    const input = redeem(paired);
    const result = manager.redeem(input);
    advance(MOBILE_PAIRING_TTL_MS - 1);
    expect(manager.redeem(input)).toEqual(result);
    advance(1);
    expect(manager.status(owner, paired.pairingId)).toEqual({ state: "expired" });
    expect(manager.status(otherOwner, pending.pairingId)).toEqual({ state: "expired" });
    expect(() => manager.redeem(input)).toThrow("invalid or expired");
    expect(() => manager.redeem(redeem(pending))).toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("drops idle retry credentials with its TTL timer and on host shutdown", () => {
    vi.useFakeTimers();
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(manager.create(owner));
    manager.redeem(input);
    vi.advanceTimersByTime(MOBILE_PAIRING_TTL_MS);
    expect(() => manager.redeem(input)).toThrow("invalid or expired");
    const second = redeem(manager.create(owner));
    manager.redeem(second);
    manager.close();
    expect(() => manager.redeem(second)).toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledTimes(2);
  });

  it("rechecks revoked issuer authorization before first redemption and every retry", () => {
    const { manager, owner, otherOwner, deviceHashes, redeem, issueDevice } = setup();
    const pending = redeem(manager.create(owner));
    const paired = redeem(manager.create(otherOwner));
    manager.redeem(paired);
    deviceHashes.delete(digest(owner));
    deviceHashes.delete(digest(otherOwner));
    expect(() => manager.redeem(pending)).toThrow("invalid or expired");
    expect(() => manager.redeem(paired)).toThrow("invalid or expired");
    expect(() => manager.create(owner)).toThrow("invalid or revoked");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("does not return a phone credential that was revoked after pairing", () => {
    const { manager, owner, deviceHashes, redeem, issueDevice } = setup();
    const input = redeem(manager.create(owner));
    const result = manager.redeem(input);
    deviceHashes.delete(digest(result.token));
    expect(() => manager.redeem(input)).toThrow("invalid or expired");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent tickets without evicting another live retry credential", () => {
    const { manager, owner, deviceHashes, redeem, issueDevice } = setup();
    const firstInput = redeem(manager.create(owner));
    const firstResult = manager.redeem(firstInput);
    for (let index = 1; index < 32; index++) {
      const nextOwner = secret();
      deviceHashes.add(digest(nextOwner));
      manager.create(nextOwner);
    }
    const overflowOwner = secret();
    deviceHashes.add(digest(overflowOwner));
    expect(() => manager.create(overflowOwner)).toThrow("Too many phone connections");
    expect(manager.redeem(firstInput)).toEqual(firstResult);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });

  it("bounds creation and redemption attempts and recovers after the rate window", () => {
    const { manager, owner, advance, redeem, issueDevice } = setup();
    for (let index = 0; index < 10; index++) manager.create(owner);
    expect(() => manager.create(owner)).toThrow("Too many pairing attempts");
    advance(60_000);
    const input = redeem(manager.create(owner));
    for (let index = 0; index < 120; index++) {
      expect(() => manager.redeem({ ...input, ticket: secret() })).toThrow("invalid or expired");
    }
    expect(() => manager.redeem(input)).toThrow(MobilePairingError);
    expect(issueDevice).not.toHaveBeenCalled();
    advance(60_000);
    expect(manager.redeem(input).environmentId).toBe("test-environment");
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });
});

describe("native pairing redemption HTTP boundary", () => {
  it("accepts only the narrow POST JSON route and rejects browser origins", async () => {
    const { manager, owner, redeem, issueDevice } = setup();
    const input = redeem(manager.create(owner));
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
    expect(result).toEqual({ result: manager.redeem(input) });
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
    const input = redeem(manager.create(owner));
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
    manager.redeem(input);
    expect(issueDevice).toHaveBeenCalledTimes(1);
  });
});
