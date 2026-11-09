import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostEngine, parseCommand, type ManagedTurnHistoryAdapter } from "./engine";
import { HostStore } from "./store";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-engine-authority-")),
    store = new HostStore(join(root, "host.db"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const value: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "migrated",
      cwd: root,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Protected",
      blocks: [],
    },
  };
  await store.save({ ...value, revision: 0 }, {});
  await store.transaction(async () => {
    await store.db
      .prepare("INSERT INTO host_authority_heads VALUES(?,?,?,?,?)")
      .run(store.environmentId, "migrated", 2, "fixture-migration", "host-active");
    await store.withAuthorityGeneration("migrated", 2, () => store.save(value, {}));
  });
  const turn = gate();
  let input: SendTurnInput | undefined;
  const provider = {
    send: vi.fn(async (next: SendTurnInput) => {
      input = next;
      await turn.promise;
    }),
    stop: vi.fn(async () => {
      turn.resolve();
    }),
    cancel: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  await engine.ready;
  cleanups.push(async () => {
    // Synthetic tests may advance a floor while a provider is paused. Restore the
    // fixture's trusted floor before shutdown; never emulate this on live data.
    await store.db.exec("PRAGMA max_page_count=2147483646").catch(() => undefined);
    if (store.db.persistenceHealth().state === "temporarily-blocked")
      await store.db.recoverPersistence();
    await store.db
      .prepare("UPDATE host_authority_heads SET generation=2 WHERE session_id='migrated'")
      .run();
    turn.resolve();
    await engine.close().catch(() => undefined);
  });
  const send = {
    type: "send",
    commandId: "send",
    sessionId: "migrated",
    text: "hello",
    authorityGeneration: 2,
  };
  return { engine, store, provider, turn, send, input: () => input };
}

it("preserves validated generation metadata on every parsed command and rejects unsafe counters", () => {
  const command = {
    type: "send",
    commandId: "id",
    sessionId: "session",
    text: "hello",
    authorityGeneration: 2,
  };
  expect(parseCommand(command).authorityGeneration).toBe(2);
  for (const authorityGeneration of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])
    expect(() => parseCommand({ ...command, authorityGeneration })).toThrow("authority generation");
});

it("rejects stale/unversioned migrated commands before persistence or provider dispatch", async () => {
  const f = await fixture();
  for (const authorityGeneration of [undefined, 1, 3])
    await expect(f.engine.command({ ...f.send, authorityGeneration })).rejects.toThrow(
      "current generation",
    );
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(await f.store.receiptStatus("send")).toBeUndefined();
  const receipt = await f.engine.command(f.send);
  expect(receipt.authorityGeneration).toBe(2);
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledTimes(1), { timeout: 5_000 });
  expect((await f.store.session("migrated")).authorityGeneration).toBe(2);
});

it("rechecks generation after asynchronous execution admission before starting a provider", async () => {
  const f = await fixture(),
    admitted = gate(),
    release = gate();
  cleanups.push(async () => release.resolve());
  f.engine.setManagedTurnHistoryAdapter({
    history: {} as ManagedTurnHistoryAdapter["history"],
    exactGitRewindEnabled: () => false,
    assertWritable: async () => {},
    workspaceForSession: async (value) => {
      if (value.status === "running") {
        admitted.resolve();
        await release.promise;
      }
      return null;
    },
  });
  const receipt = await f.engine.command(f.send);
  await admitted.promise;
  const admittedWork = (
    f.engine as unknown as { running: Map<string, { done: Promise<void> }> }
  ).running.get("migrated")!.done;
  await f.store.db
    .prepare("UPDATE host_authority_heads SET generation=3 WHERE session_id='migrated'")
    .run();
  release.resolve();
  await admittedWork;
  expect(receipt.authorityGeneration).toBe(2);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("stale generation provider callbacks cannot publish transcript output or stop another generation", async () => {
  const f = await fixture();
  await f.engine.command(f.send);
  await vi.waitFor(() => expect(f.input()).toBeDefined(), { timeout: 5_000 });
  const before = await f.store.db
    .prepare("SELECT snapshot FROM sessions WHERE id='migrated'")
    .get();
  const stops = f.provider.stop.mock.calls.length;
  await f.store.db
    .prepare("UPDATE host_authority_heads SET generation=3 WHERE session_id='migrated'")
    .run();
  f.input()!.onEvent({ type: "message.delta", text: "stale secret output" });
  await f.store.db.scope(() => undefined);
  await tick();
  expect(
    (await f.store.db.prepare("SELECT snapshot FROM sessions WHERE id='migrated'").get())?.snapshot,
  ).toBe(before?.snapshot);
  expect(f.provider.stop).toHaveBeenCalledTimes(stops);
});

it("disk-full Stop reaches the exact running provider and returns a non-durable receipt with a warning", async () => {
  const f = await fixture();
  const receipt = await f.engine.command(f.send);
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledTimes(1), { timeout: 5_000 });
  await f.store.db.exec("CREATE TABLE full_stop_fixture(value BLOB)");
  const pages = (await f.store.db.prepare("PRAGMA page_count").get())?.page_count;
  await f.store.db.exec(`PRAGMA max_page_count=${pages}`);
  await expect(
    f.store.db.prepare("INSERT INTO full_stop_fixture VALUES(zeroblob(1048576))").run(),
  ).rejects.toThrow();
  const stop = {
    type: "cancel",
    commandId: "emergency-stop",
    sessionId: "migrated",
    runId: receipt.runId,
    authorityGeneration: 2,
  };
  await expect(f.engine.command({ ...stop, authorityGeneration: 1 })).rejects.toThrow(
    "current generation",
  );
  await expect(f.engine.command({ ...stop, runId: "wrong-run" })).rejects.toThrow(
    "verified current",
  );
  expect(f.provider.cancel).not.toHaveBeenCalled();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(f.engine.command(stop)).resolves.toMatchObject({
    commandId: "emergency-stop",
    sessionId: "migrated",
    runId: receipt.runId,
  });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
  expect(f.provider.cancel).toHaveBeenCalledWith("migrated");
  expect(await f.store.receiptStatus("emergency-stop")).toBeUndefined();
});
