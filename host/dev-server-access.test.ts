import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Socket } from "node:net";
import { DevServerAccess } from "./dev-server-access";
import type { DevServerDetails } from "../src/features/host-tools/devServerTypes";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(
  onData: (data: Buffer, socket: Socket) => void = (data, socket) => {
    socket.write(data);
  },
) {
  const sockets = new Set<Socket>();
  const tcp = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (data) => onData(data, socket));
  });
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const address = tcp.address();
  if (!address || typeof address === "string") throw new Error("No listening port");
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => tcp.close(() => resolve()));
  });
  const params = {
    projectId: "project",
    id: "dev",
    identity: { pid: 42, startedAt: "birth" },
    port: address.port,
    address: "127.0.0.1",
  };
  const details: DevServerDetails = {
    server: {
      id: "dev",
      projectId: "project",
      process: { pid: 42, startedAt: "birth", name: "node" },
      endpoints: [
        { port: address.port, address: "127.0.0.1", url: `http://127.0.0.1:${address.port}` },
      ],
      managed: false,
      state: "running",
      name: "dev",
      association: "cwd",
      logsAvailable: false,
    },
    descendants: [],
    affectedPorts: [address.port],
  };
  const resolve = vi.fn(async () => details);
  const service = new DevServerAccess(resolve, () => 3776);
  cleanups.push(() => service.close());
  const call = (method: string, input: Record<string, unknown> = params, owner = "paired-pc") =>
    service.handle(`devServers.bridge${method}`, input, owner);
  const open = async () => ((await call("Open")) as { streamId: string }).streamId;
  const read = async (streamId: string) =>
    (await call("Read", { projectId: "project", streamId })) as { data: string; ended: boolean };
  return { params, details, resolve, service, call, open, read };
}

describe("private development server relay", () => {
  it("relays an HTTP request and response without URL path rewriting", async () => {
    const request = "GET /nested?x=1 HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n";
    const received: Buffer[] = [];
    const test = await fixture((data, socket) => {
      received.push(data);
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello");
    });
    const streamId = await test.open();
    await test.call("Write", {
      projectId: "project",
      streamId,
      data: Buffer.from(request).toString("base64"),
    });
    const chunks: Buffer[] = [];
    let ended = false;
    while (!ended) {
      const part = await test.read(streamId);
      chunks.push(Buffer.from(part.data, "base64"));
      ended = part.ended;
    }
    expect(Buffer.concat(received).toString()).toBe(request);
    expect(Buffer.concat(chunks).toString()).toContain("\r\n\r\nhello");
  });

  it("keeps upgraded WebSocket bytes bidirectional", async () => {
    let upgraded = false;
    const test = await fixture((data, socket) => {
      if (!upgraded) {
        upgraded = true;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
      } else socket.write(data);
    });
    const streamId = await test.open();
    const write = (bytes: Buffer) =>
      test.call("Write", { projectId: "project", streamId, data: bytes.toString("base64") });
    await write(Buffer.from("GET /hmr HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n\r\n"));
    expect(Buffer.from((await test.read(streamId)).data, "base64").toString()).toContain(
      "101 Switching Protocols",
    );
    const frame = Buffer.from([0x81, 0x02, 0x6f, 0x6b]);
    await write(frame);
    expect(Buffer.from((await test.read(streamId)).data, "base64")).toEqual(frame);
  });

  it("binds stream operations to the paired device and owning project", async () => {
    const test = await fixture();
    const streamId = await test.open();
    await expect(test.call("Read", { projectId: "project", streamId }, "other-pc")).rejects.toThrow(
      "another device",
    );
    await expect(test.call("Close", { projectId: "other-project", streamId })).rejects.toThrow(
      "another device",
    );
    await test.call("Close", { projectId: "project", streamId });
    await expect(test.read(streamId)).rejects.toThrow("expired");
  });

  it("rejects stale identity, another project, uncertain discovery and the management port", async () => {
    const test = await fixture();
    await expect(
      test.call("Check", { ...test.params, identity: { pid: 42, startedAt: "stale" } }),
    ).rejects.toThrow("identity");
    await expect(test.call("Check", { ...test.params, projectId: "other" })).rejects.toThrow(
      "belong",
    );
    test.details.server.association = "uncertain";
    await expect(test.open()).rejects.toThrow("belong");
    test.details.server.association = "cwd";
    const protectedService = new DevServerAccess(test.resolve, () => test.params.port);
    cleanups.push(() => protectedService.close());
    await expect(
      protectedService.handle("devServers.bridgeOpen", test.params, "paired-pc"),
    ).rejects.toThrow("unavailable");
  });

  it("rejects oversized or malformed data before writing", async () => {
    const test = await fixture();
    const streamId = await test.open();
    for (const data of ["not base64", Buffer.alloc(256 * 1024 + 1).toString("base64")])
      await expect(test.call("Write", { projectId: "project", streamId, data })).rejects.toThrow();
  });
});
