import { afterEach, expect, it, vi } from "vitest";
import { AsyncResource } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { HostStore } from "./store";
import { RequestAuthorizationError, StoreDatabase } from "./store-db";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanups: Array<() => void | Promise<void>> = [];
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
  });
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
      });
      await Promise.resolve();
      throw new Error("rollback fixture");
    }),
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
    }),
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
