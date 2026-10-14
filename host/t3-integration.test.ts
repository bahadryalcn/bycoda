import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(controlOrigin?: string) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-t3-integration-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: vi.fn(async () => {}),
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const oldOrigin = process.env.BYCODA_WEB_CONTROL_ORIGIN;
  if (controlOrigin) process.env.BYCODA_WEB_CONTROL_ORIGIN = controlOrigin;
  else delete process.env.BYCODA_WEB_CONTROL_ORIGIN;
  let server: ReturnType<typeof createHostServer>;
  try {
    server = createHostServer(engine, ["codex"]);
  } finally {
    if (oldOrigin === undefined) delete process.env.BYCODA_WEB_CONTROL_ORIGIN;
    else process.env.BYCODA_WEB_CONTROL_ORIGIN = oldOrigin;
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const first = store.issueDevice("First");
  const second = store.issueDevice("Second");
  async function http(
    path: string,
    method: "POST" | "GET",
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    const text = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{
      status: number;
      body: string;
      headers: import("node:http").IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            ...(text ? { "Content-Length": String(Buffer.byteLength(text)) } : {}),
            ...headers,
          },
        },
        (res) => {
          let output = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            output += chunk;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: output, headers: res.headers }),
          );
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  }
  async function call(
    method: string,
    params: unknown = {},
    token = first.token,
    path = "/rpc",
    headers: Record<string, string> = {},
  ) {
    const res = await http(
      path,
      "POST",
      { Authorization: `Bearer ${token}`, ...headers },
      { version: 1, environmentId: store.environmentId, method, params },
    );
    return { ...res, value: JSON.parse(res.body) as { result?: any; error?: string } };
  }
  function createSession(projectId = project.id) {
    return engine.command({
      type: "create",
      commandId: randomUUID(),
      projectId,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    }).sessionId!;
  }
  cleanups.push(async () => {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, project, engine, store, first, second, http, call, createSession };
}

describe("T3 adoption authenticated host integration", () => {
  it("authenticates diagnostics and shares browser view without transferring device control", async () => {
    const s = await setup();
    for (const method of ["resources.read", "browser.status"]) {
      expect((await s.call(method, {}, "invalid")).status).toBe(401);
      expect((await s.call(method)).status).toBe(200);
    }
    const resources = (await s.call("resources.read")).value.result;
    expect(resources.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          process: expect.objectContaining({ pid: process.pid, rssBytes: expect.any(Number) }),
        }),
      ]),
    );
    expect(JSON.stringify(resources)).not.toContain(s.first.token);
    const claimed = (await s.call("browser.claim")).value.result;
    expect(claimed).toMatchObject({ open: false, controlling: true, leaseId: expect.any(String) });
    const observed = (await s.call("browser.status", {}, s.second.token)).value.result;
    expect(observed).toMatchObject({ open: false, controlling: false });
    expect(observed.leaseId).toBeUndefined();
    expect(
      (await s.call("browser.release", { leaseId: claimed.leaseId }, s.second.token)).status,
    ).toBe(400);
    expect((await s.call("browser.status")).value.result.controlling).toBe(true);
    expect(
      (await s.call("browser.release", { leaseId: claimed.leaseId })).value.result.controlling,
    ).toBe(false);
  });

  it("separates native RPC and explicitly configured web origin while keeping bearer authentication", async () => {
    const origin = "https://bycoda.example.test";
    const s = await setup(origin);
    const headers = {
      Host: "bycoda.example.test",
      Origin: origin,
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    };
    const page = await s.http("/control", "GET", { Host: "bycoda.example.test" });
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body).not.toContain(s.first.token);
    expect((await s.http("/control", "GET", { Host: "attacker.example.test" })).status).toBe(403);
    expect(
      (await s.call("browser.status", {}, s.first.token, "/control/rpc", headers)).status,
    ).toBe(200);
    expect((await s.call("browser.status", {}, "invalid", "/control/rpc", headers)).status).toBe(
      401,
    );
    expect((await s.call("browser.status", {}, s.first.token, "/rpc", headers)).status).toBe(403);
    expect(
      (
        await s.call("browser.status", {}, s.first.token, "/control/rpc", {
          ...headers,
          Origin: "https://evil.example.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call("browser.status", {}, s.first.token, "/control/rpc", {
          ...headers,
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call("browser.status", {}, s.first.token, "/control/rpc", {
          ...headers,
          Host: "evil.example.test",
        })
      ).status,
    ).toBe(403);
    expect((await s.call("browser.status")).status).toBe(200);
  });
});
