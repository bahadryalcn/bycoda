import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import { applySessionSync, type HostSession } from "../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<void>> = [];
const closedHosts = new WeakSet<object>();
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function openHost(directory: string, send: (input: SendTurnInput) => void) {
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async (input) => send(input),
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const server = createHostServer(engine, ["codex"] as RemoteProvider[]);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const token = store.issueDevice("validation client").token;
  const secondToken = store.issueDevice("second validation client").token;
  return { store, engine, server, url, token, secondToken };
}

async function closeHost(current: Awaited<ReturnType<typeof openHost>>) {
  if (closedHosts.has(current)) return;
  closedHosts.add(current);
  await current.engine.close();
  current.server.closeAllConnections();
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
  current.store.close();
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-remote-performance-"));
  let turn: SendTurnInput | undefined;
  let finish!: () => void;
  const send = vi.fn((input: SendTurnInput) => {
    turn = input;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const host = await openHost(directory, send);
  const project = await host.engine.openProject(directory);
  const call = async (
    method: string,
    params: unknown = {},
    token = host.token,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(host.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: host.store.environmentId, method, params }),
      signal,
    });
    const value = (await response.json()) as { result?: any; error?: string };
    return { status: response.status, value };
  };
  cleanups.push(async () => {
    await closeHost(host);
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    ...host,
    directory,
    project,
    call,
    close: () => closeHost(host),
    send,
    turn: () => turn!,
    finish: () => finish(),
  };
}

it("shares bounded machine change cursors, detects restart, and requires device auth", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "change-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const initial = await s.call("machine.changes", {
    sessions: [{ sessionId: created.sessionId, revision: 0 }],
    projects: [{ projectId: s.project.id }],
  });
  expect(initial.status).toBe(200);
  expect(initial.value.result).toMatchObject({
    reset: true,
    sessions: [{ sessionId: created.sessionId, revision: created.revision }],
  });
  const value = initial.value.result;
  const unchanged = await s.call("machine.changes", {
    instanceId: value.instanceId,
    sessions: [{ sessionId: created.sessionId, revision: created.revision }],
    projects: [{ projectId: s.project.id, known: value.projects[0].etag }],
    waitMs: 0,
  });
  expect(unchanged.value.result).toMatchObject({ reset: false, sessions: [], projects: [] });
  expect(
    (
      await s.call(
        "machine.changes",
        { instanceId: value.instanceId, sessions: [], projects: [] },
        "bad-token",
      )
    ).status,
  ).toBe(401);
  const oversized = await s.call("machine.changes", {
    sessions: Array.from({ length: 65 }, (_, i) => ({ sessionId: `s${i}`, revision: 0 })),
    projects: [],
  });
  expect(oversized.status).toBe(400);

  await s.close();
  const restarted = await openHost(s.directory, vi.fn());
  const response = await fetch(restarted.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${restarted.token}` },
    body: JSON.stringify({
      version: 1,
      environmentId: restarted.store.environmentId,
      method: "machine.changes",
      params: {
        instanceId: value.instanceId,
        sessions: [{ sessionId: created.sessionId, revision: created.revision }],
        projects: [],
      },
    }),
  });
  expect(((await response.json()) as any).result).toMatchObject({ reset: true });
  await closeHost(restarted);
});

it("serves an actual tail page and partial delta without shipping unloaded transcript blocks", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "page-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const initial = s.store.session(created.sessionId);
  const blocks = Array.from({ length: 180 }, (_, index) => ({
    id: `history-${index}`,
    role: "assistant" as const,
    text: `turn ${index}`,
  }));
  s.store.transaction(() =>
    s.store.save(
      { ...initial, revision: initial.revision + 1, session: { ...initial.session, blocks } },
      { type: "fixture" },
    ),
  );
  const pageResponse = await s.call("sessions.page", { sessionId: created.sessionId });
  const page = pageResponse.value.result;
  expect(page.totalBlocks).toBe(180);
  expect(page.before).toBeDefined();
  const known: HostSession = {
    ...page.sync.value,
    history: { before: page.before, revision: page.revision, totalBlocks: page.totalBlocks },
  };
  expect(known.session.blocks.length).toBeLessThanOrEqual(100);

  const latest = s.store.session(created.sessionId);
  const changedBlocks = latest.session.blocks.map((block) =>
    block.id === "history-179" ? { ...block, text: "changed tail" } : block,
  );
  s.store.transaction(() =>
    s.store.save(
      {
        ...latest,
        revision: latest.revision + 1,
        session: { ...latest.session, blocks: changedBlocks },
      },
      { type: "fixture-update" },
    ),
  );
  const update = await s.call("sessions.sync", {
    sessionId: created.sessionId,
    revision: known.revision,
    partial: true,
    loadedBlockIds: known.session.blocks.map((block) => block.id),
    windowStart: known.history!.before,
  });
  const sync = update.value.result;
  expect(sync.kind).toBe("delta");
  expect(sync.partial).toBe(true);
  expect(sync.blockIds.length).toBeLessThanOrEqual(100);
  expect(sync.blocks.map((block: { id: string }) => block.id)).toEqual(["history-179"]);
  const applied = applySessionSync(known, sync);
  expect(applied.revision).toBe(latest.revision + 1);
  expect(applied.history?.totalBlocks).toBe(180);
  expect(applied.session.blocks.at(-1)?.text).toBe("changed tail");
  expect(JSON.stringify(sync)).not.toContain("turn 0");
});

it("keeps pinned history coherent through a live append, deletion, and host restart", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "combined-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const initial = s.store.session(created.sessionId);
  const blocks = Array.from({ length: 150 }, (_, index) => ({
    id: `pinned-${index}`,
    role: "assistant" as const,
    text: `message ${index}`,
  }));
  s.store.transaction(() =>
    s.store.save(
      { ...initial, revision: initial.revision + 1, session: { ...initial.session, blocks } },
      { type: "fixture" },
    ),
  );
  const page = (await s.call("sessions.page", { sessionId: created.sessionId })).value.result;
  const known: HostSession = {
    ...page.sync.value,
    history: { before: page.before, revision: page.revision, totalBlocks: page.totalBlocks },
  };
  const epoch = (
    await s.call("machine.changes", {
      sessions: [{ sessionId: created.sessionId, revision: known.revision }],
      projects: [],
    })
  ).value.result.instanceId;
  const waiting = s.call("machine.changes", {
    instanceId: epoch,
    sessions: [{ sessionId: created.sessionId, revision: known.revision }],
    projects: [],
    waitMs: 5_000,
  });

  const current = s.store.session(created.sessionId);
  s.store.transaction(() =>
    s.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: {
          ...current.session,
          blocks: [
            ...current.session.blocks,
            { id: "live-message", role: "assistant", text: "arrived during paging" },
          ],
        },
      },
      { type: "live-fixture" },
    ),
  );
  const notice = await waiting;
  expect(notice.value.result.sessions).toEqual([
    { sessionId: created.sessionId, revision: current.revision + 1 },
  ]);
  const sync = (
    await s.call("sessions.sync", {
      sessionId: created.sessionId,
      revision: known.revision,
      partial: true,
      loadedBlockIds: known.session.blocks.map((block) => block.id),
      windowStart: known.history!.before,
    })
  ).value.result;
  const updated = applySessionSync(known, sync);
  expect(updated.session.blocks.at(-1)?.text).toBe("arrived during paging");
  expect(updated.history?.totalBlocks).toBe(151);
  const earlier = (
    await s.call("sessions.page", {
      sessionId: created.sessionId,
      before: known.history!.before,
      revision: known.revision,
    })
  ).value.result;
  expect(earlier.revision).toBe(known.revision);
  expect(earlier.sync.value.session.blocks.map((block: { id: string }) => block.id)).toEqual(
    blocks.slice(0, page.before).map((block) => block.id),
  );

  expect(
    (await s.call("sessions.delete", { sessionId: created.sessionId, projectId: s.project.id }))
      .status,
  ).toBe(200);
  const deleted = await s.call("machine.changes", {
    instanceId: epoch,
    sessions: [{ sessionId: created.sessionId, revision: updated.revision }],
    projects: [],
    waitMs: 2_000,
  });
  expect(deleted.value.result.sessions).toEqual([
    { sessionId: created.sessionId, revision: updated.revision, deleted: true },
  ]);

  await s.close();
  const restarted = await openHost(s.directory, vi.fn());
  const afterRestart = await fetch(restarted.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${restarted.token}` },
    body: JSON.stringify({
      version: 1,
      environmentId: restarted.store.environmentId,
      method: "machine.changes",
      params: {
        instanceId: epoch,
        sessions: [{ sessionId: created.sessionId, revision: updated.revision }],
        projects: [],
      },
    }),
  });
  expect(((await afterRestart.json()) as any).result).toMatchObject({
    reset: true,
    sessions: [{ sessionId: created.sessionId, deleted: true }],
  });
  await closeHost(restarted);
});

it("replays the durable receipt after a lost response or host restart without starting a second turn", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "receipt-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const command = {
    type: "send",
    commandId: "receipt-send",
    sessionId: created.sessionId,
    text: "single execution",
  };
  const accepted = await s.call("commands.dispatch", command);
  expect(accepted.status).toBe(200);
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
  const racingClient = await s.call(
    "commands.dispatch",
    { ...command, commandId: "receipt-racing-send", text: "second client races" },
    s.secondToken,
  );
  expect(racingClient.status).toBe(400);
  expect(s.send).toHaveBeenCalledTimes(1);
  const replay = await s.call("commands.dispatch", command, s.secondToken);
  expect(replay).toEqual(accepted);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect((await s.call("commands.dispatch", { ...command, text: "changed payload" })).status).toBe(
    400,
  );
  s.finish();
  await vi.waitFor(() => expect(s.store.session(created.sessionId).status).toBe("idle"));
  await s.close(s);
  const afterRestart = await openHost(s.directory, vi.fn());
  const response = await fetch(afterRestart.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${afterRestart.token}` },
    body: JSON.stringify({
      version: 1,
      environmentId: afterRestart.store.environmentId,
      method: "commands.dispatch",
      params: command,
    }),
  });
  expect(response.status).toBe(200);
  const durableReplay = await response.json();
  expect(durableReplay.result).toEqual(accepted.value.result);
  expect(afterRestart.store.session(created.sessionId).status).toBe("idle");
  await closeHost(afterRestart);
});

it("keeps each loopback host authoritative and usable when the other host disconnects", async () => {
  const directoryA = mkdtempSync(join(tmpdir(), "bycoda-owner-a-"));
  const directoryB = mkdtempSync(join(tmpdir(), "bycoda-owner-b-"));
  let finishA!: () => void;
  let finishB!: () => void;
  const sendA = vi.fn(
    (_input: SendTurnInput) =>
      new Promise<void>((resolve) => {
        finishA = resolve;
      }),
  );
  const sendB = vi.fn(
    (_input: SendTurnInput) =>
      new Promise<void>((resolve) => {
        finishB = resolve;
      }),
  );
  const hostA = await openHost(directoryA, sendA);
  const hostB = await openHost(directoryB, sendB);
  cleanups.push(async () => {
    await closeHost(hostA);
    await closeHost(hostB);
    rmSync(directoryA, { recursive: true, force: true });
    rmSync(directoryB, { recursive: true, force: true });
  });
  const projectA = await hostA.engine.openProject(directoryA);
  const projectB = await hostB.engine.openProject(directoryB);
  const sessionA = hostA.engine.command({
    type: "create",
    commandId: "owner-a-create",
    projectId: projectA.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const sessionB = hostB.engine.command({
    type: "create",
    commandId: "owner-b-create",
    projectId: projectB.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const rpc = async (
    host: Awaited<ReturnType<typeof openHost>>,
    method: string,
    params: unknown,
    token = host.token,
  ) => {
    const response = await fetch(host.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: host.store.environmentId, method, params }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  const readA = await rpc(hostA, "sessions.sync", { sessionId: sessionA.sessionId });
  const readB = await rpc(hostB, "sessions.sync", { sessionId: sessionB.sessionId });
  expect(readA.value.result.value.projectId).toBe(projectA.id);
  expect(readB.value.result.value.projectId).toBe(projectB.id);
  const sentA = await rpc(hostA, "commands.dispatch", {
    type: "send",
    commandId: "owner-a-send",
    sessionId: sessionA.sessionId,
    text: "owner a",
  });
  const sentB = await rpc(hostB, "commands.dispatch", {
    type: "send",
    commandId: "owner-b-send",
    sessionId: sessionB.sessionId,
    text: "owner b",
  });
  expect(sentA.status).toBe(200);
  expect(sentB.status).toBe(200);
  await vi.waitFor(() => {
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledTimes(1);
  });
  finishA();
  finishB();
  await vi.waitFor(() => {
    expect(hostA.store.session(sessionA.sessionId).status).toBe("idle");
    expect(hostB.store.session(sessionB.sessionId).status).toBe("idle");
  });

  await closeHost(hostA);
  const stillOwnedByB = await rpc(
    hostB,
    "commands.dispatch",
    {
      type: "send",
      commandId: "owner-b-after-a-close",
      sessionId: sessionB.sessionId,
      text: "host b continues",
    },
    hostB.secondToken,
  );
  expect(stillOwnedByB.status).toBe(200);
  await vi.waitFor(() => expect(sendB).toHaveBeenCalledTimes(2));
  finishB();
  await vi.waitFor(() => expect(hostB.store.session(sessionB.sessionId).status).toBe("idle"));
});

it("releases a disconnected long poll without blocking the command lane", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "cancel-poll-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const initial = await s.call("machine.changes", {
    sessions: [{ sessionId: created.sessionId, revision: created.revision }],
    projects: [],
  });
  const controller = new AbortController();
  const waiting = s.call(
    "machine.changes",
    {
      instanceId: initial.value.result.instanceId,
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [],
      waitMs: 10_000,
    },
    s.token,
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 75));
  controller.abort();
  await expect(waiting).rejects.toThrow();
  const sent = await s.call("commands.dispatch", {
    type: "send",
    commandId: "after-cancel-send",
    sessionId: created.sessionId,
    text: "still available",
  });
  expect(sent.status).toBe(200);
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
  s.finish();
});

it("wakes machine readers on store writes and inlines only bounded opted-in deltas", async () => {
  const s = await setup();
  const created = s.engine.command({
    type: "create",
    commandId: "inline-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const known = s.store.session(created.sessionId);
  const initial = (
    await s.call("machine.changes", {
      sessions: [{ sessionId: created.sessionId, revision: known.revision }],
      projects: [],
    })
  ).value.result;
  const params = {
    instanceId: initial.instanceId,
    sessions: [{ sessionId: created.sessionId, revision: known.revision }],
    projects: [],
    inlineSync: true,
    waitMs: 5000,
  };
  const pending = s.call("machine.changes", params);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const started = performance.now();
  s.store.transaction(() =>
    s.store.save(
      {
        ...known,
        revision: known.revision + 1,
        session: {
          ...known.session,
          blocks: [{ id: "inline-block", role: "assistant", text: "inline text" }],
        },
      },
      { type: "fixture" },
    ),
  );
  // Host-created sessions also have a desktop mirror; that is not ownership.
  expect(s.store.sessionStateMetadata(created.sessionId)?.desktop).toBe(true);
  expect(s.store.sync(created.sessionId, known.revision).kind).toBe("delta");
  const changed = (await pending).value.result;
  expect(changed.reset).toBe(false);
  expect(performance.now() - started).toBeLessThan(500);
  expect(changed.sessions[0].sync).toMatchObject({ kind: "delta", base: known.revision });
  expect(applySessionSync(known, changed.sessions[0].sync).session.blocks[0].text).toBe(
    "inline text",
  );
  const legacy = (await s.call("machine.changes", { ...params, inlineSync: false, waitMs: 0 }))
    .value.result;
  expect(legacy.sessions[0].sync).toBeUndefined();
  const small = s.store.session(created.sessionId);
  s.store.transaction(() =>
    s.store.save(
      {
        ...small,
        revision: small.revision + 1,
        session: {
          ...small.session,
          blocks: [{ id: "inline-block", role: "assistant", text: "x".repeat(70000) }],
        },
      },
      { type: "fixture" },
    ),
  );
  const large = (await s.call("machine.changes", { ...params, waitMs: 0 })).value.result;
  expect(large.sessions[0].sync).toBeUndefined();
});
