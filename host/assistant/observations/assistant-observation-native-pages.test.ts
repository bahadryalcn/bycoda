import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { AssistantObservationNativePages } from "./assistant-observation-native-pages";

it("requires every actual disclosure and a fresh matching Native snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-observation-pages-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    const journal = new AssistantObservationJournal(store);
    await journal.ready;
    const pages = new AssistantObservationNativePages(store);
    const scope = {
      threadId: "room",
      installationId: "native-one",
      generation: "privacy-v1",
      consumer: "room-note",
      source: "note" as const,
    };
    let revision = 1;
    const fetch = async (offset: number, expected?: string) => {
      const fingerprint = String(revision).repeat(64);
      if (expected && expected !== fingerprint) throw new Error("Native baseline changed");
      const total = 9,
        nextOffset = Math.min(offset + 8, total);
      return {
        fingerprint,
        offset,
        nextOffset,
        total,
        watermark: 3,
        sourceGap: true,
        entries: Array.from({ length: nextOffset - offset }, (_, i) => ({
          sourceId: `n${offset + i}`,
          revision,
        })),
      };
    };
    const first = await pages.page(scope, 0, undefined, fetch, () => true);
    expect(await pages.covered(scope)).toBe(false);
    const id = (first.value as { snapshotId: string }).snapshotId;
    await expect(pages.page(scope, 8, id, fetch, () => true)).rejects.toThrow("in order");
    await expect(
      pages.delivered({ ...scope, installationId: "native-two" }, id, 0, 8, () => true),
    ).rejects.toThrow("expired");
    await pages.delivered(scope, id, 0, 8, () => true);
    await pages.page(scope, 8, id, fetch, () => true);
    await pages.delivered(scope, id, 8, 9, () => true);
    revision = 2;
    await expect(pages.page(scope, 9, id, fetch, () => true)).rejects.toThrow("changed");
    revision = 1;
    expect(
      (
        await pages.page(
          scope,
          9,
          id,
          fetch,
          () => true,
          async () => {},
        )
      ).complete,
    ).toBe(true);
    expect(await pages.covered(scope)).toBe(true);
    expect(await pages.covered({ ...scope, generation: "privacy-v2" })).toBe(false);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("holds uncertain Server completion and never automatically repeats it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "server-observation-pages-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    const journal = new AssistantObservationJournal(store);
    await journal.ready;
    const pages = new AssistantObservationNativePages(store);
    const scope = {
      threadId: "room",
      installationId: "native-one",
      generation: "privacy-v1",
      consumer: "server-consumer",
      source: "server" as const,
    };
    const fetch = async () => ({
      fingerprint: "a".repeat(64),
      offset: 0,
      nextOffset: 0,
      total: 0,
      watermark: 5,
      sourceGap: true,
      entries: [],
    });
    const first = await pages.page(scope, 0, undefined, fetch, () => true);
    const id = (first.value as { snapshotId: string }).snapshotId;
    await pages.delivered(scope, id, 0, 0, () => true);
    let calls = 0;
    const finalize = async () => {
      calls++;
      throw new Error("lost response");
    };
    expect(await pages.page(scope, 0, id, fetch, () => true, finalize)).toMatchObject({
      complete: false,
    });
    expect(await pages.uncertain(scope)).toBe(true);
    expect(await pages.page(scope, 0, id, fetch, () => true, finalize)).toMatchObject({
      complete: false,
    });
    expect(calls).toBe(1);
    const fresh = await pages.page(scope, 0, undefined, fetch, () => true);
    const freshId = (fresh.value as { snapshotId: string }).snapshotId;
    await pages.delivered(scope, freshId, 0, 0, () => true);
    let finalized: { requestId: string; fingerprint: string; watermark: number } | undefined;
    expect(
      await pages.page(
        scope,
        0,
        freshId,
        fetch,
        () => true,
        async (request) => {
          finalized = request;
        },
      ),
    ).toMatchObject({ complete: true, value: { coverage: ["server"], pagesDelivered: true } });
    expect(finalized).toMatchObject({ fingerprint: "a".repeat(64), watermark: 5 });
    expect(await pages.uncertain(scope)).toBe(false);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
