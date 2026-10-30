import { expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { formatSessionTitle } from "../src/features/sessions/model/session";

function removeFixture(folder: string): void {
  const target = resolve(folder);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("bycoda-engine-async-"))
    throw new Error("Unexpected fixture directory");
  rmSync(target, { recursive: true, force: true });
}

async function captureCommittedDispatch<T>(store: HostStore, accept: () => Promise<T>) {
  const effects: Array<() => void | Promise<void>> = [];
  const commit = vi.spyOn(store, "afterCommit").mockImplementation((effect) => {
    effects.push(effect);
  });
  let receipt: T;
  try {
    receipt = await accept();
  } finally {
    commit.mockRestore();
  }
  // Summary/cache notifications precede the actual command dispatch, as in the
  // existing committed-approval latch. All SQL and receipt writes remain real.
  const dispatch = effects.pop();
  expect(dispatch).toBeDefined();
  for (const effect of effects) await effect();
  return { receipt, dispatch: dispatch! };
}

it("seeds a committed follow-up from the revision advanced by a late first-turn title", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const store = new HostStore(join(folder, "host.db"));
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  let releaseTitle!: (value: { title: string; workItem: null }) => void;
  const title = new Promise<{ title: string; workItem: null }>((resolve) => {
    releaseTitle = resolve;
  });
  let releaseDispatch!: () => void;
  const dispatchGate = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  const provider = {
    send: vi.fn(async (input: SendTurnInput) => {
      await new Promise<void>((finish) => turns.push({ input, finish }));
    }),
    stop: async () => {
      for (const turn of turns) turn.finish();
    },
    cancel: async () => {},
    bind() {},
    approve() {},
    answer() {},
    generateTitle: vi.fn(() => title),
  };
  const engine = new HostEngine(store, { codex: provider });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const assertAuthority = store.assertAuthority.bind(store);
  let restoreAuthority = () => {};
  let dispatching: Promise<void> | undefined;
  try {
    const project = await engine.openProject(folder);
    const { sessionId } = await engine.command({
      type: "create",
      commandId: "title-race-create",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const first = await engine.command({
      type: "send",
      commandId: "title-race-A",
      sessionId,
      text: "First turn",
    });
    await vi.waitFor(() => {
      expect(turns).toHaveLength(1);
      expect(provider.generateTitle).toHaveBeenCalledOnce();
    });
    turns[0].input.onEvent({ type: "message.delta", text: "A completed" });
    turns[0].finish();
    await engine.waitForRun(sessionId, first.runId);
    const settledA = await store.session(sessionId);
    expect(settledA.status).toBe("idle");

    const { receipt, dispatch } = await captureCommittedDispatch(store, () =>
      engine.command({
        type: "send",
        commandId: "title-race-B",
        sessionId,
        text: "Second turn",
      }),
    );
    expect(receipt.revision).toBe(settledA.revision + 1);
    expect(await store.receiptStatus("title-race-B")).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledOnce();
    expect((await store.session(sessionId)).runId).toBe(receipt.runId);

    let entered!: () => void;
    const authorityEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let firstAuthority = true;
    const authority = vi.spyOn(store, "assertAuthority").mockImplementation(async (...args) => {
      const current = await assertAuthority(...args);
      if (firstAuthority) {
        firstAuthority = false;
        entered();
        // The outer committed authority check has released its SQL owner. A's
        // independent title is therefore free to commit before B installs live.
        await dispatchGate;
      }
      return current;
    });
    restoreAuthority = () => authority.mockRestore();
    dispatching = Promise.resolve(dispatch());
    void dispatching.catch(() => {});
    await authorityEntered;
    restoreAuthority();
    releaseTitle({ title: "Late first-turn title", workItem: null });
    const expectedTitle = formatSessionTitle("codex", "Late first-turn title");
    await vi.waitFor(async () => {
      const named = await store.session(sessionId);
      expect(named.session.title).toBe(expectedTitle);
      expect(named.revision).toBe(receipt.revision + 1);
      expect(named.runId).toBe(receipt.runId);
      expect(named.status).toBe("running");
    });
    expect(provider.send).toHaveBeenCalledOnce();
    releaseDispatch();
    await dispatching;
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.sessionId).toBe(sessionId);
    expect(turns[1].input.text).toContain("Second turn");
    turns[1].input.onEvent({ type: "turn.started", providerTurnId: "turn-B" });
    await vi.waitFor(async () => {
      const started = await store.session(sessionId);
      expect(started.revision).toBe(receipt.revision + 2);
      expect(started.session.blocks.at(-1)?.providerTurnId).toBe("turn-B");
    });
    turns[1].input.onEvent({ type: "message.delta", text: "B completed" });
    turns[1].finish();
    await engine.waitForRun(sessionId, receipt.runId);
    const settledB = await store.session(sessionId);
    expect(settledB.status).toBe("idle");
    expect(settledB.revision).toBe(receipt.revision + 4);
    expect(settledB.session.title).toBe(expectedTitle);
    expect(
      settledB.session.blocks
        .filter((block) => block.role === "assistant")
        .map((block) => block.text),
    ).toEqual(["A completed", "B completed"]);
    expect(provider.generateTitle).toHaveBeenCalledOnce();
    const rows = await store.db
      .prepare(
        "SELECT revision, payload FROM events WHERE session_id=? AND revision>? ORDER BY revision",
      )
      .all(sessionId, receipt.revision);
    expect(rows.map((row) => Number(row.revision))).toEqual([
      receipt.revision + 1,
      receipt.revision + 2,
      receipt.revision + 3,
      receipt.revision + 4,
    ]);
    expect(rows.map((row) => JSON.parse(String(row.payload)).type)).toEqual([
      "session.generatedTitle",
      "events",
      "events",
      "settled",
    ]);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    restoreAuthority();
    releaseDispatch();
    releaseTitle({ title: "cleanup", workItem: null });
    await dispatching?.catch(() => {});
    for (const turn of turns) turn.finish();
    await engine.close();
    await store.close();
    errors.mockRestore();
    removeFixture(folder);
  }
});

it.each(["run", "status"] as const)(
  "refuses a committed startup whose accepted %s changed and permits a later explicit send",
  async (changed) => {
    const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
    const store = new HostStore(join(folder, "host.db"));
    const provider = {
      send: vi.fn(async (input: SendTurnInput) => {
        input.onEvent({ type: "message.delta", text: "Fresh explicit turn" });
      }),
      stop: async () => {},
      cancel: async () => {},
      bind() {},
      approve() {},
      answer() {},
    };
    const engine = new HostEngine(store, { codex: provider });
    try {
      const project = await engine.openProject(folder);
      const { sessionId } = await engine.command({
        type: "create",
        commandId: "changed-create",
        projectId: project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      });
      const { receipt, dispatch } = await captureCommittedDispatch(store, () =>
        engine.command({ type: "send", commandId: "changed-send", sessionId, text: "Held turn" }),
      );
      expect(provider.send).not.toHaveBeenCalled();
      const accepted = await store.session(sessionId);
      expect(accepted.runId).toBe(receipt.runId);
      expect(accepted.status).toBe("running");
      // Real SQLite mutation supplies the state that the committed effect must
      // re-read; no provider, revision allocator or authority check is mocked.
      const replacement = await store.save(
        {
          ...accepted,
          revision: accepted.revision + 1,
          ...(changed === "run" ? { runId: "replacement-run" } : { status: "idle" as const }),
        },
        { type: "fixture.acceptedTurnChanged", changed },
      );
      await expect(Promise.resolve(dispatch())).rejects.toThrow(
        "Accepted provider turn changed before dispatch",
      );
      expect(provider.send).not.toHaveBeenCalled();
      expect(await store.session(sessionId)).toEqual(replacement);
      expect(await store.receiptStatus("changed-send")).toEqual(receipt);
      if (replacement.status === "running") {
        await store.save(
          {
            ...replacement,
            revision: replacement.revision + 1,
            status: "idle",
            runId: undefined,
          },
          { type: "fixture.replacementSettled" },
        );
      }
      const fresh = await engine.command({
        type: "send",
        commandId: "fresh-explicit-send",
        sessionId,
        text: "Fresh request",
      });
      await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
      await engine.waitForRun(sessionId, fresh.runId);
      const settled = await store.session(sessionId);
      expect(settled.status).toBe("idle");
      expect(settled.session.blocks.at(-1)?.text).toBe("Fresh explicit turn");
      expect(provider.send.mock.calls[0][0].text).toContain("Fresh request");
      expect(fresh.runId).not.toBe(receipt.runId);
    } finally {
      await engine.close();
      await store.close();
      removeFixture(folder);
    }
  },
);

it("joins the other accepted turns before reporting a provider shutdown failure", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const store = new HostStore(join(folder, "host.db"));
  const turns = new Map<string, () => void>();
  let first = "";
  let failed = false;
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopping = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const provider = {
    send: vi.fn(
      async ({ sessionId }: { sessionId: string }) =>
        new Promise<void>((resolve) => {
          turns.set(sessionId, resolve);
        }),
    ),
    stop: async (id: string) => {
      if (id === first && !failed) {
        failed = true;
        turns.get(id)?.();
        throw new Error("Fixture provider stop failed");
      }
      if (id !== first) {
        entered();
        await held;
      }
      turns.get(id)?.();
    },
    cancel: async () => {},
    bind() {},
    approve() {},
    answer() {},
  };
  const engine = new HostEngine(store, { codex: provider });
  const ids: string[] = [];
  try {
    const project = await engine.openProject(folder);
    for (let index = 0; index < 2; index++) {
      const created = await engine.command({
        type: "create",
        commandId: `create-${index}`,
        projectId: project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      });
      ids.push(created.sessionId);
      first ||= created.sessionId;
      await engine.command({
        type: "send",
        commandId: `send-${index}`,
        sessionId: created.sessionId,
        text: "hello",
      });
    }
    await vi.waitFor(() => expect(turns.size).toBe(2));
    let ended = false;
    const closing = engine.close();
    expect(engine.close()).toBe(closing);
    const outcome = closing.then(
      () => {
        ended = true;
        return undefined;
      },
      (error: unknown) => {
        ended = true;
        return error;
      },
    );
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ended).toBe(false);
    expect((await store.session(ids[1])).status).toBe("running");
    release();
    const error = await outcome;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toContainEqual(
      new Error("Fixture provider stop failed"),
    );
    for (const id of ids) expect((await store.session(id)).status).toBe("interrupted");
  } finally {
    release();
    for (const finish of turns.values()) finish();
    await engine.close().catch(() => {});
    await store.close();
    removeFixture(folder);
  }
});

it("discards optional naming results after shutdown without admitting another SQL operation", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const store = new HostStore(join(folder, "host.db"));
  let release!: (value: { title: string; workItem: null }) => void;
  const title = new Promise<{ title: string; workItem: null }>((resolve) => {
    release = resolve;
  });
  const provider = {
    send: async () => {},
    stop: async () => {},
    cancel: async () => {},
    bind() {},
    approve() {},
    answer() {},
    generateTitle: vi.fn(() => title),
  };
  const engine = new HostEngine(store, { codex: provider });
  try {
    const project = await engine.openProject(folder);
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    await engine.command({
      type: "send",
      commandId: "send",
      sessionId: created.sessionId,
      text: "hello",
    });
    await vi.waitFor(() => expect(provider.generateTitle).toHaveBeenCalledOnce());
    await engine.close();
    const before = await store.session(created.sessionId);
    const sql = vi.spyOn(store.db, "scope");
    release({ title: "Late title", workItem: null });
    await title;
    await Promise.resolve();
    expect(sql).not.toHaveBeenCalled();
    sql.mockRestore();
    expect(await store.session(created.sessionId)).toEqual(before);
  } finally {
    release({ title: "cleanup", workItem: null });
    await engine.close();
    await store.close();
    removeFixture(folder);
  }
});

it("does not acknowledge or dispatch a locked command until its receipt commits while timers progress", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const path = join(folder, "host.db");
  const store = new HostStore(path);
  let finish!: () => void;
  let sends = 0;
  let committedBeforeDispatch = false;
  const provider = {
    send: async () => {
      sends++;
      const reader = new DatabaseSync(path, { readOnly: true });
      try {
        committedBeforeDispatch = !!reader
          .prepare("SELECT id FROM receipts WHERE id=?")
          .get("locked-send");
      } finally {
        reader.close();
      }
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    stop: async () => {
      finish?.();
    },
    cancel: async () => {
      finish?.();
    },
    bind() {},
    approve() {},
    answer() {},
  };
  const engine = new HostEngine(store, { codex: provider });
  let writer: DatabaseSync | undefined;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await engine.ready;
    const project = await store.addProject(folder, "Async fixture");
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    writer = new DatabaseSync(path);
    writer.exec("BEGIN IMMEDIATE");
    const started = performance.now();
    let acknowledged = false;
    timer = setTimeout(() => {
      writer!.exec("COMMIT");
      released = true;
    }, 1500);
    const pending = engine
      .command({
        type: "send",
        commandId: "locked-send",
        sessionId: created.sessionId,
        text: "hello",
      })
      .then((receipt) => {
        acknowledged = true;
        return receipt;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const timerMs = performance.now() - started;
    expect(timerMs).toBeLessThan(750);
    expect(released).toBe(false);
    expect(acknowledged).toBe(false);
    expect(sends).toBe(0);
    const receipt = await pending;
    expect(receipt.sessionId).toBe(created.sessionId);
    await vi.waitFor(() => expect(sends).toBe(1));
    expect(committedBeforeDispatch).toBe(true);
  } finally {
    if (timer) clearTimeout(timer);
    if (writer) {
      if (!released) writer.exec("ROLLBACK");
      writer.close();
    }
    finish?.();
    await engine.close();
    await store.close();
    removeFixture(folder);
  }
});

it("re-reads accepted edits after recovery checkpoints and joins started recovery during shutdown", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const store = new HostStore(join(folder, "host.db"));
  let finish = () => {};
  let releaseCheckpoint = () => {};
  let releaseSettled = () => {};
  const provider = {
    send: vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
    stop: async () => {
      finish();
    },
    cancel: async () => {
      finish();
    },
    bind() {},
    approve() {},
    answer() {},
  };
  const engine = new HostEngine(store, { codex: provider });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await engine.ready;
    const project = await store.addProject(folder, "Recovery fixture");
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    let checkpointStarted!: () => void;
    let settlementStarted!: () => void;
    const checkpointReady = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });
    const settlementReady = new Promise<void>((resolve) => {
      settlementStarted = resolve;
    });
    const checkpointHold = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    const settlementHold = new Promise<void>((resolve) => {
      releaseSettled = resolve;
    });
    let checkpoints = 0;
    vi.spyOn(engine.checkpoints, "finishFilesTurn").mockImplementation(async () => {
      if (++checkpoints === 2) {
        checkpointStarted();
        await checkpointHold;
      }
    });
    const save = store.save.bind(store);
    let failed = false;
    vi.spyOn(store, "save").mockImplementation(async (value, event, options) => {
      if (!failed && (event as { type?: string }).type === "settled") {
        failed = true;
        throw new Error("Known fixture write failure");
      }
      return save(value, event, options);
    });
    engine.onSettled = async () => {
      settlementStarted();
      await settlementHold;
    };
    const receipt = await engine.command({
      type: "send",
      commandId: "send",
      sessionId: created.sessionId,
      text: "hello",
    });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    finish();
    await checkpointReady;
    await engine.updateSession(created.sessionId, {
      title: "Keep this accepted title",
      pinned: true,
    });
    let closed = false;
    const closing = engine.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    releaseCheckpoint();
    await settlementReady;
    await expect(engine.waitForRun(created.sessionId, receipt.runId)).rejects.toThrow(
      "cleanup is still pending",
    );
    let observed = false;
    const reading = store.session(created.sessionId).then((value) => {
      observed = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observed).toBe(false);
    expect(closed).toBe(false);
    releaseSettled();
    await closing;
    const saved = await reading;
    expect(saved.status).toBe("interrupted");
    expect(saved.session.title).toBe("Keep this accepted title");
    expect(saved.pinned).toBe(true);
  } finally {
    releaseCheckpoint();
    releaseSettled();
    finish();
    await engine.close();
    await store.close();
    errors.mockRestore();
    removeFixture(folder);
  }
});

it("drains asynchronous settlement bookkeeping before releasing readers and run waiters", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-engine-async-"));
  const store = new HostStore(join(folder, "host.db"));
  let finish = () => {};
  let release = () => {};
  const provider = {
    send: vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
    stop: async () => {
      finish();
    },
    cancel: async () => {
      finish();
    },
    bind() {},
    approve() {},
    answer() {},
  };
  const engine = new HostEngine(store, { codex: provider });
  try {
    await engine.ready;
    const project = await store.addProject(folder, "Settlement fixture");
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    let started!: () => void;
    const callbackStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    engine.onSettled = async () => {
      expect((await store.project(project.id)).id).toBe(project.id);
      started();
      await held;
    };
    const receipt = await engine.command({
      type: "send",
      commandId: "send",
      sessionId: created.sessionId,
      text: "hello",
    });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    finish();
    await callbackStarted;
    let observed = false;
    let runEnded = false;
    const read = store.session(created.sessionId).then((value) => {
      observed = true;
      return value;
    });
    const waited = engine.waitForRun(created.sessionId, receipt.runId).then(() => {
      runEnded = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observed).toBe(false);
    expect(runEnded).toBe(false);
    release();
    expect((await read).status).toBe("idle");
    await waited;
    expect(runEnded).toBe(true);
  } finally {
    release();
    finish();
    await engine.close();
    await store.close();
    removeFixture(folder);
  }
});
