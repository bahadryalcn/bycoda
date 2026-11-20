import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("caps retained events at 10,000 without an OFFSET walk in the insert trigger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-cap-"));
  const store = new HostStore(join(dir, "host.db"));
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const journal = new AssistantObservationJournal(store);
  await journal.ready;
  const trigger = String(
    (
      await store.db
        .prepare("SELECT sql FROM sqlite_master WHERE name='assistant_observation_retention'")
        .get()
    )?.sql,
  );
  expect(trigger).not.toContain("OFFSET");
  const total = 10_050;
  await store.transaction(async () => {
    for (let index = 0; index < total; index++)
      await journal.append({
        source: "task",
        sourceId: `task-${index}`,
        sourceRevision: "1",
        change: "updated",
        projectIds: ["project-a"],
        occurredAt: 1,
      });
  });
  const row = await store.db
    .prepare(
      "SELECT count(*) AS n, min(sequence) AS low, max(sequence) AS high FROM assistant_observation_events",
    )
    .get();
  expect(Number(row?.n)).toBe(10_000);
  expect(Number(row?.high) - Number(row?.low)).toBe(9_999);
  expect(Number(row?.low)).toBe(total - 9_999);
}, 120_000);
