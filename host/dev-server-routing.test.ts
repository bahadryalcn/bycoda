import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const { handle, openBrowser } = vi.hoisted(() => ({ handle: vi.fn(), openBrowser: vi.fn() }));
vi.mock("./dev-servers", () => ({
  DevServersService: class {
    handle = handle;
  },
}));
vi.mock("./dev-server-browser", () => ({ openDevServerBrowser: openBrowser }));
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  vi.clearAllMocks();
});
async function host() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-dev-routing-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const project = await engine.openProject(directory);
  const token = (await store.issueDevice("Test desktop")).token;
  const server = await createHostServer(engine, []);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async (method: string, params: Record<string, unknown> = {}, credential = token) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: unknown; error?: string },
    };
  };
  return { call, project };
}
describe("development server host RPC", () => {
  it("advertises discovery capability", async () => {
    const { call } = await host();
    const response = await call("environment.describe");
    expect(response.value.result).toMatchObject({
      capabilities: expect.arrayContaining(["dev.servers"]),
    });
  });
  it("validates authentication and host project before process management", async () => {
    const { call, project } = await host();
    expect((await call("devServers.kill", { projectId: project.id }, "wrong")).status).toBe(401);
    const unknown = await call("devServers.stop", { projectId: "another-host-project" });
    expect(unknown.value.error).toContain("not registered");
    expect(handle).not.toHaveBeenCalled();
  });
  it.each(["list", "details", "start", "stop", "kill", "restart", "logs"])(
    "passes %s to this host's service with only this host's project paths",
    async (operation) => {
      handle.mockResolvedValue({ status: "ok" });
      const { call, project } = await host();
      const params = {
        projectId: project.id,
        id: "server",
        identity: { pid: 123, startedAt: "birth" },
      };
      const response = await call(`devServers.${operation}`, params);
      expect(response.value.error).toBeUndefined();
      expect(handle).toHaveBeenCalledWith(`devServers.${operation}`, params, [
        { id: project.id, name: project.name, path: project.cwd },
      ]);
    },
  );
  it("opens only an endpoint returned by fresh host process details", async () => {
    handle.mockResolvedValue({
      server: { endpoints: [{ port: 5173, url: "http://127.0.0.1:5173/" }] },
    });
    openBrowser.mockResolvedValue({ url: "http://127.0.0.1:5173/" });
    const { call, project } = await host();
    await call("devServers.openExternal", {
      projectId: project.id,
      id: "server",
      port: 5173,
      url: "file:///ignored",
    });
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:5173/");
    const missing = await call("devServers.openExternal", {
      projectId: project.id,
      id: "server",
      port: 9999,
    });
    expect(missing.value.error).toContain("no longer listening");
    expect(openBrowser).toHaveBeenCalledTimes(1);
  });
});
