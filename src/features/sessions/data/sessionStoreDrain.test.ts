import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../model/session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), commands: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  claudeShellCommands: mocks.commands,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function session(id = "target", title = "latest"): Session {
  return {
    id,
    title,
    cwd: "/repo",
    harness: "cursor",
    model: "model",
    modelSettings: {},
    runtimeMode: "supervised",
    blocks: [{ id: "user", role: "user", text: "keep" }],
    busy: false,
  } as Session;
}
const summary = (id = "target", revision = 1) => ({
  ...session(id),
  createdAt: 1,
  updatedAt: revision,
  transcriptRevision: revision,
});
const attempts: { abandon(): void }[] = [];
async function fixture() {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.commands.mockReset();
  const store = await import("./sessionStore");
  const { rendererPersistenceDrain } = await import("./persistenceDrain");
  return {
    store,
    begin: (ids: readonly string[] = ["target"]) => {
      const attempt = rendererPersistenceDrain.beginAttempt(ids);
      attempts.push(attempt);
      return attempt;
    },
  };
}
afterEach(() => {
  attempts.splice(0).forEach((attempt) => attempt.abandon());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock("./persistenceDrain");
  vi.doUnmock("../model/draftCache");
});

describe("actual session data persistence drains", () => {
  it("preserves legacy null CAS results while strict draining rejects and a full acknowledged retry recovers", async () => {
    const { store, begin } = await fixture();
    mocks.invoke.mockResolvedValue(null);
    expect(await store.upsertSession(session())).toBeNull();
    await expect(store.flushSessionWrites()).resolves.toBeUndefined();
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    await expect(begin().observe()).rejects.toMatchObject({ code: "failed-write" });
    mocks.invoke.mockResolvedValue(summary());
    expect(await store.upsertSession(session())).not.toBeNull();
    await expect(begin().observe()).resolves.toMatchObject({ qualified: false });
  });

  it("retains a swallowed live delta failure despite a later delta and recovers only with a full CAS checkpoint", async () => {
    const { store } = await fixture();
    let revision = 0;
    let fail = false;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "session_apply_delta") {
        if (fail) throw new Error("unknown delta settlement");
        return { updatedAt: ++revision, revision };
      }
      return summary("target", ++revision);
    });
    await store.upsertSession(session());
    fail = true;
    const failed = vi.fn();
    await expect(
      store.upsertSessionLive(session("target", "failed"), { onFailed: failed }),
    ).resolves.toBeUndefined();
    expect(failed).toHaveBeenCalledOnce();
    fail = false;
    await store.upsertSessionLive(session("target", "later delta"));
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    await store.upsertSession(session("target", "full checkpoint"));
    await expect(store.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "session_upsert",
      expect.objectContaining({
        session: expect.objectContaining({ title: "full checkpoint" }),
        expectedRevision: 2,
      }),
    );
  });

  it("does not mistake the immediately resolved coalesced caller for the final native acknowledgement", async () => {
    const { store, begin } = await fixture();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let writes = 0;
    mocks.invoke.mockImplementation(() => (++writes === 1 ? first.promise : second.promise));
    const initial = store.upsertSessionLive(session("target", "first"));
    await vi.waitFor(() => expect(writes).toBe(1));
    const pending = store.upsertSessionLive(session("target", "superseded"));
    await store.upsertSessionLive(session("target", "retained newest"));
    const attempt = begin();
    let settled = false;
    const observation = attempt.observe().then(() => {
      settled = true;
    });
    first.resolve(summary());
    await initial;
    await vi.waitFor(() => expect(writes).toBe(2));
    expect(settled).toBe(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "session_apply_delta",
      expect.objectContaining({
        delta: expect.objectContaining({
          session: expect.objectContaining({ title: "retained newest" }),
        }),
      }),
    );
    second.resolve({ updatedAt: 2, revision: 2 });
    await pending;
    await observation;
    attempt.assertCurrent();
  });

  it("invalidates a late coalesced replacement without dropping its newest content", async () => {
    const { store, begin } = await fixture();
    const first = deferred<unknown>();
    let writes = 0;
    mocks.invoke.mockImplementation(() =>
      ++writes === 1 ? first.promise : Promise.resolve({ updatedAt: 2, revision: 2 }),
    );
    const initial = store.upsertSessionLive(session("target", "first"));
    await vi.waitFor(() => expect(writes).toBe(1));
    const pending = store.upsertSessionLive(session("target", "pending"));
    const attempt = begin();
    await store.upsertSessionLive(session("target", "late retained"));
    await expect(attempt.observe()).rejects.toMatchObject({ code: "late-producer" });
    first.resolve(summary());
    await Promise.all([initial, pending]);
    expect(mocks.invoke.mock.calls.at(-1)![1].delta.session.title).toBe("late retained");
  });

  it("does not treat a deliberately skipped live producer as a durable write", async () => {
    const { store } = await fixture();
    mocks.invoke.mockResolvedValue(summary());
    await expect(
      store.upsertSessionLive(session(), { shouldWrite: () => false }),
    ).resolves.toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    await store.upsertSession(session());
    await expect(store.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
  });

  it("keeps a metadata save from claiming that a discarded pending transcript was persisted", async () => {
    const { store } = await fixture();
    const first = deferred<unknown>();
    let count = 0;
    mocks.invoke.mockImplementation(() => (++count === 1 ? first.promise : Promise.resolve(null)));
    const writing = store.upsertSession(session());
    await vi.waitFor(() => expect(count).toBe(1));
    const live = store.upsertSessionLive(session("target", "unsaved transcript"));
    const queue = store.setSessionQueue("target", []);
    first.resolve(summary());
    await Promise.all([writing, live, queue]);
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    mocks.invoke.mockResolvedValue(summary("target", 2));
    await store.upsertSession(session("target", "full retained transcript"));
    await expect(store.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
  });

  it("drains an import that never entered the per-session queue", async () => {
    const { store, begin } = await fixture();
    const committed = deferred<unknown>();
    mocks.invoke.mockReturnValue(committed.promise);
    const imported = store.importSessionRecord(session(), { createdAt: 3, updatedAt: 4 });
    let settled = false;
    const observation = begin()
      .observe()
      .then(() => {
        settled = true;
      });
    await store.flushSessionWrites();
    expect(settled).toBe(false);
    committed.resolve(summary());
    await imported;
    await observation;
  });

  it("classifies nullable import absence explicitly without changing the ordinary result", async () => {
    const { store } = await fixture();
    mocks.invoke.mockResolvedValue(null);
    expect(await store.importSessionRecord(session(), { createdAt: 3, updatedAt: 4 })).toBeNull();
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
  });

  it("waits for shared rebase work while an unrelated session write does not freeze the target", async () => {
    const { store, begin } = await fixture();
    const unrelated = deferred<unknown>();
    const rebased = deferred<void>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "session_rebase_project" ? rebased.promise : unrelated.promise,
    );
    const writing = store.upsertSession(session("other"));
    await begin().observe();
    const rebase = store.rebaseProjectSessions("/old", "/new");
    let settled = false;
    const observation = begin()
      .observe()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    rebased.resolve();
    await rebase;
    await observation;
    unrelated.resolve(summary("other"));
    await writing;
  });

  it("awaits independent in-flight and workspace native commits, accepting void JSON null", async () => {
    const { store, begin } = await fixture();
    const inFlight = deferred<null>();
    const workspace = deferred<null>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "session_set_in_flight") return inFlight.promise;
      if (command === "workspace_set_snapshot") return workspace.promise;
      return Promise.resolve(null);
    });
    const refs = store.replaceInFlightSessions([{ sessionId: "target", cwd: "/repo" }]);
    const layout = store.saveWorkspaceSnapshot({
      sessions: ["target"],
      sessionRecovery: { held: ["held"] },
    });
    let settled = false;
    const observation = begin()
      .observe()
      .then(() => {
        settled = true;
      });
    inFlight.resolve(null);
    await refs;
    expect(settled).toBe(false);
    workspace.resolve(null);
    await layout;
    await observation;
    expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toContain(
      "session_take_in_flight",
    );
  });

  it("preserves failed shared-chain results for strict accounting, then permits an acknowledged replacement", async () => {
    const { store } = await fixture();
    mocks.invoke.mockRejectedValue(new Error("snapshot disk failure"));
    await expect(
      store.replaceInFlightSessions([{ sessionId: "target", cwd: "/repo" }]),
    ).rejects.toThrow("disk failure");
    await expect(store.saveWorkspaceSnapshot({ sessionRecovery: {} })).rejects.toThrow(
      "disk failure",
    );
    await store.flushSessionWrites();
    await expect(store.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    mocks.invoke.mockResolvedValue(null);
    await store.replaceInFlightSessions([]);
    await store.saveWorkspaceSnapshot({ sessionRecovery: {} });
    await expect(store.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
  });

  it("preserves an explicit empty queue clear and the native void acknowledgement", async () => {
    const { store, begin } = await fixture();
    const committed = deferred<null>();
    mocks.invoke.mockReturnValue(committed.promise);
    const clearing = store.setSessionQueue("target", []);
    const observation = begin().observe();
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("session_set_queue", {
        sessionId: "target",
        queue: null,
      }),
    );
    committed.resolve(null);
    await clearing;
    await expect(observation).resolves.toMatchObject({ qualified: false });
  });

  it("captures load-time provider repair before its first await and retains its later CAS write", async () => {
    const { store, begin } = await fixture();
    const commands = deferred<Record<string, string>>();
    const committed = deferred<unknown>();
    mocks.commands.mockReturnValue(commands.promise);
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "session_get")
        return Promise.resolve({
          ...summary(),
          harness: "claude",
          providerSessionId: "provider",
          blocks: [
            ...session().blocks,
            {
              id: "tool",
              role: "tool",
              text: "Shell",
              tool: { callId: "tool-1", kind: "execute" },
            },
          ],
        });
      if (command === "session_get_queue") return Promise.resolve([]);
      if (command === "session_upsert") return committed.promise;
      return Promise.resolve(null);
    });
    const loading = store.getSession("target");
    await vi.waitFor(() => expect(mocks.commands).toHaveBeenCalledOnce());
    const attempt = begin();
    let settled = false;
    const observation = attempt.observe().then(() => {
      settled = true;
    });
    commands.resolve({ "tool-1": "run preserved-command" });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("session_upsert", expect.anything()),
    );
    expect(settled).toBe(false);
    committed.resolve(summary("target", 2));
    expect((await loading)?.blocks.at(-1)?.text).toBe("run preserved-command");
    await observation;
    attempt.assertCurrent();
  });

  it("keeps progressive hydration registered across the scheduled callback after returning its tail", async () => {
    vi.useFakeTimers();
    const { store, begin } = await fixture();
    vi.stubGlobal("window", { setTimeout });
    const earlier = deferred<unknown>();
    mocks.invoke.mockImplementation((command: string, args: { before?: number }) => {
      if (command === "session_get_page")
        return args.before === undefined
          ? Promise.resolve({ session: summary(), before: 1, revision: 1, totalBlocks: 2 })
          : earlier.promise;
      return Promise.resolve([]);
    });
    const hydrated = vi.fn();
    const tail = await store.getSession("target", { onHydrated: hydrated });
    expect(tail?.historyLoading).toBe(true);
    let settled = false;
    const observation = begin()
      .observe()
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    earlier.resolve({
      session: { ...summary(), blocks: [{ id: "earlier", role: "user", text: "older" }] },
      revision: 1,
      totalBlocks: 2,
    });
    await observation;
    expect(hydrated).toHaveBeenCalled();
  });

  it("re-evaluates the real service against a cached registry without racing an incumbent native write", async () => {
    const { store } = await fixture();
    const persistence = await import("./persistenceDrain");
    const cache = await import("../model/draftCache");
    const native = deferred<unknown>();
    const titles: string[] = [];
    mocks.invoke.mockImplementation((_: string, args: { session: Session }) => {
      titles.push(args.session.title);
      return titles.length === 1 ? native.promise : Promise.resolve(summary("target", 2));
    });
    const old = store.upsertSession(session("target", "incumbent"));
    await vi.waitFor(() => expect(titles).toEqual(["incumbent"]));
    vi.resetModules();
    vi.doMock("./persistenceDrain", () => persistence);
    vi.doMock("../model/draftCache", () => cache);
    const reloaded = await import("./sessionStore");
    const newer = reloaded.upsertSession(session("target", "newest"));
    await Promise.resolve();
    expect(titles).toEqual(["incumbent"]);
    native.resolve(summary());
    await Promise.all([old, newer]);
    expect(titles).toEqual(["incumbent", "newest"]);
    await expect(reloaded.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
  });

  it("retains the real service's failed CAS ledger when only that module is re-evaluated", async () => {
    const { store } = await fixture();
    const persistence = await import("./persistenceDrain");
    const cache = await import("../model/draftCache");
    mocks.invoke.mockResolvedValue(null);
    await store.upsertSession(session());
    vi.resetModules();
    vi.doMock("./persistenceDrain", () => persistence);
    vi.doMock("../model/draftCache", () => cache);
    const reloaded = await import("./sessionStore");
    await expect(reloaded.flushSessionWritesStrict(["target"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    mocks.invoke.mockResolvedValue(summary());
    await reloaded.upsertSession(session());
    await expect(reloaded.flushSessionWritesStrict(["target"])).resolves.toBeUndefined();
  });
});
