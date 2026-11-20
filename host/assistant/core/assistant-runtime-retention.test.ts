import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantRepository } from "../repository";
import { purgeOrphanedMessageRuntime } from "./assistant-runtime-retention";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

it("never scans assistant_runtime with LIKE, which cannot use the key index", () => {
  const offenders = sources(join(__dirname, "..")).filter((path) =>
    /assistant_runtime[^"`]*\bLIKE\b/i.test(readFileSync(path, "utf8")),
  );
  expect(offenders).toEqual([]);
});

it("reclaims only annotation rows whose message was purged and that are past the grace period", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-runtime-retention-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  closes.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const old = 1000,
    now = 10_000;
  const row = (id: string, updatedAt: number) => ({
    id,
    version: 0,
    createdAt: updatedAt,
    updatedAt,
    value: {},
  });
  await repository.put("messages", { id: "live", version: 0, createdAt: old, updatedAt: old });
  for (const id of [
    "messageScopeSources:gone",
    "messageRoomTurn:gone",
    "messageScopeVoice:gone",
    "messageScopeSources:fresh",
    "messageScopeSources:live",
    "room-turn:gone",
    "notification:gone",
  ])
    await repository.put("runtime", row(id, id.endsWith(":fresh") ? now : old));

  expect(await purgeOrphanedMessageRuntime(store.db, now - 100)).toBe(2);
  const left = (await store.db.prepare("SELECT id FROM assistant_runtime ORDER BY id").all()).map(
    (item) => String(item.id),
  );
  expect(left).toEqual([
    "messageScopeSources:fresh",
    "messageScopeSources:live",
    "messageScopeVoice:gone",
    "notification:gone",
    "room-turn:gone",
  ]);
});
