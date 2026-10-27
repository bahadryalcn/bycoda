import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import * as models from "../src/features/sessions/model/models";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "bycoda-engine-storage-"));
  const target = resolve(folder);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("bycoda-engine-storage-"))
    throw new Error("Unexpected fixture directory");
  cleanups.push(() => rm(target, { recursive: true, force: true }));
  const store = new HostStore(join(folder, "host.db"));
  cleanups.push(() => store.close());
  const provider: HostProvider = {
    send: vi.fn(async () => {}), cancel: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(),
  };
  const providerLookup = vi.fn(() => provider);
  const providers: Partial<Record<RemoteProvider, HostProvider>> = {
    get codex() { return providerLookup(); },
  };
  const shell = vi.fn(async () => ({ output: "", exitCode: 0, timedOut: false }));
  const engine = new HostEngine(store, providers, shell);
  cleanups.push(() => engine.close());
  await engine.ready;
  const project = await engine.openProject(folder);
  const create = {
    type: "create", commandId: "seed", projectId: project.id,
    workspaceMode: "current", harness: "codex", model: "codex:test", runtimeMode: "supervised",
  };
  const seed = await engine.command(create);
  const modelMembership = vi.spyOn(models, "modelBelongsToHarness");
  const modelResolution = vi.spyOn(models, "resolveModel");
  providerLookup.mockClear();
  return { store, engine, provider, providerLookup, modelMembership, modelResolution, shell, create, seed };
}

/** Exercise the SQLite worker's actual SQLITE_FULL response, not a mocked health state. */
async function fillDatabase(store: HostStore): Promise<void> {
  await store.db.exec("CREATE TABLE storage_full_fixture (value BLOB)");
  const pages = Number(Object.values((await store.db.prepare("PRAGMA page_count").get())!)[0]);
  await store.db.exec(`PRAGMA max_page_count=${pages}`);
  await expect(store.db.prepare("INSERT INTO storage_full_fixture VALUES (zeroblob(1048576))").run())
    .rejects.toMatchObject({ errcode: 13 });
  expect(store.db.persistenceHealth()).toEqual({ state: "temporarily-blocked", reason: "full" });
}

describe("engine persistence admission", () => {
  it.each(["send", "create"] as const)("rejects %s after real SQLITE_FULL before provider/model lookup or launch", async type => {
    const { engine, store, provider, providerLookup, modelMembership, modelResolution, shell, create, seed } = await fixture();
    const before = await store.session(seed.sessionId);
    await fillDatabase(store);
    const command = type === "create"
      ? { ...create, commandId: "blocked-create", model: "claude:wrong-provider" }
      : { type: "send", commandId: "blocked-send", sessionId: seed.sessionId, text: "must not launch" };
    await expect(engine.command(command)).rejects.toMatchObject({
      code: "HOST_PERSISTENCE_UNAVAILABLE", health: { state: "temporarily-blocked", reason: "full" },
    });
    expect(providerLookup).not.toHaveBeenCalled();
    expect(modelMembership).not.toHaveBeenCalled();
    expect(modelResolution).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    expect(await store.session(seed.sessionId)).toEqual(before);
    expect(await store.receiptStatus(command.commandId)).toBeUndefined();
    expect(await store.projects()).toHaveLength(1);
  });

  it("requires an explicit successful recovery probe even when SQLite capacity is restored", async () => {
    const { engine, store, providerLookup, modelMembership, create } = await fixture();
    await fillDatabase(store);
    await store.db.exec("PRAGMA max_page_count=2147483646");
    await expect(engine.command({ ...create, commandId: "still-blocked" }))
      .rejects.toMatchObject({ code: "HOST_PERSISTENCE_UNAVAILABLE" });
    expect(providerLookup).not.toHaveBeenCalled();
    expect(modelMembership).not.toHaveBeenCalled();
    await store.db.recoverPersistence();
    const receipt = await engine.command({ ...create, commandId: "recovered-create" });
    expect(store.db.persistenceHealth()).toEqual({ state: "ready" });
    expect(await store.receiptStatus("recovered-create")).toEqual(receipt);
    // Also prove the lookup spies observe normal admission once the gate opens.
    expect(providerLookup).toHaveBeenCalled();
    expect(modelMembership).toHaveBeenCalled();
  });

  it("rechecks storage immediately before a deferred accepted provider effect launches", async () => {
    const { engine, store, provider, providerLookup, modelResolution, seed } = await fixture();
    let deferred: (() => void | Promise<void>) | undefined;
    // Hold the scheduling boundary after the real durable receipt has committed.
    vi.spyOn(store, "afterCommit").mockImplementation(effect => { deferred = effect; });
    const receipt = await engine.command({
      type: "send", commandId: "accepted-before-full", sessionId: seed.sessionId, text: "hold before launch",
    });
    expect(await store.receiptStatus(receipt.commandId)).toEqual(receipt);
    expect(deferred).toBeTypeOf("function");
    expect(provider.send).not.toHaveBeenCalled();
    providerLookup.mockClear();
    modelResolution.mockClear();
    await fillDatabase(store);
    await expect(Promise.resolve().then(() => deferred!()))
      .rejects.toMatchObject({ code: "HOST_PERSISTENCE_UNAVAILABLE" });
    expect(providerLookup).not.toHaveBeenCalled();
    expect(modelResolution).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    // Lost launch readiness does not erase an already durable acceptance receipt.
    expect(await store.receiptStatus(receipt.commandId)).toEqual(receipt);
  });
});
