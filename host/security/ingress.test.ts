import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTunnelIngress,
  refusesPhoneOnTunnel,
  requestIngress,
  type TunnelIngress,
} from "./ingress";

const PHONE = "p".repeat(43);
const DESKTOP = "d".repeat(43);
const SECRET = "s".repeat(72);

let main: Server;
let ingress: TunnelIngress;

afterEach(async () => {
  await ingress?.close();
  await new Promise<void>((resolve) => (main ? main.close(() => resolve()) : resolve()));
});

/** A main Host stand-in that answers with how it classified the request. */
async function start(lookup: (token: string) => Promise<boolean> = async (t) => t === PHONE) {
  main = createServer((request, response) => {
    response.end(String(requestIngress(request, SECRET)));
  });
  main.on("upgrade", (request, socket) => {
    socket.end(
      `HTTP/1.1 101 Switching Protocols\r\nX-Ingress: ${requestIngress(request, SECRET)}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => main.listen(0, "127.0.0.1", resolve));
  ingress = createTunnelIngress(main, {}, lookup);
  await ingress.listen();
  const address = main.address();
  if (!address || typeof address === "string") throw new Error("not listening");
  return { mainPort: address.port, tunnelPort: ingress.port()! };
}

function get(port: number, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: "/rpc", headers }, (response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => (body += chunk.toString()));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

function upgrade(port: number, token: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: Bearer ${token}\r\n\r\n`,
      );
    });
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString()));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("Host ingress", () => {
  it("tells direct, phone-listener and tunnel requests apart although all come from loopback", async () => {
    const { mainPort, tunnelPort } = await start();
    expect((await get(mainPort)).body).toBe("direct");
    expect((await get(mainPort, { "X-Bycoda-Mobile-Ingress": SECRET })).body).toBe("mobile");
    expect((await get(mainPort, { "X-Bycoda-Mobile-Ingress": "forged" })).body).toBe("invalid");
    expect((await get(tunnelPort, { Authorization: `Bearer ${DESKTOP}` })).body).toBe("tunnel");
    // A tunnelled request cannot claim the phone listener's ingress either.
    expect(
      (
        await get(tunnelPort, {
          Authorization: `Bearer ${DESKTOP}`,
          "X-Bycoda-Mobile-Ingress": SECRET,
        })
      ).body,
    ).toBe("tunnel");
  });

  it("refuses a phone credential on the tunnel before any route runs", async () => {
    const { mainPort, tunnelPort } = await start();
    const refused = await get(tunnelPort, { Authorization: `Bearer ${PHONE}` });
    expect(refused.status).toBe(401);
    expect(refused.body).toContain("local network or Tailscale");
    expect(await upgrade(tunnelPort, PHONE)).toMatch(/^HTTP\/1\.1 401/);
    expect(await upgrade(tunnelPort, DESKTOP)).toContain("X-Ingress: tunnel");
    // The same phone credential still reaches the Host directly (local network, Tailscale).
    expect((await get(mainPort, { Authorization: `Bearer ${PHONE}` })).status).toBe(200);
  });

  it("accepts a phone credential on the tunnel only while public phone access is allowed", async () => {
    let allowed = false;
    const { tunnelPort } = await start(
      refusesPhoneOnTunnel(
        () => allowed,
        async (token) => (token === PHONE ? "phone" : "desktop"),
      ),
    );
    expect((await get(tunnelPort, { Authorization: `Bearer ${PHONE}` })).status).toBe(401);
    allowed = true;
    // Read on every request: a phone is classified as tunnel, never as this computer.
    const accepted = await get(tunnelPort, { Authorization: `Bearer ${PHONE}` });
    expect(accepted).toEqual({ status: 200, body: "tunnel" });
    expect(await upgrade(tunnelPort, PHONE)).toContain("X-Ingress: tunnel");
    allowed = false;
    expect((await get(tunnelPort, { Authorization: `Bearer ${PHONE}` })).status).toBe(401);
    expect(await upgrade(tunnelPort, PHONE)).toMatch(/^HTTP\/1\.1 401/);
    expect((await get(tunnelPort, { Authorization: `Bearer ${DESKTOP}` })).status).toBe(200);
  });

  it("refuses when the credential lookup fails", async () => {
    const { tunnelPort } = await start(async () => {
      throw new Error("database closed");
    });
    expect((await get(tunnelPort, { Authorization: `Bearer ${DESKTOP}` })).status).toBe(401);
  });
});
