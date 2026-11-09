import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { installAssistantObservationProducers } from "./assistant-observation-producers";
import { AssistantObservationPages } from "./assistant-observation-pages";

it("requires delivered, unchanged, ordered pages under the same grant before completing a baseline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "observation-pages-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    await store.db.exec(
      "CREATE TABLE social_records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE social_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,value TEXT NOT NULL)",
    );
    const journal = new AssistantObservationJournal(store);
    await installAssistantObservationProducers(store, journal);
    for (let i = 0; i < 31; i++)
      await store.db
        .prepare("INSERT INTO social_records VALUES(?,?,?)")
        .run("thread", `row-${i}`, JSON.stringify({ accountId: "account" }));
    const pages = new AssistantObservationPages(store);
    const scope = { threadId: "room", accountId: "account", version: "v1", consumer: "consumer" };
    const first = await pages.page(scope, 0, undefined, () => true);
    expect(first.complete).toBe(false);
    const firstValue = first.value as { snapshotId: string; offset: number; nextOffset: number };
    await expect(pages.page(scope, 8, firstValue.snapshotId, () => true)).rejects.toThrow(
      "in order",
    );
    await pages.delivered(scope, firstValue.snapshotId, 0, 8, () => true);
    await pages.delivered(scope, firstValue.snapshotId, 0, 8, () => true);
    await expect(
      pages.page({ ...scope, version: "v2" }, 8, firstValue.snapshotId, () => true),
    ).rejects.toThrow("changed or expired");
    await expect(pages.page(scope, 8, firstValue.snapshotId, () => false)).rejects.toThrow(
      "access changed",
    );
    let offset = 8;
    while (offset < 31) {
      const result = await pages.page(scope, offset, firstValue.snapshotId, () => true);
      const value = result.value as { offset: number; nextOffset: number };
      await pages.delivered(
        scope,
        firstValue.snapshotId,
        value.offset,
        value.nextOffset,
        () => true,
      );
      offset = value.nextOffset;
    }
    expect((await pages.page(scope, 31, firstValue.snapshotId, () => true)).complete).toBe(true);
    const changed = await pages.page(scope, 0, undefined, () => true);
    const changedId = (changed.value as { snapshotId: string }).snapshotId;
    await store.db
      .prepare("UPDATE social_records SET value=? WHERE id=? AND kind='thread'")
      .run(JSON.stringify({ accountId: "account", status: "updated" }), "row-0");
    await expect(pages.delivered(scope, changedId, 0, 8, () => true)).rejects.toThrow(
      "baseline changed",
    );
    await store.db.prepare("DELETE FROM social_records").run();
    const empty = await pages.page(scope, 0, undefined, () => true);
    expect(empty.complete).toBe(false);
    const emptyId = (empty.value as { snapshotId: string }).snapshotId;
    expect((await pages.page(scope, 0, emptyId, () => true)).complete).toBe(false);
    await pages.delivered(scope, emptyId, 0, 0, () => true);
    expect((await pages.page(scope, 0, emptyId, () => true)).complete).toBe(true);
    await store.transaction(async () => {
      for (let i = 0; i < 265; i++)
        await store.db
          .prepare("INSERT INTO social_records VALUES(?,?,?)")
          .run("thread", `large-${i}`, JSON.stringify({ accountId: "account" }));
    });
    const large = await pages.page(scope, 0, undefined, () => true);
    const largeId = (large.value as { snapshotId: string }).snapshotId;
    let position = 0;
    while (position < 265) {
      const part = position === 0 ? large : await pages.page(scope, position, largeId, () => true);
      const value = part.value as { offset: number; nextOffset: number };
      await pages.delivered(scope, largeId, value.offset, value.nextOffset, () => true);
      position = value.nextOffset;
    }
    expect((await pages.page(scope, 265, largeId, () => true)).complete).toBe(true);
    await store.transaction(async () => {
      for (let i = 265; i < 2049; i++)
        await store.db
          .prepare("INSERT INTO social_records VALUES(?,?,?)")
          .run("thread", `large-${i}`, JSON.stringify({ accountId: "account" }));
    });
    const capped = await pages.page(scope, 0, undefined, () => true);
    expect(capped.complete).toBe(false);
    expect((capped.value as { reason: string }).reason).toContain("2048-row");
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
