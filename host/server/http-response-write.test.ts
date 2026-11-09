import { createServer, request, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { endResponseAndAwaitWrite } from "./http-response-write";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** Starts a server, sends one request and resolves with the server-side response object. */
async function exchange(disconnect: boolean) {
  let reply!: (response: ServerResponse) => void;
  const received = new Promise<ServerResponse>((resolve) => (reply = resolve));
  const server = createServer((req, response) => {
    req.resume();
    reply(response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = request({
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    method: "POST",
  });
  const body = new Promise<string>((resolve, reject) => {
    client.on("response", (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve(text));
    });
    client.on("error", reject);
  });
  body.catch(() => undefined);
  client.end("{}");
  const response = await received;
  if (disconnect) {
    client.destroy();
    await new Promise<void>((resolve) =>
      response.closed ? resolve() : response.once("close", () => resolve()),
    );
  }
  return { response, body };
}

describe("endResponseAndAwaitWrite", () => {
  it("settles after the body is written and reports it as sent", async () => {
    const { response, body } = await exchange(false);
    let sent = false;
    await endResponseAndAwaitWrite(response, '{"result":1}', () => (sent = true));
    expect(sent).toBe(true);
    await expect(body).resolves.toBe('{"result":1}');
  });

  it("rejects instead of waiting forever when the client already disconnected", async () => {
    const { response } = await exchange(true);
    let sent = false;
    const outcome = await Promise.race([
      endResponseAndAwaitWrite(response, "{}", () => (sent = true)).then(
        () => "resolved",
        (error: Error) => error.message,
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 1000)),
    ]);
    expect(outcome).toBe("Response closed before write completed.");
    expect(sent).toBe(false);
  });
});
