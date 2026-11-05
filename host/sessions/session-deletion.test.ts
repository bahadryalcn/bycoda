import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore } from "../store";
import { HostEngine } from "../engine";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-deletion-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  cleanups.push(() => store.close());
  const project = await store.addProject(directory, "Deletion regression");
  const value: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 100,
    session: {
      id: "deleted-chat",
      cwd: directory,
      title: "Deleted chat",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "user", role: "user", text: "Retained transcript" }],
    },
  };
  await store.save(value, { type: "created" });
  return {
    get store() {
      return store;
    },
    value,
    async reopen() {
      await store.close();
      store = new HostStore(path);
      await store.ready;
    },
  };
}

describe("durable conversation deletion", () => {
  it("rejects retained snapshots after delete and after reopening the Host store", async () => {
    const f = await fixture();
    await f.store.deleteSession(f.value.session.id);
    for (const reopen of [false, true]) {
      if (reopen) await f.reopen();
      for (const options of [{}, { deferred: true }, { journal: true }]) {
        await expect(
          f.store.save({ ...f.value, revision: 99 }, { type: "late-save" }, options),
        ).rejects.toThrow(/deleted/);
      }
      expect(await f.store.summaries(f.value.projectId)).toEqual([]);
      await expect(f.store.session(f.value.session.id)).rejects.toThrow(/not found/);
    }
    const replacement = { ...f.value, session: { ...f.value.session, id: "new-chat" } };
    await f.store.save(replacement, { type: "created" });
    expect((await f.store.summaries(f.value.projectId)).map((row) => row.id)).toEqual(["new-chat"]);
  });

  it("retires pending streamed checkpoints with the deletion", async () => {
    const f = await fixture();
    await f.store.save({ ...f.value, revision: 2 }, { type: "delta" }, { deferred: true });
    await f.store.deleteSession(f.value.session.id);
    await f.reopen();
    expect(await f.store.summaries(f.value.projectId)).toEqual([]);
    await expect(f.store.save(f.value, { type: "late-provider-output" })).rejects.toThrow(
      /deleted/,
    );
  });

  it("refuses a stale desktop adoption after restarting without binding a provider", async () => {
    const f = await fixture();
    await f.store.deleteSession(f.value.session.id);
    await f.reopen();
    const provider = {
      send: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    };
    const engine = new HostEngine(f.store, { codex: provider });
    cleanups.push(() => engine.close());
    await engine.ready;
    await expect(
      engine.adoptSession({
        ...f.value,
        session: { ...f.value.session, providerSessionId: "retained-provider-id" },
      }),
    ).rejects.toThrow(/deleted/);
    expect(provider.bind).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    expect(await f.store.summaries(f.value.projectId)).toEqual([]);
  });

  it("rolls back the deletion fence when the deletion transaction fails", async () => {
    const f = await fixture();
    await expect(
      f.store.transaction(async () => {
        await f.store.deleteSession(f.value.session.id);
        throw new Error("injected failure");
      }),
    ).rejects.toThrow("injected failure");
    await f.reopen();
    await f.store.save({ ...f.value, revision: 2 }, { type: "continued" });
    expect((await f.store.session(f.value.session.id)).revision).toBe(2);
  });

  it("does not create a deletion fence when a running chat cannot be deleted", async () => {
    const f = await fixture();
    await f.store.save({ ...f.value, status: "running", revision: 2 }, { type: "started" });
    await expect(f.store.deleteSession(f.value.session.id)).rejects.toThrow(/Stop this session/);
    await f.store.save({ ...f.value, revision: 3 }, { type: "finished" });
    expect((await f.store.session(f.value.session.id)).revision).toBe(3);
  });
});
