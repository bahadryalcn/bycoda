import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant } from "../service";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

it("serves the per-message voice action lookup from an owner-message index, not a table scan", async () => {
  const folder = mkdtempSync(join(tmpdir(), "assistant-voice-owner-index-"));
  const store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const service = new HostAssistant(store, {});
  await service.ready;
  closes.push(async () => {
    await service.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const plan = (
    await store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value FROM assistant_voice_contexts WHERE json_extract(value,'$.ownerMessageId')=? ORDER BY json_extract(value,'$.updatedAt') DESC LIMIT 10",
      )
      .all("message")
  )
    .map((row) => String(row.detail))
    .join("\n");
  expect(plan).toContain("assistant_voice_contexts_owner");
  expect(plan).not.toMatch(/SCAN assistant_voice_contexts(?! USING)/);
});
