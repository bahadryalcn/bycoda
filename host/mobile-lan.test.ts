import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLanIdentity } from "./mobile-lan-crypto";
import { createLanGateway, MobileLanAccess } from "./mobile-lan";
import { lanContext } from "../src/integrations/mobile-lan";
import { MobilePairing } from "./mobile-pairing";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return address.port;
}
const random = async (size: number) => new Uint8Array(randomBytes(size));
// Independent Node client exercises the wire contract without depending on the
// separately maintained mobile package or its dependencies.
function encryptedLanFetch(
  fetcher: typeof fetch,
  environmentId: string,
  serverKey: string,
  _random: typeof random,
): typeof fetch {
  return async (url, init) => {
    const client = createLanIdentity();
    const id = randomBytes(32).toString("hex");
    const host = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b656e032100", "hex"),
        Buffer.from(serverKey, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    const secret = diffieHellman({ privateKey: client.privateKey, publicKey: host });
    const challenge = await (
      await fetcher(`${new URL(String(url)).origin}/mobile/lan/hello`, { method: "GET" })
    ).json();
    const context = (direction: "request" | "response") =>
      Buffer.from(lanContext(environmentId, serverKey, client.publicKey, id, direction));
    const key = (direction: "request" | "response") =>
      Buffer.from(hkdfSync("sha256", secret, Buffer.from(id, "hex"), context(direction), 32));
    const cipher = createCipheriv("aes-256-gcm", key("request"), Buffer.alloc(12));
    cipher.setAAD(context("request"));
    const value = JSON.stringify({
      epoch: challenge.epoch,
      path: new URL(String(url)).pathname,
      time: Date.now(),
      token: new Headers(init?.headers).get("Authorization")?.slice(7),
      body: init?.body,
    });
    const data = Buffer.concat([
      cipher.update(value),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("hex");
    const response = await fetcher(`${new URL(String(url)).origin}/mobile/lan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, id, publicKey: client.publicKey, data }),
    });
    if (!response.ok) throw new Error("Rejected");
    const reply = await response.json();
    const bytes = Buffer.from(reply.data, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key("response"), Buffer.alloc(12));
    decipher.setAAD(context("response"));
    decipher.setAuthTag(bytes.subarray(-16));
    const result = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(),
    );
    return new Response(result.body, { status: result.status });
  };
}

describe("encrypted mobile LAN access", () => {
  it("redeems a real ticket and carries authenticated RPC without secrets on the wire", async () => {
    const owner = "a".repeat(43);
    const device = "b".repeat(43);
    const pairing = new MobilePairing({
      environmentId: "pc",
      hasDeviceHash: () => true,
      issueDevice: () => ({ id: "phone", token: device }),
    });
    const ticket = await pairing.create(owner);
    let calls = 0;
    const upstream = createServer(async (request, response) => {
      if (await pairing.handle(request, response)) return;
      calls++;
      expect(request.url).toBe("/rpc");
      expect(request.headers.authorization).toBe(`Bearer ${device}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      expect(JSON.parse(Buffer.concat(chunks).toString()).method).toBe("projects.list");
      response.end(JSON.stringify({ result: [{ name: "Private project" }] }));
    });
    const port = await listen(upstream);
    const identity = createLanIdentity();
    const gateway = createLanGateway(identity, "pc", () => port);
    const endpoint = `http://127.0.0.1:${await listen(gateway)}`;
    let captured: RequestInit | undefined;
    const wire: typeof fetch = async (url, init) => {
      captured = init;
      return fetch(url, init);
    };
    const encrypted = encryptedLanFetch(wire, "pc", identity.publicKey, random);
    const claim = {
      version: 1,
      environmentId: "pc",
      ticket: ticket.ticket,
      claimId: "c".repeat(43),
      deviceName: "My phone",
    };
    const redeemed = await encrypted(`${endpoint}/mobile/pairing/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(claim),
    });
    expect((await redeemed.json()).result.token).toBe(device);
    expect(String(captured?.body)).not.toContain(ticket.ticket);
    expect((await pairing.status(owner, ticket.pairingId)).state).toBe("paired");
    const reply = await encrypted(`${endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${device}` },
      body: JSON.stringify({ method: "projects.list" }),
    });
    expect(await reply.json()).toEqual({ result: [{ name: "Private project" }] });
    expect(new Headers(captured?.headers).has("Authorization")).toBe(false);
    expect(String(captured?.body)).not.toContain(device);
    expect(String(captured?.body)).not.toContain("projects.list");
    const replay = await fetch(`${endpoint}/mobile/lan`, captured);
    expect(replay.status).toBe(403);
    expect(calls).toBe(1);
    const tampered = JSON.parse(String(captured?.body));
    tampered.id = randomBytes(32).toString("hex");
    expect(
      (await fetch(`${endpoint}/mobile/lan`, { ...captured, body: JSON.stringify(tampered) }))
        .status,
    ).toBe(403);
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    const restarted = createLanGateway(identity, "pc", () => port);
    const restartedEndpoint = `http://127.0.0.1:${await listen(restarted)}`;
    expect((await fetch(`${restartedEndpoint}/mobile/lan`, captured)).status).toBe(403);
    expect(calls).toBe(1);
    await pairing.close();
  });
  it("rejects raw bearer RPC, browser origins, wrong pins and modified replies", async () => {
    let calls = 0;
    const upstream = createServer((_request, response) => {
      calls++;
      response.writeHead(401).end('{"error":"revoked"}');
    });
    const port = await listen(upstream);
    const identity = createLanIdentity();
    const gateway = createLanGateway(identity, "pc", () => port);
    const endpoint = `http://127.0.0.1:${await listen(gateway)}`;
    expect(
      (
        await fetch(`${endpoint}/rpc`, {
          method: "POST",
          headers: { Authorization: `Bearer ${"a".repeat(43)}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${endpoint}/mobile/lan`, {
          method: "POST",
          headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const init = {
      method: "POST",
      headers: { Authorization: `Bearer ${"a".repeat(43)}` },
      body: "{}",
    };
    const wrong = encryptedLanFetch(fetch, "pc", createLanIdentity().publicKey, random);
    await expect(wrong(`${endpoint}/rpc`, init)).rejects.toThrow();
    expect(calls).toBe(0);
    const encrypted = encryptedLanFetch(fetch, "pc", identity.publicKey, random);
    expect((await encrypted(`${endpoint}/rpc`, init)).status).toBe(401);
    const swapped: typeof fetch = async (url, options) => {
      const result = await fetch(url, options);
      if (String(url).endsWith("/hello")) return result;
      const data = await result.json();
      data.data = `${data.data[0] === "0" ? "1" : "0"}${data.data.slice(1)}`;
      return new Response(JSON.stringify(data));
    };
    await expect(
      encryptedLanFetch(swapped, "pc", identity.publicKey, random)(`${endpoint}/rpc`, init),
    ).rejects.toThrow();
  });
  it("keeps status read-only and does not bind arbitrary addresses", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bycoda-mobile-lan-"));
    folders.push(folder);
    const file = join(folder, "mobile-lan.json");
    const access = new MobileLanAccess(
      file,
      "pc",
      () => 3776,
      () => ["192.168.1.20"],
    );
    expect(await access.status()).toMatchObject({
      mode: "lan",
      state: "setup-required",
      addresses: ["192.168.1.20"],
    });
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await access.enable("8.8.8.8")).toMatchObject({ state: "setup-required" });
    expect(await access.enable("192.168.1.21")).toMatchObject({ state: "setup-required" });
    await access.close();
    await expect(access.enable()).rejects.toThrow("closing");
  });
  it("persists an explicitly enabled listener, resumes its pin and disables only LAN access", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bycoda-mobile-lan-"));
    folders.push(folder);
    const file = join(folder, "mobile-lan.json");
    const bindings: unknown[][] = [];
    const make: typeof createLanGateway = () => {
      const gateway = createServer();
      vi.spyOn(gateway, "listen").mockImplementation((...args: unknown[]) => {
        bindings.push(args.slice(0, 2));
        (args.at(-1) as () => void)();
        return gateway;
      });
      vi.spyOn(gateway, "address").mockReturnValue({
        address: "192.168.1.20",
        port: 43210,
        family: "IPv4",
      });
      return gateway;
    };
    const first = new MobileLanAccess(
      file,
      "pc",
      () => 3776,
      () => ["192.168.1.20"],
      make,
    );
    const [a, b] = await Promise.all([first.enable(), first.enable()]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ state: "ready", endpoint: "http://192.168.1.20:43210" });
    expect(bindings).toEqual([[0, "192.168.1.20"]]);
    await first.close();
    const resumed = new MobileLanAccess(
      file,
      "pc",
      () => 3776,
      () => ["192.168.1.20"],
      make,
    );
    await resumed.start();
    expect(await resumed.status()).toMatchObject({ lanKey: a.lanKey, state: "ready" });
    expect(bindings[1]).toEqual([43210, "192.168.1.20"]);
    expect(await resumed.disable()).toMatchObject({ state: "setup-required" });
    expect(JSON.parse(await readFile(file, "utf8")).enabled).toBe(false);
    await resumed.close();
    const disabled = new MobileLanAccess(
      file,
      "pc",
      () => 3776,
      () => ["192.168.1.20"],
      make,
    );
    await disabled.start();
    expect(bindings).toHaveLength(2);
    await disabled.close();
  });
});
