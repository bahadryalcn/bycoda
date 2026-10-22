import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
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
    status: vi.fn(async () => ({ environmentId: store.environmentId })),
    start: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({})),
    credential: vi.fn(async () => ({ saved: true })),
    close: vi.fn(async () => {}),
  };
  const server = createHostServer(
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
  const device = store.issueDevice("Owner desktop");
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
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { tunnels, store, device, call };
}

describe("external tunnels use existing authenticated RPC", () => {
  it("rejects unauthenticated, browser-origin, revoked and cross-host operations before dispatch", async () => {
    const s = await setup();
    for (const method of [
      "tunnels.status",
      "tunnels.start",
      "tunnels.stop",
      "tunnels.credential",
    ]) {
      expect((await s.call(method)).status).toBe(401);
      expect(
        (await s.call(method, { token: s.device.token, origin: "https://evil.example" })).status,
      ).toBe(403);
      expect(
        (await s.call(method, { token: s.device.token, environmentId: "other-host" })).status,
      ).toBe(400);
    }
    s.store.revokeToken(s.device.token);
    expect((await s.call("tunnels.start", { token: s.device.token })).status).toBe(401);
    for (const method of ["status", "start", "stop", "credential"] as const)
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
  });
});
