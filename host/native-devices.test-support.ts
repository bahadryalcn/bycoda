import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import { DeviceHost } from "./device-host";
import * as deviceProcesses from "./device-process";
import {
  HOST_SCHEMA_VERSION,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
} from "../src/shared/model/host-contracts";

const probe = vi.hoisted(() => vi.fn());
vi.mock("../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: probe,
  refreshCodexCatalog: async () => {},
}));
vi.mock("./provider-accounts", async (original) => {
  const module = await original<typeof import("./provider-accounts")>();
  return { ...module, hostProviderAccounts: () => module.hostProviderAccounts([]) };
});
// Fixture-only credentials; never touch the OS vault or developer profile.
vi.mock("./social-credentials", () => ({
  OsSocialCredentials: class {
    private values = new Map<string, unknown>();
    async get(id: string) {
      return this.values.get(id);
    }
    async set(id: string, value: unknown) {
      this.values.set(id, value);
    }
    async delete(id: string) {
      this.values.delete(id);
    }
  },
}));
vi.mock("./expo-go", async (original) => ({
  ...(await original<typeof import("./expo-go")>()),
  expoManifest: async () => ({ sdkVersion: "53.0.0" }),
}));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
export const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function fixture(evidenceId = "2026-10-29-paired-device-host") {
  probe.mockResolvedValue([]);
  const base = resolve(`temp/verification/${evidenceId}/fixtures`);
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "host-")),
    projectPath = join(root, "project");
  await mkdir(projectPath);
  const sdk = join(root, "sdk");
  await mkdir(join(sdk, "platform-tools"), { recursive: true });
  await writeFile(join(sdk, "platform-tools", "adb.exe"), "fixture, never executed");
  vi.spyOn(DeviceHost.prototype as any, "platform", "get").mockReturnValue("win32");
  vi.spyOn(DeviceHost.prototype as any, "env", "get").mockReturnValue({ ANDROID_HOME: sdk });
  vi.spyOn(DeviceHost.prototype as any, "installed").mockResolvedValue(true);
  const xml = '<?xml version="1.0"?><hierarchy>' + '\\"'.repeat(240000) + "</hierarchy>";
  const png = Buffer.alloc(4 * 1024 * 1024, 17);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  const command = vi
    .spyOn(deviceProcesses, "deviceCommand")
    .mockImplementation(async (_exe, args) => {
      if (args[0] === "devices")
        return "List of devices attached\nemulator-5554 device model:Pixel\n";
      if (args.includes("emu")) return "Pixel\nOK";
      if (args.includes("cat")) return xml;
      if (args.includes("resolve-activity")) return "host.exp.exponent/.MainActivity";
      return "";
    });
  const binary = vi.spyOn(deviceProcesses, "deviceBinaryCommand").mockResolvedValue(png);
  const store = new HostStore(join(root, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(projectPath);
  const server = await createHostServer(engine, ["codex"]);
  const clients: WebSocket[] = [];
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe fixture path");
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    device = await store.issueDevice("Fixture owner"),
    other = await store.issueDevice("Fixture other");
  const http = async (
    method: string,
    params: unknown = {},
    token = device.token,
    environmentId = store.environmentId,
  ) => {
    const response = await fetch(`${endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId, method, params }),
    }).catch((cause) => {
      throw new Error(`HTTP ${method}`, { cause });
    });
    return {
      status: response.status,
      ...((await response.json()) as {
        result?: any;
        error?: string;
        delivery?: string;
        code?: string;
      }),
    };
  };
  const callHttp = async (method: string, params: unknown = {}) => {
    const value = await http(method, params);
    expect(value.error, method).toBeUndefined();
    expect(value.status).toBe(200);
    return value.result;
  };
  const decode = async (result: any, token: string) => {
    if (!result?.$bulk) return result;
    const descriptor = result.$bulk,
      chunks: Buffer[] = [];
    for (let offset = 0; offset < descriptor.totalBytes; offset += descriptor.chunkBytes) {
      const response = await fetch(
        `${endpoint}/ws-bulk/${descriptor.transferId}?offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.status, `bulk ${offset}/${descriptor.totalBytes}`).toBe(200);
      chunks.push(Buffer.from(await response.arrayBuffer()));
    }
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(descriptor.totalBytes);
    expect(sha(bytes)).toBe(descriptor.sha256);
    return JSON.parse(bytes.toString());
  };
  const connect = async (token = device.token) => {
    const socket = new WebSocket(endpoint.replace("http:", "ws:") + "/ws", WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    clients.push(socket);
    const pending = new Map<
      string,
      {
        resolve(value: any): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    socket.on("message", (data) => {
      const value = JSON.parse(data.toString()),
        waiter = pending.get(value.id);
      if (waiter) {
        pending.delete(value.id);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const value of pending.values()) {
        clearTimeout(value.timer);
        value.reject(new Error("Closed"));
      }
      pending.clear();
    });
    await new Promise<void>((done, reject) => {
      socket.once("open", done);
      socket.once("error", reject);
    });
    const request = (method: string, params: unknown = {}, id = randomUUID()) =>
      new Promise<any>((done, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Missing ${method}`));
        }, 35000);
        pending.set(id, { resolve: done, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    const hello = await request("connection.hello", {
      environmentId: store.environmentId,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "native-fixture",
      clientKind: "desktop",
    });
    expect(hello.error, `Hello failed: ${JSON.stringify(hello.error)}`).toBeUndefined();
    expect(hello.result.capabilities).toEqual(expect.arrayContaining(["transport.ws.devices.v1"]));
    const call = async (method: string, params: unknown = {}) => {
      const response = await request(method, params);
      expect(response.error, `${method}: ${JSON.stringify(response.error)}`).toBeUndefined();
      return decode(response.result, token);
    };
    return { socket, request, call };
  };
  return {
    root,
    command,
    binary,
    png,
    xml,
    projectPath,
    store,
    engine,
    project,
    device,
    other,
    endpoint,
    http,
    callHttp,
    connect,
    decode,
  };
}
