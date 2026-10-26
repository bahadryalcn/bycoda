import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

function session(id: string) {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor" as const,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    title: "",
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
    busy: true,
  };
}

afterEach(() => {
  mocks.invoke.mockReset();
});

describe("session persistence concurrency", () => {
  it("passes original dates for a newly adopted row without changing ordinary saves", async () => {
    const { upsertSession } = await loadStore();
    mocks.invoke.mockResolvedValue(null);
    await upsertSession(session("adopted"), { createdAt: 100, updatedAt: 200 });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "session_upsert",
      expect.objectContaining({
        session: expect.objectContaining({ id: "adopted", createdAt: 100, updatedAt: 200 }),
      }),
    );
    await upsertSession(session("ordinary"));
    const payload = mocks.invoke.mock.calls.at(-1)![1].session;
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
  });

  it("writes an explicitly cleared empty transcript instead of leaving old history on disk", async () => {
    const { upsertClearedSession, upsertSession } = await loadStore();
    const cleared = { ...session("cleared"), busy: false, blocks: [] };
    mocks.invoke.mockResolvedValue({ ...cleared, createdAt: 1, updatedAt: 2 });
    expect(await upsertSession(cleared)).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await upsertClearedSession(cleared);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "session_upsert",
      expect.objectContaining({
        session: expect.objectContaining({ id: "cleared", blocks: [] }),
      }),
    );
    expect(mocks.invoke.mock.calls[0][1].session.providerSessionId).toBeUndefined();
  });

  it("drains worker writes before deleting a lead and strips ownership from later snapshots", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      return command === "session_upsert" && commands.length === 1
        ? firstWrite.promise
        : Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();
    const worker = { ...session("worker"), orchestrationLeadId: "lead" };
    const writing = upsertSession(worker);
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const queued = upsertSession(worker);
    const deleting = deleteSession("lead");
    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve(undefined);
    await Promise.all([writing, queued, deleting]);
    expect(commands).toEqual(["session_upsert", "session_upsert", "session_delete"]);
    await upsertSession(worker);
    for (const [, args] of mocks.invoke.mock.calls
      .slice(1)
      .filter(([command]) => command === "session_upsert")) {
      expect(args.session.blocks[0].orchestrationLeadId).toBeUndefined();
    }
  });

  it("serializes deletion after an active write and drops a queued late upsert", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert") return firstWrite.promise;
      return Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const lateWrite = upsertSession({ ...session("s1"), title: "late" });
    const deleting = deleteSession("s1");

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, lateWrite, deleting]);

    expect(commands).toEqual(["session_upsert", "session_delete"]);
  });

  it("discards a draft-only record before reusing its open session id", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (commands.length === 1) return firstWrite.promise;
      return Promise.resolve({
        id: "s1",
        cwd: "/tmp/project",
        harness: "cursor",
        model: "",
        runtimeMode: "supervised",
        title: "",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { discardDraftSessionRecord, upsertSession } = await loadStore();

    const draftWrite = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const discarding = discardDraftSessionRecord("s1");
    const laterTurn = upsertSession({ ...session("s1"), title: "later" });

    firstWrite.resolve(undefined);
    await Promise.all([draftWrite, discarding, laterTurn]);
    expect(commands).toEqual(["session_upsert", "session_delete", "session_upsert"]);
  });

  it("drains queued saves before detaching a removed worktree", async () => {
    const firstWrite = deferred<unknown>();
    mocks.invoke.mockReturnValueOnce(firstWrite.promise).mockResolvedValue(undefined);
    const { flushSessionWrites, upsertSession } = await loadStore();
    const active = upsertSession(session("s1"));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    const queued = upsertSession({ ...session("s1"), title: "latest" });
    let flushed = false;
    const flushing = flushSessionWrites().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    firstWrite.resolve(undefined);
    await Promise.all([active, queued, flushing]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(flushed).toBe(true);
  });

  it("archives only after the final active-turn snapshot is durable", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert" && commands.length === 1) {
        return firstWrite.promise;
      }
      return Promise.resolve({
        id: "s1",
        cwd: "/tmp/project",
        harness: "cursor",
        model: "",
        runtimeMode: "supervised",
        title: "",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { setSessionArchived, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const finalSnapshot = upsertSession({
      ...session("s1"),
      blocks: [
        { id: "user", role: "user", text: "hello" },
        { id: "assistant", role: "assistant", text: "final buffered output" },
      ],
    });
    const archiving = setSessionArchived("s1", true);

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, finalSnapshot, archiving]);

    expect(commands).toEqual(["session_upsert", "session_upsert", "session_set_archived"]);
    expect(mocks.invoke.mock.calls[1]?.[1]).toMatchObject({
      session: {
        blocks: [{ text: "hello" }, { text: "final buffered output" }],
      },
    });
  });
});

describe("guarded session save", () => {
  it("writes only while the stored updatedAt is the one the caller read", async () => {
    let stored = 10;
    const writes: unknown[] = [];
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "session_upsert") throw new Error(command);
      // The Rust command does the compare-and-swap; mirror its contract.
      if (args?.expectedUpdatedAt !== stored) return null;
      writes.push(args);
      return { id: "s", updatedAt: ++stored };
    });
    const { upsertSessionIfUnchanged } = await loadStore();
    expect(await upsertSessionIfUnchanged(session("s") as never, 10)).toBe(true);
    // Another window wrote in between: the caller's stamp is now old.
    expect(await upsertSessionIfUnchanged(session("s") as never, 10)).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it("asks the store to require a missing row for a null expectation", async () => {
    mocks.invoke.mockResolvedValue(null);
    const { upsertSessionIfUnchanged } = await loadStore();
    expect(await upsertSessionIfUnchanged(session("s") as never, null)).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "session_upsert",
      expect.objectContaining({ expectMissing: true }),
    );
  });
});
