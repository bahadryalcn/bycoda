import { expect, it } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore } from "../store";

it("rolls back every batched checkpoint write when a later statement fails", async () => {
  const store = new HostStore(":memory:");
  try {
    const project = await store.addProject("/sparse", "Sparse");
    const base = await store.save(
      {
        projectId: project.id,
        revision: 1,
        status: "running",
        updatedAt: 100,
        session: {
          id: "sparse",
          cwd: "/tmp",
          title: "sparse",
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
          blocks: [{ id: "a", role: "assistant", text: "before" }],
        },
      } as HostSession,
      {},
    );
    const block = { ...base.session.blocks[0], text: "after" };
    const next = await store.save(
      { ...base, revision: 2, session: { ...base.session, blocks: [block] } },
      { edited: [block.id] },
      { deferred: true, blockChanges: new Map([[block.id, block]]) },
    );
    const flush = () =>
      (store as unknown as { flushPending(id: string): Promise<void> }).flushPending("sparse");
    await store.db.exec(
      "CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON session_state BEGIN SELECT RAISE(ABORT, 'checkpoint fixture'); END",
    );
    await expect(flush()).rejects.toThrow("checkpoint fixture");
    expect(await store.db.prepare("SELECT * FROM session_journal").all()).toEqual([]);
    expect(await store.db.prepare("SELECT * FROM session_journal_blocks").all()).toEqual([]);
    expect(
      (await store.db.prepare("SELECT revision FROM events ORDER BY revision").all()).map(
        (row) => row.revision,
      ),
    ).toEqual([1]);
    await store.db.exec("DROP TRIGGER fail_checkpoint");
    await flush();
    expect(
      Number((await store.db.prepare("SELECT revision FROM session_journal").get())!.revision),
    ).toBe(next.revision);
  } finally {
    await store.close();
  }
});
