import { describe, expect, it, vi } from "vitest";
import { hostRpcSupported } from "../../src/shared/model/host-contracts/methods";

const captured = vi.hoisted(() => ({ capabilities: [] as string[] }));
vi.mock("../transport/ws/server", async (original) => ({
  ...(await original<typeof import("../transport/ws/server")>()),
  attachHostWebSocketTransport: (options: { capabilities: string[] }) => {
    captured.capabilities = options.capabilities;
    return { close: async () => undefined };
  },
}));
vi.mock("../dev-servers/dev-server-tunnel", () => ({
  TUNNEL_CAPABILITY: "transport.ws.tunnel.v1",
  attachDevServerTunnel: () => ({ close: async () => undefined }),
}));
vi.mock("../mobile/tailnet-serve-hosts", () => ({
  createTailnetServeHosts: () => ({
    current: () => [],
    observe: () => undefined,
    refresh: () => undefined,
  }),
}));

import { createWebsocketRuntime } from "./websocket";
import { HOST_WS_READ_CAPABILITY } from "../transport/ws/server";

describe("Host websocket capabilities", () => {
  it("lets the phone's background voice socket send the spoken message", () => {
    createWebsocketRuntime({
      server: { listening: true },
      engine: { store: { environmentId: "environment" } },
      domainDispatcher: { methods: [] },
      mobileAccess: { status: () => undefined, observe: () => undefined },
    } as never);
    // The server adds the read capability itself; the voice socket cannot fall back to HTTP,
    // so every method its policy allows must be supported on the socket.
    const capabilities = [...captured.capabilities, HOST_WS_READ_CAPABILITY];
    for (const method of [
      "assistant.request",
      "projects.directory",
      "voice.local.start",
      "voice.local.transcribe",
      "voice.local.speak",
    ])
      expect(hostRpcSupported(method, capabilities), method).toBe(true);
  });
});
