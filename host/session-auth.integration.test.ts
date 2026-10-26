import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture() {
  const base = resolve("temp/test-results/session-auth");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "fixture-"));
  // Never consult the running desktop's databases or inherited tool credentials.
  for (const name of Object.keys(process.env))
    if (name.startsWith("BYCODA_")) vi.stubEnv(name, undefined);
  vi.stubEnv("BYCODA_DESKTOP_DB", join(dir, "desktop.db"));
  const desktop = new DatabaseSync(process.env.BYCODA_DESKTOP_DB!);
  desktop.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
  );
  desktop.close();
  const store = new HostStore(join(dir, "host.db"));
  cleanups.push(() => store.close());
  const project = await store.addProject(dir, "Authentication fixture");
  const unexpected = async () => {
    throw new Error("Provider effects are forbidden in this fixture");
  };
  const engine = new HostEngine(store, {
    codex: {
      send: unexpected,
      stop: unexpected,
      cancel: unexpected,
      bind() {},
      approve() {},
      answer() {},
    },
  });
  await engine.ready;
  cleanups.push(() => engine.close());
  const created = await engine.command({
    type: "create",
    commandId: randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "codex:fixture",
    runtimeMode: "supervised",
  });
  const server = await createHostServer(engine, []);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
    await server.closeResources();
  });
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = await store.issueDevice("Fixture owner");
  const grant = await server.conversationAccess.issueSessionGrant(created.sessionId);
  const rpc = async (token: string, method: string, params = {}) => {
    const response = await fetch(`${endpoint}/rpc`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: HOST_PROTOCOL_VERSION,
        environmentId: store.environmentId,
        method,
        params,
      }),
    });
    return {
      status: response.status,
      stage: response.headers.get("X-Bycoda-Auth-Stage"),
      body: await response.json(),
    };
  };
  return { store, server, owner, grant, rpc, sessionId: created.sessionId };
}

it("keeps unrelated owner RPCs responsive while scoped identity preparation waits", async () => {
  const s = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const preparing = new Promise<void>((done) => {
    entered = done;
  });
  s.server.social.setSessionAuthorityResolver({
    async prepare() {
      entered();
      await gate;
    },
    async current(id) {
      const identity = await s.store.sessionAuthority(id);
      if (!identity) throw new Error("Fixture session missing");
      return identity;
    },
  });
  let scopedFinished = false;
  const scoped = s
    .rpc(s.grant.token, "conversation.tools.call", { action: "resources.read", input: {} })
    .finally(() => {
      scopedFinished = true;
    });
  try {
    await preparing;
    // This reaches the actual HTTP server and real SQLite actor. The scoped
    // request remains blocked deliberately; no timing threshold claims speedup.
    const ownerRead = await s.rpc(s.owner.token, "projects.list");
    expect(ownerRead.status).toBe(200);
    expect(scopedFinished).toBe(false);
  } finally {
    release();
  }
  expect((await scoped).status).toBe(200);
});

it("labels only initial authentication rejection as safe for credential renewal", async () => {
  const s = await fixture();
  const rejected = await s.rpc("A".repeat(43), "projects.list");
  expect(rejected.status).toBe(401);
  expect(rejected.stage).toBe("before-dispatch");
  // A later authorization failure may follow work. The conservative response
  // must never advertise that repeating the original request is safe.
  vi.spyOn(s.server.conversationAccess, "authorization").mockReturnValue(() => false);
  const late = await s.rpc(s.grant.token, "conversation.tools.call", {
    action: "resources.read",
    input: {},
  });
  expect(late.status).toBe(401);
  expect(late.stage).toBeNull();
});
