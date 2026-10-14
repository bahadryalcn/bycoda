import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

type Deferred = { promise: Promise<unknown>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<unknown>((res) => {
    resolve = () => res({ updatedAt: 1, transcriptRevision: 1 });
  });
  return { promise, resolve };
}

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

function session(id: string, title = "") {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor" as const,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    title,
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
    busy: true,
  };
}

function upsertTitles(): string[] {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "session_upsert" || command === "session_apply_delta")
    .map(([command, args]) =>
      command === "session_apply_delta" ? args.delta.session.title : args.session.title,
    );
}

/** First upsert blocks until released; everything else resolves at once. */
function blockFirstUpsert() {
  const first = deferred();
  let seen = 0;
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "session_upsert" && seen++ === 0) return first.promise;
    return Promise.resolve(
      command === "session_upsert" || command === "session_apply_delta"
        ? { updatedAt: 2, transcriptRevision: 2, revision: 2 }
        : undefined,
    );
  });
  return first;
}

afterEach(() => {
  mocks.invoke.mockReset();
});

describe("live session persistence", () => {
  it("coalesces snapshots behind a stuck write into one write with the newest", async () => {
    const first = blockFirstUpsert();
    const { upsertSessionLive } = await loadStore();
    const writes = [upsertSessionLive(session("s1", "t0"))];
    await vi.waitFor(() => expect(upsertTitles()).toEqual(["t0"]));
    for (let i = 1; i <= 5; i++) {
      writes.push(upsertSessionLive(session("s1", `t${i}`)));
    }
    expect(upsertTitles()).toEqual(["t0"]);
    first.resolve();
    await Promise.all(writes);
    expect(upsertTitles()).toEqual(["t0", "t5"]);
  });

  it("drops the pending snapshot when a hard write is issued, and the hard write is last", async () => {
    const first = blockFirstUpsert();
    const { upsertSession, upsertSessionLive } = await loadStore();
    const live0 = upsertSessionLive(session("s1", "live0"));
    await vi.waitFor(() => expect(upsertTitles()).toEqual(["live0"]));
    const live1 = upsertSessionLive(session("s1", "live1"));
    const hard = upsertSession({ ...session("s1", "settled"), busy: false });
    first.resolve();
    await Promise.all([live0, live1, hard]);
    expect(upsertTitles()).toEqual(["live0", "settled"]);
  });

  it("does not let a live snapshot taken after a hard write run before it", async () => {
    const first = blockFirstUpsert();
    const { upsertSession, upsertSessionLive } = await loadStore();
    const hard = upsertSession(session("s1", "hard"));
    await vi.waitFor(() => expect(upsertTitles()).toEqual(["hard"]));
    const live = upsertSessionLive(session("s1", "live"));
    first.resolve();
    await Promise.all([hard, live]);
    expect(upsertTitles()).toEqual(["hard", "live"]);
  });

  it("cancels the pending live write when the session is deleted", async () => {
    const first = blockFirstUpsert();
    const { deleteSession, upsertSessionLive } = await loadStore();
    const live0 = upsertSessionLive(session("s1", "live0"));
    await vi.waitFor(() => expect(upsertTitles()).toEqual(["live0"]));
    const live1 = upsertSessionLive(session("s1", "live1"));
    const deleting = deleteSession("s1");
    first.resolve();
    await Promise.all([live0, live1, deleting]);
    expect(upsertTitles()).toEqual(["live0"]);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands[commands.length - 1]).toBe("session_delete");
    await upsertSessionLive(session("s1", "late"));
    expect(upsertTitles()).toEqual(["live0"]);
  });

  it("skips a pending live write whose shouldWrite turns false", async () => {
    const first = blockFirstUpsert();
    const { upsertSessionLive } = await loadStore();
    let removing = false;
    const live0 = upsertSessionLive(session("s1", "live0"));
    await vi.waitFor(() => expect(upsertTitles()).toEqual(["live0"]));
    const onStart = vi.fn();
    const live1 = upsertSessionLive(session("s1", "live1"), {
      shouldWrite: () => !removing,
      onStart,
    });
    removing = true;
    first.resolve();
    await Promise.all([live0, live1]);
    expect(upsertTitles()).toEqual(["live0"]);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("reports start only for snapshots that were written, and failure for the written one", async () => {
    const first = blockFirstUpsert();
    const { upsertSessionLive } = await loadStore();
    const started: string[] = [];
    const failed: string[] = [];
    const live = (title: string) =>
      upsertSessionLive(session("s1", title), {
        onStart: () => started.push(title),
        onFailed: () => failed.push(title),
      });
    const writes = [live("a")];
    await vi.waitFor(() => expect(started).toEqual(["a"]));
    writes.push(live("b"), live("c"), live("d"));
    expect(started).toEqual(["a"]);
    first.resolve();
    await Promise.all(writes);
    expect(started).toEqual(["a", "d"]);
    expect(failed).toEqual([]);

    mocks.invoke.mockRejectedValue(new Error("disk full"));
    await live("e");
    expect(started).toEqual(["a", "d", "e"]);
    expect(failed).toEqual(["e"]);
  });
});
