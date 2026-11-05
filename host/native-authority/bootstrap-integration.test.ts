import { afterEach, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { DesktopSessions } from "../desktop/desktopSessions";
import { createHostServer, type HostPrivateControlHandler } from "../server";
import { createNativeAuthorityBootstrap, NATIVE_AUTHORITY_BOOTSTRAP_PATH } from "./bootstrap";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(legacy = false) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-native-bootstrap-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  await engine.ready;
  const secret = randomBytes(32).toString("base64url");
  const bootstrap = createNativeAuthorityBootstrap({
    secret,
    environmentId: store.environmentId,
  });
  let observedBootstrap!: () => void;
  const bootstrapReceived = new Promise<void>((resolve) => {
    observedBootstrap = resolve;
  });
  const routedBootstrap = Object.assign(
    (...args: Parameters<typeof bootstrap>) => {
      bootstrap(...args);
      observedBootstrap();
    },
    { close: () => bootstrap.close() },
  );
  const lifecycle: HostPrivateControlHandler = (_request, response) => {
    response.end('{"legacyLifecycle":true}');
  };
  const server = await createHostServer(
    engine,
    [],
    legacy ? lifecycle : { lifecycle, nativeAuthorityBootstrap: routedBootstrap },
    undefined,
    undefined,
    new DesktopSessions(() => []),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await server.closeResources();
    bootstrap.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await engine.close();
    await store.close();
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-native-bootstrap-")
    )
      throw new Error("Unexpected bootstrap fixture cleanup path");
    rmSync(target, { recursive: true, force: true });
  });
  return { server, store, secret, base, bootstrapReceived };
}

it("composes private bootstrap with actual Host identity without granting paired or public authority", async () => {
  const f = await fixture();
  const device = await f.store.issueDevice("Fixture");
  const call = (token: string) =>
    fetch(f.base + NATIVE_AUTHORITY_BOOTSTRAP_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: '{"version":1,"action":"describe"}',
    });
  expect((await call(device.token)).status).toBe(403);
  const response = await call(f.secret);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    version: 1,
    environmentId: f.store.environmentId,
    qualified: false,
  });
  const lifecycle = await fetch(f.base + "/lifecycle", { method: "POST" });
  expect(await lifecycle.json()).toEqual({ legacyLifecycle: true });
});

it("keeps the existing function-form lifecycle composition compatible", async () => {
  const f = await fixture(true);
  expect(await (await fetch(f.base + "/lifecycle", { method: "POST" })).json()).toEqual({
    legacyLifecycle: true,
  });
  expect(
    (await fetch(f.base + NATIVE_AUTHORITY_BOOTSTRAP_PATH, { method: "POST" })).status,
  ).not.toBe(200);
});

it("closes an actually admitted incomplete bootstrap through full server resource shutdown", async () => {
  const f = await fixture();
  const req = request(f.base + NATIVE_AUTHORITY_BOOTSTRAP_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${f.secret}` },
  });
  const result = new Promise<number>((resolve, reject) => {
    req.once("error", reject);
    req.once("response", (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode!));
      response.once("error", reject);
    });
  });
  req.write("{");
  await f.bootstrapReceived;
  await f.server.closeResources();
  expect(await result).toBe(503);
  req.end();
});
