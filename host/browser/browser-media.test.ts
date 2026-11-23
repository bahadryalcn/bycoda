import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { attachBrowserMedia } from "./browser-media";

it("admits scoped owner reads, sends binary JPEG, and retires a revoked viewer", async () => {
  const http = createServer();
  const token = "q".repeat(43);
  let allowed = true;
  const release = vi.fn();
  const documentId = "00000000-0000-4000-8000-000000000001";
  const navigationId = "00000000-0000-4000-8000-000000000002";
  let sequence = 0;
  const open = vi.fn(async (_scope: Record<string, string>, _credential: string) => ({
    release,
    next: async () => ({
      sequence: ++sequence,
      data: Buffer.from([255, 216, 255, 217]).toString("base64"),
      stamp: "document",
      documentId: documentId as typeof documentId,
      navigationId: navigationId as typeof navigationId,
      width: 1280,
      height: 720,
    }),
  }));
  const close = attachBrowserMedia({
    server: http,
    environmentId: "selected",
    allowedHosts: () => [],
    authorized: async (value) => value === token && allowed,
    open,
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Test listener unavailable");
  const endpoint = `ws://127.0.0.1:${address.port}/ws-browser-frames?projectId=p&sessionId=s`;
  const connect = (environment: string, credential = token) =>
    new WebSocket(endpoint, "bycoda.browser-frames.v1", {
      headers: { Authorization: `Bearer ${credential}`, "x-bycoda-environment": environment },
    });
  try {
    await expect(once(connect("other"), "open")).rejects.toThrow("400");
    await expect(once(connect("selected", "r".repeat(43)), "open")).rejects.toThrow("401");
    expect(open).not.toHaveBeenCalled();
    const socket = connect("selected");
    const [data, binary] = await once(socket, "message");
    expect(binary).toBe(true);
    expect(open).toHaveBeenCalledWith({ projectId: "p", sessionId: "s" }, token);
    const end = 2 + data.readUInt16BE();
    expect(JSON.parse(data.subarray(2, end).toString())).toEqual({
      documentId,
      navigationId,
      width: 1280,
      height: 720,
    });
    expect([...data.subarray(end)]).toEqual([255, 216, 255, 217]);
    allowed = false;
    await once(socket, "close");
    expect(release).toHaveBeenCalledOnce();
  } finally {
    close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
