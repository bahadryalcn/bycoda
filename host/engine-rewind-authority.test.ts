import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createManagedNativeRewind } from "./managed-native-rewind";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(migrated = true) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-engine-rewind-authority-"));
  cleanups.push(async () => {
    const target = resolve(root);
    if (
      resolve(join(target, "..")) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-engine-rewind-authority-")
    )
      throw new Error("refusing unexpected test directory cleanup");
    await rm(target, { recursive: true, force: true });
  });
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const base: HostSession = {
    projectId: project.id,
    revision: 0,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "session",
      cwd: root,
      harness: "codex",
      model: "fixture",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Preserve",
      blocks: [
        { id: "retained", role: "user", text: "retain" },
        { id: "remove", role: "user", text: "remove" },
        { id: "answer", role: "assistant", text: "answer" },
      ],
    },
  };
  await store.save(base, {});
  if (migrated) {
    await store.db
      .prepare("INSERT INTO host_authority_heads VALUES(?,?,?,?,?)")
      .run(store.environmentId, "session", 2, "fixture-migration", "host-active");
    await store.withAuthorityGeneration("session", 2, () =>
      store.save({ ...base, revision: 1, authorityGeneration: 2 }, {}),
    );
  }
  // No real provider is contacted; this fixture exercises the real engine,
  // receipt transaction, floor checks and SQLite triggers only.
  const provider = {
    send: vi.fn(),
    bind: vi.fn(),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  await engine.ready;
  cleanups.push(() => engine.close().catch(() => undefined));
  const adapter = engine.conversationRewindAdapter(join(root, "rescues"));
  const before = await store.session("session");
  async function advance() {
    await store.db
      .prepare("UPDATE host_authority_heads SET generation=3 WHERE session_id=?")
      .run("session");
    // Synthetic trusted SQL-only installer: change only the floor metadata at
    // the same transcript revision. Public save intentionally refuses blessing
    // a cached old-generation snapshot, so do not use it to manufacture this race.
    await store.withAuthorityGeneration("session", 3, async () => {
      await store.db
        .prepare(
          "UPDATE sessions SET snapshot=json_set(snapshot,'$.authorityGeneration',3),summary=json_set(summary,'$.authorityGeneration',3) WHERE id=?",
        )
        .run("session");
    });
  }
  const request = {
    operationId: "original-operation",
    sessionId: "session",
    userBlockId: "remove",
    direction: "rewind" as const,
    expectedRevision: before.revision,
    ...(migrated ? { authorityGeneration: 2 } : {}),
  };
  return { root, store, engine, adapter, provider, before, advance, request };
}

it.each([undefined, 1, 3])(
  "rejects adapter generation %s before provider, flush, rescue and gate work",
  async (generation) => {
    const f = await fixture();
    const work = vi.fn(async () => undefined);
    const read = vi.spyOn(f.store, "session");
    await expect(f.adapter.read("session", generation)).rejects.toThrow("current generation");
    await expect(f.adapter.settle("session", generation)).rejects.toThrow("current generation");
    await expect(
      f.adapter.rescue("stale", "session", f.before.revision, generation),
    ).rejects.toThrow("current generation");
    await expect(f.adapter.withSessionGate("session", work, generation)).rejects.toThrow(
      "current generation",
    );
    expect(read).not.toHaveBeenCalled();
    expect(f.provider.stop).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    await expect(readFile(join(f.root, "rescues", "stale.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("rechecks the original generation inside restore's SQL transaction instead of blessing a fresh snapshot", async () => {
  const f = await fixture();
  const entered = deferred(),
    release = deferred();
  const transact = f.store.transaction.bind(f.store);
  const spy = vi.spyOn(f.store, "transaction").mockImplementation(async (work) => {
    entered.resolve();
    await release.promise;
    return transact(work);
  });
  const pending = f.adapter.restore(f.request);
  void pending.catch(entered.reject);
  await entered.promise;
  spy.mockRestore();
  try {
    await f.advance();
    // A caller cannot upgrade the in-flight payload while the original intent
    // is waiting for SQL admission.
    f.request.authorityGeneration = 3;
  } finally {
    release.resolve();
  }
  await expect(pending).rejects.toThrow("current generation");
  expect(await f.adapter.receipt(f.request.operationId)).toBeNull();
  const current = await f.store.session("session");
  expect(current.authorityGeneration).toBe(3);
  expect(current.session.blocks).toEqual(f.before.session.blocks);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("rechecks a waited session gate after flush before invoking the callback", async () => {
  const f = await fixture();
  const work = vi.fn(async () => undefined);
  const flusher = f.engine as unknown as { flush(id: string): Promise<void> };
  vi.spyOn(flusher, "flush").mockImplementationOnce(async () => {
    await f.advance();
  });
  await expect(f.adapter.withSessionGate("session", work, 2)).rejects.toThrow("current generation");
  expect(work).not.toHaveBeenCalled();
  expect((await f.store.session("session")).authorityGeneration).toBe(3);
});

it("returns an original committed adapter receipt after floor advance without reading or mutating a newer view", async () => {
  const f = await fixture();
  const receipt = await f.adapter.restore(f.request);
  expect((await f.store.session("session")).session.blocks.map((block) => block.id)).toEqual([
    "retained",
  ]);
  await f.advance();
  const read = vi.spyOn(f.store, "session");
  expect(await f.adapter.restore(f.request)).toEqual(receipt);
  expect(await f.adapter.receipt(f.request.operationId)).toEqual(receipt);
  expect(read).not.toHaveBeenCalled();
  await expect(f.adapter.restore({ ...f.request, authorityGeneration: 3 })).rejects.toThrow(
    "different payload",
  );
});

it("preserves legacy native/current adapter rescue and receipt identity without a floor", async () => {
  const f = await fixture(false);
  expect((await f.adapter.read("session")).revision).toBe(f.before.revision);
  await f.adapter.rescue("legacy-rescue", "session", f.before.revision);
  const receipt = await f.adapter.restore(f.request);
  expect(await f.adapter.restore(f.request)).toEqual(receipt);
  expect((await f.store.session("session")).authorityGeneration).toBeUndefined();
});

it("forwards the retained generation through the native/Host proxy without converting it to legacy absence", async () => {
  const f = await fixture();
  // No native binding exists: the real proxy delegates to the real Host engine
  // adapter. This fixture does not qualify native IPC or native writer inventory.
  const proxy = createManagedNativeRewind({
    root: join(f.root, "native-proxy"),
    history: {} as never,
    registry: { getOperation: async () => null } as never,
    activity: {} as never,
    conversation: f.adapter,
    assertAuthority: async (id, generation) => {
      await f.store.assertAuthority(id, generation);
    },
    authorize: async () => true,
    isHostSession: async () => true,
  }).service.options.conversation;
  expect((await proxy.read("session", 2)).revision).toBe(f.before.revision);
  const work = vi.fn(async () => "guarded");
  expect(await proxy.withSessionGate("session", work, 2)).toBe("guarded");
  await proxy.rescue("through-proxy", "session", f.before.revision, 2);
  await proxy.settle("session", 2);
  const receipt = await proxy.restore(f.request);
  await f.advance();
  expect(await proxy.restore(f.request)).toEqual(receipt);
  await expect(proxy.read("session", 2)).rejects.toThrow("current generation");
});
