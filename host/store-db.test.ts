import { afterEach, expect, it, vi } from "vitest";
import { AsyncResource } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { HostStore } from "./store";
import { monotonicNow } from "../src/shared/lib/time/timestamps";
import { RequestAuthorizationError, StoreDatabase } from "./store-db";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanups: Array<() => void | Promise<void>> = [];
it("names the caller that held the store queue past a second, and how many waited behind it", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const holdTheQueue = () =>
      database.scope(() => new Promise<void>((resolve) => setTimeout(resolve, 1_050)));
    const held = holdTheQueue();
    const waiting = database.prepare("SELECT 1 AS n").get();
    await Promise.all([held, waiting]);
    await database.scope(async () => undefined);
    const lines = warn.mock.calls.map(([line]) => String(line));
    // The holder, and the request that waited behind it: both name their stages.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^Host database queue held by .*holdTheQueue.* ms=1\d{3} queued=1 queue=\d+ms guard=\d+ms worker=\d+ms roundTrip=\d+ms commit=\d+ms requests=\d+$/,
    );
    expect(lines[1]).toMatch(/ ms=\d+ queued=0 queue=1\d{3}ms /);
    for (const line of lines) expect(line).not.toMatch(/StoreDatabase|file:|[\\/]/);
  } finally {
    warn.mockRestore();
  }
});

it("names a store queue owner that is still holding, before it ever returns", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const neverReturns = () =>
      database.scope(() => {
        entered();
        return new Promise<void>((resolve) => (release = resolve));
      });
    const held = neverReturns();
    const waiting = database.prepare("SELECT 1 AS n").get();
    await inside;
    vi.advanceTimersByTime(15_000);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Host database queue still held by .*neverReturns.* queued=1$/);
    release();
    await Promise.all([held, waiting]);
    vi.advanceTimersByTime(60_000);
    expect(warn.mock.calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    warn.mockRestore();
  }
});

it("fails a queue holder that never returns so later requests are served", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  database.scopeDeadlineMs = 50;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    let lateWrite: Promise<unknown> | undefined;
    const hung = database.scope(async () => {
      await database.exec("CREATE TABLE IF NOT EXISTS hang_probe (id INTEGER)");
      await database.exec("BEGIN IMMEDIATE");
      lateWrite = new Promise((resolve) => setTimeout(resolve, 120)).then(() =>
        database.exec("INSERT INTO hang_probe VALUES (1)"),
      );
      lateWrite.catch(() => undefined);
      await new Promise<never>(() => undefined);
    });
    const waiting = database.prepare("SELECT 1 AS n").get();
    await expect(hung).rejects.toThrow(/exceeded its deadline/);
    expect(await waiting).toEqual({ n: 1 });
    // The abandoned transaction was rolled back and its late write has no live owner.
    await expect(lateWrite).rejects.toThrow(/no live owner|closed owner/);
    expect(await database.prepare("SELECT count(*) AS n FROM hang_probe").get()).toEqual({ n: 0 });
    expect(database.restartRequired).toBe(false);
  } finally {
    error.mockRestore();
  }
});

it("fails the database instead of waiting forever when the worker stops answering", async () => {
  const directory = mkdtempSync(join(tmpdir(), "store-silent-worker-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const silent = join(directory, "silent-worker.mjs");
  writeFileSync(
    silent,
    'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ready: true }); parentPort.on("message", () => {});',
  );
  const database = new StoreDatabase(":memory:", pathToFileURL(silent));
  database.boundaryDeadlineMs = 50;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await database.ready;
    const first = database.prepare("SELECT 1 AS n").get();
    const second = database.prepare("SELECT 2 AS n").get();
    await expect(first).rejects.toThrow(/worker stopped|did not answer/);
    await expect(second).rejects.toThrow();
    expect(database.restartRequired).toBe(true);
  } finally {
    error.mockRestore();
  }
});

const slowWorker = () => {
  const directory = mkdtempSync(join(tmpdir(), "store-slow-worker-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "slow-worker.mjs");
  // Answers ping/enter/leave at once; every statement takes 400 ms.
  writeFileSync(
    file,
    `import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ready: true });
parentPort.on("message", ({ id, method }) => {
  if (method === "ping" || method === "enter" || method === "leave") parentPort.postMessage({ id });
  else setTimeout(() => parentPort.postMessage({ id, value: { n: 1 } }), 400);
});`,
  );
  return pathToFileURL(file);
};

it("abandons a holder with a slow worker request without failing a responsive worker", async () => {
  const database = new StoreDatabase(":memory:", slowWorker());
  database.scopeDeadlineMs = 50;
  database.boundaryDeadlineMs = 1_000;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await database.ready;
    const holder = database.prepare("SELECT 1 AS n").get();
    await expect(holder).rejects.toThrow(/exceeded its deadline/);
    expect(database.restartRequired).toBe(false);
    await database.scope(async () => undefined);
  } finally {
    error.mockRestore();
  }
});

it("settles a holder that finishes at its deadline exactly once and keeps serving", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  database.scopeDeadlineMs = 30;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const delay of [24, 28, 30, 32, 36]) {
      const outcome = await database
        .scope(() => new Promise<string>((resolve) => setTimeout(() => resolve("done"), delay)))
        .then(
          (value) => value,
          (failure: Error) => failure.name,
        );
      expect(["done", "ScopeDeadlineError"]).toContain(outcome);
      expect(await database.prepare("SELECT 1 AS n").get()).toEqual({ n: 1 });
    }
    expect(database.restartRequired).toBe(false);
  } finally {
    error.mockRestore();
  }
});

it("fails the database and rejects pending requests on a worker messageerror", async () => {
  const database = new StoreDatabase(":memory:", slowWorker());
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await database.ready;
    const pending = database.prepare("SELECT 1 AS n").get();
    void pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    (database as any).worker.emit("messageerror", new Error("cannot deserialize"));
    await expect(pending).rejects.toThrow(/worker stopped/);
    expect(database.restartRequired).toBe(true);
  } finally {
    error.mockRestore();
  }
});

it("restores normal durability after an abandoned critical scope", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  database.scopeDeadlineMs = 50;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(database.durableScope(() => new Promise<never>(() => undefined))).rejects.toThrow(
      /exceeded its deadline/,
    );
    expect(await database.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 1 });
    expect(database.restartRequired).toBe(false);
  } finally {
    error.mockRestore();
  }
});

it("notifies the host once when the worker fails for good", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  // A failed database cannot close normally; stop its worker directly.
  cleanups.push(async () => void (await (database as any).worker.terminate()));
  const fatal = vi.fn();
  database.onFatal = fatal;
  database.fail(new Error("one"));
  database.fail(new Error("two"));
  expect(fatal).toHaveBeenCalledTimes(1);
});

it("leaves no timers behind once its scopes end", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  try {
    await database.scope(async () => undefined);
    await database.prepare("SELECT 1 AS n").get();
    await database
      .scope(async () => {
        throw new Error("boom");
      })
      .catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the next transaction's state when an abandoned transaction resumes and fails", async () => {
  const { store } = await fixture();
  store.db.scopeDeadlineMs = 60;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await store.db.exec("CREATE TABLE IF NOT EXISTS epoch_probe (v TEXT)");
    let resume!: () => void;
    const first = store.transaction(async () => {
      await store.db.exec("INSERT INTO epoch_probe VALUES ('a')");
      await new Promise<void>((resolve) => (resume = resolve));
      throw new Error("late failure");
    });
    await expect(first).rejects.toThrow(/exceeded its deadline/);
    let during = false;
    await store.transaction(async () => {
      await store.db.exec("INSERT INTO epoch_probe VALUES ('b')");
      resume();
      await new Promise((resolve) => setTimeout(resolve, 20));
      during = (store as any).inTransaction;
    });
    expect(during).toBe(true);
    expect((store as any).inTransaction).toBe(false);
    expect(await store.db.prepare("SELECT v FROM epoch_probe").all()).toEqual([{ v: "b" }]);
  } finally {
    error.mockRestore();
  }
});

it("captures request authority without restoring a closed SQL owner, and rechecks the original grant inside a different live transaction", async () => {
  const { store } = await fixture();
  let allowed = true,
    captured!: () => Promise<void>,
    escaped!: () => Promise<void>;
  await store.db.withAuthorization(
    async () => {
      await store.projects();
      return allowed;
    },
    () =>
      store.transaction(async () => {
        captured = await store.db.captureAuthorization();
        escaped = AsyncResource.bind(() => captured());
      }, "critical"),
  );
  await expect(escaped()).rejects.toThrow("closed owner");
  await store.db.withAuthorization(
    async () => {
      await captured();
      return true;
    },
    () =>
      store.transaction(async () => {
        expect(await store.projects()).toHaveLength(1);
        await store.db.checkAuthorization();
      }, "critical"),
  );
  allowed = false;
  await expect(
    store.db.withAuthorization(
      async () => {
        await captured();
        return true;
      },
      () =>
        store.transaction(async () => {
          throw new Error("A revoked guard must not enter SQL work");
        }, "critical"),
    ),
  ).rejects.toThrow(RequestAuthorizationError);
});

it("prepares captured structured authority before SQL admission while retaining both original and prepared revocation checks", async () => {
  const { store } = await fixture(),
    other = new StoreDatabase(":memory:");
  await other.ready;
  cleanups.push(() => other.close());
  let originalAllowed = true,
    preparedAllowed = true;
  const prepare = vi.fn(async () => {
    expect(store.db.ownsScope).toBe(false);
    expect((await other.prepare("SELECT 1 AS n").get())?.n).toBe(1);
    return async () => preparedAllowed;
  });
  const captured = await store.db.withAuthorization(
    { prepare, check: async () => originalAllowed },
    () => store.db.captureAuthorization(),
  );
  expect(prepare).toHaveBeenCalledTimes(1);
  await store.db.withAuthorization(
    async () => {
      await captured();
      return true;
    },
    () =>
      store.transaction(async () => {
        await store.db.checkAuthorization();
      }, "critical"),
  );
  originalAllowed = false;
  await expect(captured()).rejects.toThrow(RequestAuthorizationError);
  originalAllowed = true;
  preparedAllowed = false;
  await expect(captured()).rejects.toThrow(RequestAuthorizationError);
  await store.transaction(async () => {
    await expect(
      store.db.withAuthorization({ prepare, check: async () => true }, () =>
        store.db.captureAuthorization(),
      ),
    ).rejects.toThrow("before SQL admission");
  }, "critical");
  expect(prepare).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-store-actor-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  await store.ready;
  const project = await store.addProject(directory, "Fixture");
  const value: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "session",
      cwd: directory,
      title: "Committed",
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "auto",
      blocks: [],
    },
  };
  await store.save(value, {});
  return { store, path, value };
}

it("keeps a 20ms host timer responsive while SQLite waits 1500ms for a write lock, and acknowledges only the commit", async () => {
  const { store, path, value } = await fixture();
  const writer = new DatabaseSync(path);
  writer.exec("BEGIN IMMEDIATE");
  let released = false,
    accepted = false;
  const started = performance.now();
  const release = setTimeout(() => {
    writer.exec("COMMIT");
    released = true;
  }, 1500);
  const pending = store
    .save({ ...value, revision: 2, session: { ...value.session, title: "After lock" } }, {})
    .then(() => {
      accepted = true;
    });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const timerMs = performance.now() - started;
    expect(timerMs).toBeLessThan(750);
    expect(released).toBe(false);
    expect(accepted).toBe(false);
    await pending;
    expect(performance.now() - started).toBeGreaterThanOrEqual(1400);
    const db = new DatabaseSync(path);
    try {
      expect(
        JSON.parse(
          String(db.prepare("SELECT snapshot FROM sessions WHERE id='session'").get()!.snapshot),
        ).session.title,
      ).toBe("After lock");
    } finally {
      db.close();
    }
    console.info(
      JSON.stringify({
        kind: "HostStore SQLite actor lock",
        lockMs: 1500,
        scheduledTimerMs: 20,
        timerMs,
        acceptedAfterCommit: accepted,
      }),
    );
  } finally {
    clearTimeout(release);
    if (!released) writer.exec("ROLLBACK");
    writer.close();
    await pending;
  }
});

it("gates cached readers behind the owning transaction and publishes revisions only after commit", async () => {
  const { store, value } = await fixture();
  const held = gate(),
    entered = gate();
  const before = store.projectVersion(value.projectId);
  const transaction = store.transaction(async () => {
    await store.save(
      { ...value, revision: 2, session: { ...value.session, title: "Provisional" } },
      {},
    );
    expect((await store.session("session")).session.title).toBe("Provisional");
    expect(store.transactionActive).toBe(true);
    entered.resolve();
    await held.promise;
    await store.recordReceipt("fixture", {
      commandId: "accepted",
      sessionId: "session",
      revision: 2,
    });
  }, "critical");
  await entered.promise;
  let observed = false;
  const read = store.session("session").then((value) => {
    observed = true;
    return value;
  });
  try {
    expect(store.transactionActive).toBe(false);
    expect(store.projectVersion(value.projectId)).toBe(before);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observed).toBe(false);
  } finally {
    held.resolve();
    await transaction;
  }
  expect((await read).session.title).toBe("Provisional");
  expect(store.projectVersion(value.projectId)).toBe(before + 1);
  expect((await store.receiptStatus("accepted"))?.revision).toBe(2);
});

it("rolls back nested asynchronous callbacks, cached values, receipts and commit effects", async () => {
  const { store, value } = await fixture();
  const effect = vi.fn();
  const before = store.changeVersion;
  await expect(
    store.transaction(async () => {
      await store.transaction(async () => {
        await store.save(
          { ...value, revision: 2, session: { ...value.session, title: "Rolled back" } },
          {},
        );
        await store.recordReceipt("fixture", {
          commandId: "rolled-back",
          sessionId: "session",
          revision: 2,
        });
        store.afterCommit(effect);
      }, "critical");
      await Promise.resolve();
      throw new Error("rollback fixture");
    }, "critical"),
  ).rejects.toThrow("rollback fixture");
  expect((await store.session("session")).session.title).toBe("Committed");
  expect(await store.receiptStatus("rolled-back")).toBeUndefined();
  expect(store.changeVersion).toBe(before);
  expect(effect).not.toHaveBeenCalled();
});

it("rejects an escaped closed owner but permits afterCommit effects to await new storage operations", async () => {
  const { store } = await fixture();
  let escaped!: () => Promise<unknown>;
  const done = gate();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await store.transaction(async () => {
      escaped = AsyncResource.bind(() => store.projects());
      store.afterCommit(async () => {
        expect(store.transactionActive).toBe(false);
        expect((await store.projects()).length).toBe(1);
        done.resolve();
        throw new Error("expected asynchronous dispatch failure");
      });
    });
    await expect(escaped()).rejects.toThrow("closed owner");
    await done.promise;
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("Committed command dispatch failed:", expect.any(Error)),
    );
    expect((await store.projects()).length).toBe(1);
  } finally {
    error.mockRestore();
  }
});

it("dispatches afterCommit outside an outer SQL scope after a nested transaction has committed", async () => {
  const { store } = await fixture();
  const done = gate();
  await store.db.scope(async () => {
    await store.transaction(async () => {
      await store.projects();
    });
    store.afterCommit(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect((await store.projects()).length).toBe(1);
      done.resolve();
    });
  });
  await done.promise;
});

it("invalidates same-connection raw SQL snapshots, legacy summaries and remembered credentials", async () => {
  const { store, value } = await fixture();
  const legacy = { ...(await store.summaries(value.projectId))[0] };
  delete (legacy as Partial<typeof legacy>).providerSessionId;
  await store.db
    .prepare("UPDATE session_state SET summary=? WHERE id=?")
    .run(JSON.stringify(legacy), "session");
  await store.summaries(value.projectId);
  const repaired = JSON.parse(
    String(
      (await store.db.prepare("SELECT summary FROM session_state WHERE id=?").get("session"))!
        .summary,
    ),
  );
  expect(Object.hasOwn(repaired, "providerSessionId")).toBe(true);
  const changed = { ...value, session: { ...value.session, title: "Raw SQL updated" } };
  await store.db
    .prepare("UPDATE sessions SET snapshot=? WHERE id=?")
    .run(JSON.stringify(changed), "session");
  expect((await store.session("session")).session.title).toBe("Raw SQL updated");
  const device = await store.issueDevice("fixture");
  expect(await store.authenticated(device.token)).toBe(true);
  await store.db.prepare("DELETE FROM devices WHERE id=?").run(device.id);
  expect(await store.authenticated(device.token)).toBe(false);
});

it("fails closed without replay when a worker commits a write and disappears before its acknowledgment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-store-outcome-"));
  const path = join(directory, "fixture.db");
  const wrapper = join(directory, "worker.mjs");
  const realWorker = new URL("./store-worker.mjs", import.meta.url).href;
  writeFileSync(
    wrapper,
    `import {parentPort} from 'node:worker_threads'; let hidden; const post=parentPort.postMessage.bind(parentPort); parentPort.on('message',m=>{if(m.method==='run')hidden=m.id}); parentPort.postMessage=m=>{if(hidden!==undefined&&m.id===hidden&&!m.error){post({applied:true});return}post(m)}; await import(${JSON.stringify(realWorker)});`,
  );
  const database = new StoreDatabase(path, pathToFileURL(wrapper));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanups.push(async () => {
    await database.close().catch(() => undefined);
  });
  await database.exec("CREATE TABLE outcomes(value TEXT)");
  const worker = (database as unknown as { worker: Worker }).worker;
  const applied = gate();
  worker.on("message", (message) => {
    if (message.applied) applied.resolve();
  });
  const write = database.prepare("INSERT INTO outcomes VALUES (?)").run("once");
  const rejected = expect(write).rejects.toThrow("restart the host");
  await applied.promise;
  await worker.terminate();
  await rejected;
  await expect(database.prepare("INSERT INTO outcomes VALUES (?)").run("again")).rejects.toThrow(
    "restart the host",
  );
  const reader = new DatabaseSync(path);
  try {
    expect(reader.prepare("SELECT count(*) AS n FROM outcomes").get()!.n).toBe(1);
  } finally {
    reader.close();
  }
});

it("registers the known deterministic social predicate inside the worker", async () => {
  const { store } = await fixture();
  await store.db.registerFunction("social_text_matches");
  expect(
    (
      await store.db
        .prepare("SELECT social_text_matches(?, ?, ?) AS yes")
        .get("İstanbul", "istanbul", "tr")
    )?.yes,
  ).toBe(1);
});

it("preserves the primary operation failure when owner cleanup must roll back an open transaction", async () => {
  const { store } = await fixture();
  const primary = new Error("primary transaction failure");
  await expect(
    store.db.scope(async () => {
      await store.db.exec("BEGIN IMMEDIATE");
      throw primary;
    }),
  ).rejects.toBe(primary);
  expect((primary as Error & { cleanupError?: unknown }).cleanupError).toBeInstanceOf(Error);
  expect((await store.projects()).length).toBe(1);
});

it("keeps exhaustive scans lazy and closes the actual cursor on an early break", async () => {
  const { store } = await fixture();
  await store.db.exec(
    "CREATE TABLE cursor_rows(id INTEGER PRIMARY KEY,payload TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<64) INSERT INTO cursor_rows SELECT x,json_object('value',x) FROM n; INSERT INTO cursor_rows VALUES(65,'malformed JSON');",
  );
  await store.db.scope(async () => {
    const seen: number[] = [];
    for await (const row of store.db
      .prepare("SELECT json_extract(payload,'$.value') AS value FROM cursor_rows ORDER BY id")
      .iterate()) {
      seen.push(Number(row.value));
      break;
    }
    expect(seen).toEqual([1]);
    // An unclosed SQLite iterator would retain the table lock.
    await store.db.exec("DROP TABLE cursor_rows");
  });
});

it("rejects cursors outside a live scope and closes dangling cursors when their owner leaves", async () => {
  const { store } = await fixture();
  await expect(store.db.prepare("SELECT 1 AS n").iterate().next()).rejects.toThrow(
    "live database scope",
  );
  let iterator!: AsyncIterableIterator<Record<string, unknown>>;
  await store.db.scope(async () => {
    iterator = store.db.prepare("SELECT 1 AS n UNION ALL SELECT 2").iterate();
    expect((await iterator.next()).value.n).toBe(1);
  });
  await expect(iterator.next()).rejects.toThrow("closed owner");
  expect((await store.db.prepare("SELECT 3 AS n").get())?.n).toBe(3);
});

it("rechecks request authority after external preparation without reserving SQL admission", async () => {
  const { store, value } = await fixture();
  const device = await store.issueDevice("request");
  const prepared = gate(),
    release = gate();
  const guard = vi.fn(() => store.authenticated(device.token));
  const operation = vi.fn(() => store.save({ ...value, revision: 2 }, {}));
  const work = store.db.withAuthorization(guard, async () => {
    prepared.resolve();
    await release.promise;
    await store.db.scope(operation);
  });
  const rejected = expect(work).rejects.toThrow("authorization was revoked");
  try {
    await prepared.promise;
    expect(guard).not.toHaveBeenCalled();
    // An unrelated SQL write completes while external preparation is held.
    expect(await store.revokeDevice(device.id)).toBe(true);
  } finally {
    release.resolve();
  }
  await rejected;
  expect(guard).toHaveBeenCalledTimes(1);
  expect(operation).not.toHaveBeenCalled();
  expect((await store.session("session")).revision).toBe(1);
});

it("checks queued request authority after preceding admissions commit revocation", async () => {
  const { store } = await fixture();
  const device = await store.issueDevice("queued request");
  const entered = gate(),
    release = gate();
  const holding = store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const revocation = store.revokeDevice(device.id);
  const guard = vi.fn(() => store.authenticated(device.token));
  const operation = vi.fn(() => store.db.prepare("SELECT 1").get());
  const queued = store.db.withAuthorization(guard, () => store.db.scope(operation));
  const rejected = expect(queued).rejects.toThrow("authorization was revoked");
  expect(guard).not.toHaveBeenCalled();
  release.resolve();
  await holding;
  expect(await revocation).toBe(true);
  await rejected;
  expect(guard).toHaveBeenCalledTimes(1);
  expect(operation).not.toHaveBeenCalled();
});

it("prepares a scoped guard outside SQL ownership and rechecks revocation after preparation", async () => {
  const { store } = await fixture();
  const device = await store.issueDevice("prepared request");
  const entered = gate(),
    release = gate();
  const check = vi.fn(() => store.authenticated(device.token));
  const prepare = vi.fn(async () => {
    expect(store.db.ownsScope).toBe(false);
    entered.resolve();
    await release.promise;
    return check;
  });
  const operation = vi.fn(() => store.projects());
  const work = store.db.withAuthorization({ prepare, check }, () => store.db.scope(operation));
  const rejected = expect(work).rejects.toBeInstanceOf(RequestAuthorizationError);
  await entered.promise;
  try {
    expect(await store.revokeDevice(device.id)).toBe(true);
  } finally {
    release.resolve();
  }
  await rejected;
  expect(operation).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(1);
});

it("never runs external guard preparation from an existing transaction owner", async () => {
  const { store } = await fixture();
  const prepare = vi.fn(async () => () => true);
  const check = vi.fn(() => false);
  await store.transaction(async () => {
    await expect(
      store.db.withAuthorization({ prepare, check }, () => store.db.checkAuthorization()),
    ).rejects.toBeInstanceOf(RequestAuthorizationError);
    expect(store.db.ownsScope).toBe(true);
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(1);
});

it("refreshes a prepared guard for an explicit check after external work", async () => {
  const { store } = await fixture();
  let generation = 0;
  const check = vi.fn(() => false);
  const prepare = vi.fn(async () => {
    expect(store.db.ownsScope).toBe(false);
    const prepared = generation;
    return () => store.db.ownsScope && prepared === generation;
  });
  await store.db.withAuthorization({ prepare, check }, async () => {
    await store.projects();
    generation++;
    await store.db.checkAuthorization();
  });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(check).not.toHaveBeenCalled();
});

it("permits nested authentication reads and explicit authority checks without recursive admission", async () => {
  const { store } = await fixture();
  const device = await store.issueDevice("nested request");
  const guard = vi.fn(() => store.authenticated(device.token));
  await store.db.withAuthorization(guard, async () => {
    await store.db.checkAuthorization();
    expect(guard).toHaveBeenCalledTimes(1);
    await store.db.scope(async () => {
      expect(await store.authenticated(device.token)).toBe(true);
      expect((await store.projects()).length).toBe(1);
    });
    expect(guard).toHaveBeenCalledTimes(2);
  });
  await store.db.checkAuthorization();
  const revoked = store.db.withAuthorization(
    () => false,
    () => store.db.checkAuthorization(),
  );
  await expect(revoked).rejects.toBeInstanceOf(RequestAuthorizationError);
  await expect(revoked).rejects.toMatchObject({ code: "HOST_AUTH_REVOKED" });
  const failure = new Error("authority lookup failed");
  const operation = vi.fn();
  await expect(
    store.db.withAuthorization(
      () => {
        throw failure;
      },
      () => store.db.scope(operation),
    ),
  ).rejects.toBe(failure);
  expect(operation).not.toHaveBeenCalled();
  expect((await store.projects()).length).toBe(1);
});

it("detaches request authority from durable afterCommit effects", async () => {
  const { store, value } = await fixture();
  const device = await store.issueDevice("accepted request");
  const entered = gate(),
    release = gate(),
    done = gate();
  let effectError: unknown;
  const guard = vi.fn(() => store.authenticated(device.token));
  await store.db.withAuthorization(guard, () =>
    store.transaction(async () => {
      await store.recordReceipt("fixture", {
        commandId: "durably-accepted",
        sessionId: "session",
        revision: 1,
      });
      store.afterCommit(async () => {
        entered.resolve();
        await release.promise;
        try {
          await store.db.checkAuthorization();
          await store.save({ ...value, revision: 2 }, {});
        } catch (error) {
          effectError = error;
        } finally {
          done.resolve();
        }
      });
    }, "critical"),
  );
  await entered.promise;
  try {
    expect(await store.receiptStatus("durably-accepted")).toBeDefined();
    expect(await store.revokeDevice(device.id)).toBe(true);
  } finally {
    release.resolve();
  }
  await done.promise;
  expect(effectError).toBeUndefined();
  expect(guard).toHaveBeenCalledTimes(1);
  expect((await store.session("session")).revision).toBe(2);
});

it("shares shutdown, drains an accepted soft write and immediately rejects later admission", async () => {
  const { store, path, value } = await fixture();
  const entered = gate(),
    release = gate();
  const holding = store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const accepted = store.save({ ...value, revision: 2 }, {}, { deferred: true });
  const flush = vi.spyOn(store, "flushAll");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(() => {
    errors.mockRestore();
  });
  // Shutdown is independent of the revoked request that happens to initiate it.
  const first = store.db.withAuthorization(
    () => false,
    () => store.close(),
  );
  const second = store.close();
  expect(second).toBe(first);
  let closed = false;
  void first.then(() => {
    closed = true;
  });
  try {
    await expect(store.save({ ...value, revision: 3 }, {})).rejects.toThrow("database is closing");
    expect(closed).toBe(false);
  } finally {
    release.resolve();
  }
  await holding;
  await accepted;
  await first;
  expect(store.close()).toBe(first);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(errors).not.toHaveBeenCalled();
  const reader = new DatabaseSync(path);
  try {
    expect(
      Number(reader.prepare("SELECT revision FROM sessions WHERE id='session'").get()!.revision),
    ).toBe(2);
    reader.exec("BEGIN EXCLUSIVE; ROLLBACK");
  } finally {
    reader.close();
  }
});

it("closes the worker even when the final flush fails and retains that shared failure", async () => {
  const { store, path } = await fixture();
  // This fixture intentionally closes with a failure, so teardown expects it too.
  cleanups.pop();
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
  });
  const failure = new Error("final flush failed");
  const flush = vi.spyOn(store, "flushAll").mockRejectedValue(failure);
  const closed = store.close();
  expect(store.close()).toBe(closed);
  await expect(closed).rejects.toBe(failure);
  expect(store.close()).toBe(closed);
  await expect(store.close()).rejects.toBe(failure);
  expect(flush).toHaveBeenCalledTimes(1);
  expect((store.db as unknown as { worker: Worker }).worker.threadId).toBe(-1);
  await expect(store.projects()).rejects.toThrow("database is closing");
  const reader = new DatabaseSync(path);
  try {
    reader.exec("BEGIN EXCLUSIVE; ROLLBACK");
  } finally {
    reader.close();
  }
});

it("survives a cache-publication fault after a commit: logs, clears caches and keeps storage usable", async () => {
  const { store } = await fixture();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  store.db.onMutation = () => {
    throw new Error("cache publication boom");
  };
  const faults = vi.fn();
  store.db.onMutationFault = faults;
  await store.db.exec("CREATE TABLE IF NOT EXISTS cache_fault_fixture(value TEXT)");
  expect(faults).toHaveBeenCalledOnce();
  expect(store.db.restartRequired).toBe(false);
  expect(store.db.persistenceHealth()).toEqual({ state: "ready" });
  await store.db.exec("INSERT INTO cache_fault_fixture VALUES ('still writable')");
  error.mockRestore();
});

it("attributes a full session save, including its event rows, to that session's project", async () => {
  const { store, value } = await fixture();
  const unattributed = store.unattributedChangeVersion;
  const project = store.projectVersion(value.projectId);
  await store.save(
    { ...value, revision: 2, session: { ...value.session, title: "Saved" } },
    {
      type: "fixture",
    },
  );
  expect(
    (
      await store.db
        .prepare("SELECT count(*) AS count FROM events WHERE session_id=?")
        .get("session")
    )?.count,
  ).toBeGreaterThan(0);
  expect(store.projectVersion(value.projectId)).toBe(project + 1);
  expect(store.unattributedChangeVersion).toBe(unattributed);
  await store.db.exec("CREATE TABLE IF NOT EXISTS unattributed_fixture(value TEXT)");
  expect(store.unattributedChangeVersion).toBe(unattributed + 1);
});

it("keeps a cold session read off the Host SQL queue and keeps a write made meanwhile", async () => {
  const { store: first, path, value } = await fixture();
  const snapshot = await first.session("session");
  await first.close();
  const store = new HostStore(path);
  cleanups.push(() => store.close());
  await store.ready;
  const release = gate(),
    started = gate();
  const processes = (store as unknown as { sessionReadProcesses: { read: unknown } })
    .sessionReadProcesses;
  processes.read = vi.fn(async () => {
    started.resolve();
    await release.promise;
    return snapshot;
  });
  const read = store.session("session", new AbortController().signal);
  await started.promise;
  // The slow child read is in flight; a queued write must not wait for it.
  await store.save(
    { ...value, revision: 2, session: { ...value.session, title: "Written meanwhile" } },
    {},
  );
  release.resolve();
  expect((await read).session.title).toBe("Written meanwhile");
  expect((await store.session("session")).revision).toBe(2);
});

it("attributes a streaming save to its session without moving the project version or siblings", async () => {
  const { store, value } = await fixture();
  const sibling = store.versions.session("other", false);
  const scope = store.versions.scope(value.projectId, false);
  const project = store.projectVersion(value.projectId);
  const session = store.versions.session("session", false);
  // Same list-visible summary, only revision and updatedAt move.
  await store.save({ ...value, revision: 2, updatedAt: 2 }, {}, { deferred: true });
  await store.save({ ...value, revision: 3, updatedAt: 3 }, {}, { deferred: true });
  expect(store.versions.session("session", false)).toBe(session + 2);
  expect(store.projectVersion(value.projectId)).toBe(project);
  expect(store.versions.scope(value.projectId, false)).toBe(scope);
  expect(store.versions.session("other", false)).toBe(sibling);
  // A list-visible change still moves the project version, but never the sibling scope.
  await store.save(
    { ...value, revision: 4, updatedAt: 4, session: { ...value.session, title: "Renamed" } },
    {},
    { deferred: true },
  );
  expect(store.projectVersion(value.projectId)).toBe(project + 1);
  expect(store.versions.scope(value.projectId, false)).toBe(scope);
});

it("batches ordered writes atomically and keeps cached statements usable after eviction", async () => {
  const { store } = await fixture();
  await store.db.exec("CREATE TABLE batch_fixture(id INTEGER PRIMARY KEY, value TEXT)");
  const insert = store.db.prepare("INSERT INTO batch_fixture VALUES (?, ?)");
  await insert.runMany([
    [1, "one"],
    [2, "two"],
  ]);
  await expect(
    insert.runMany([
      [3, "three"],
      [1, "duplicate"],
    ]),
  ).rejects.toThrow();
  expect(await store.db.prepare("SELECT id FROM batch_fixture ORDER BY id").all()).toEqual([
    { id: 1 },
    { id: 2 },
  ]);
  for (let i = 0; i < 260; i++) await store.db.prepare(`SELECT ${i} AS value`).get();
  await insert.runMany([[3, "three"]]);
  expect((await store.db.prepare("SELECT count(*) AS count FROM batch_fixture").get())?.count).toBe(
    3,
  );
});

it("authenticates warm tokens without entering SQLite and invalidates them on revoke", async () => {
  const { store } = await fixture();
  const device = await store.issueDevice("cache fixture");
  expect(await store.authenticated(device.token)).toBe(true);
  const admission = store.db.admissionVersion;
  for (let i = 0; i < 20; i++) expect(await store.authenticated(device.token)).toBe(true);
  expect(store.db.admissionVersion).toBe(admission);
  const changed = vi.fn();
  const unsubscribe = store.subscribeAuthorizationChanges(changed);
  await store.revokeDevice(device.id);
  expect(await store.authenticated(device.token)).toBe(false);
  expect(changed).toHaveBeenCalled();
  unsubscribe();
});

it("cancels queued read admission without ever dispatching its work after the original owner leaves", async () => {
  const { store } = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const controller = new AbortController();
  const read = vi.fn(async () => "should never run");
  const queued = store.db.scope(read, controller.signal);
  controller.abort();
  await expect(queued).rejects.toThrow("admission cancelled");
  expect(read).not.toHaveBeenCalled();
  release.resolve();
  await original;
  await store.db.scope(async () => undefined);
  expect(read).not.toHaveBeenCalled();
});

it("reads cold Host snapshots in the original cancellable scope while retaining pending/cache precedence", async () => {
  const { store, value } = await fixture();
  const changed = {
    ...value,
    revision: 2,
    updatedAt: 2,
    session: {
      ...value.session,
      blocks: [{ id: "answer", role: "assistant" as const, text: "exact cold journal" }],
    },
  };
  await store.save(changed, {});
  await store.flushAll();
  (store as unknown as { cache: Map<string, unknown> }).cache.clear();
  const controller = new AbortController();
  const cold = await store.session("session", controller.signal);
  expect(cold.revision).toBe(2);
  expect(cold.session.blocks).toEqual(changed.session.blocks);
  await store.save(
    { ...changed, revision: 3, session: { ...changed.session, title: "Unflushed owner value" } },
    {},
  );
  expect((await store.session("session", controller.signal)).session.title).toBe(
    "Unflushed owner value",
  );
});

it("rejects a request still queued past its admission deadline before it enters or runs", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  const work = vi.fn(async () => "ran");
  const held = database.scope(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
  // Queue time counts: the holder outlasts this request's whole deadline.
  const expired = database.scope(work, undefined, { admitBefore: monotonicNow() + 40 });
  await expect(expired).rejects.toMatchObject({
    name: "StoreAdmissionExpiredError",
    code: "HOST_STORE_ADMISSION_EXPIRED",
    admitted: false,
  });
  await held;
  expect(work).not.toHaveBeenCalled();
  // The queue moves on and a later request is unaffected.
  await expect(database.scope(async () => "next")).resolves.toBe("next");
});

it("never interrupts a request that was admitted before its deadline", async () => {
  const database = new StoreDatabase(":memory:");
  await database.ready;
  cleanups.push(() => database.close());
  const admitted = database.scope(
    () => new Promise<string>((resolve) => setTimeout(() => resolve("finished"), 120)),
    undefined,
    { admitBefore: monotonicNow() + 60 },
  );
  await expect(admitted).resolves.toBe("finished");
});

it("refuses an expired transaction before BEGIN and before its queue admission", async () => {
  const { store } = await fixture();
  const exec = vi.spyOn(store.db, "exec");
  const body = vi.fn();
  await expect(
    store.transaction(body, "critical", { admitBefore: monotonicNow() - 1 }),
  ).rejects.toMatchObject({ name: "StoreAdmissionExpiredError", admitted: false });
  // The same deadline lapsing while queued behind another owner.
  const release = gate();
  const holder = store.db.scope(() => release.promise);
  const queued = store.transaction(body, "critical", { admitBefore: monotonicNow() + 30 });
  const rejected = expect(queued).rejects.toMatchObject({ name: "StoreAdmissionExpiredError" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  release.resolve();
  await holder;
  await rejected;
  expect(body).not.toHaveBeenCalled();
  expect(exec.mock.calls.filter(([sql]) => /BEGIN/i.test(String(sql)))).toEqual([]);
  // An unexpired deadline still commits normally.
  await expect(
    store.transaction(async () => "ok", "critical", { admitBefore: monotonicNow() + 5_000 }),
  ).resolves.toBe("ok");
});

async function stageTimingProbe(store: HostStore) {
  await store.transaction(async () => {
    await store.db.exec("CREATE TABLE IF NOT EXISTS stage_probe (value TEXT)");
    await store.db.prepare("INSERT INTO stage_probe VALUES (?)").run("secret-payload-value");
  }, "critical");
}
it("logs bounded stage timings: queue wait, guard, worker execution, round trip and commit", async () => {
  const { store } = await fixture();
  store.db.slowScopeMs = 0;
  const lines: string[] = [];
  store.db.scopeWarn = (message, detail) => lines.push(`${message} ${detail ?? ""}`);
  await store.db.withAuthorization(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return true;
    },
    () => stageTimingProbe(store),
  );
  const line = lines.find((text) => /requests=([5-9]|\d{2,})$/.test(text));
  expect(line).toMatch(
    /queue=\d+ms guard=\d+ms worker=\d+ms roundTrip=\d+ms commit=\d+ms requests=\d+$/,
  );
  expect(Number(/guard=(\d+)ms/.exec(line!)?.[1])).toBeGreaterThanOrEqual(25);
  const roundTrip = Number(/roundTrip=(\d+)ms/.exec(line!)?.[1]);
  expect(Number(/worker=(\d+)ms/.exec(line!)?.[1])).toBeLessThanOrEqual(roundTrip);
  // Numbers only: no SQL text, bound parameters or payloads.
  expect(line).not.toMatch(/stage_probe|secret-payload-value|INSERT|BEGIN/);
});
