import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SessionLifecycleStore, type SessionLifecycleRecord } from "./lifecycle-store";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "lifecycle-batch-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const settle = (current: SessionLifecycleRecord) => ({
  next: { ...current, state: "settled" as const, settledAt: 1, settledBy: "auto" as const },
  result: current.sessionId,
});

it("a failed batch write leaves the saved rows untouched and the next batch lands", async () => {
  const store = new SessionLifecycleStore(directory);
  await store.updateMany(["a"], settle);
  expect((await store.list()).map((row) => row.sessionId)).toEqual(["a"]);

  // A directory in place of the state file makes the atomic rename fail.
  const file = join(directory, "sessions", "lifecycle.json");
  await rm(file, { force: true });
  await mkdir(file);
  await expect(store.updateMany(["b", "c"], settle)).rejects.toThrow();
  expect((await store.list()).map((row) => row.sessionId)).toEqual(["a"]);

  await rm(file, { recursive: true, force: true });
  expect(await store.updateMany(["b", "c"], settle)).toEqual(["b", "c"]);
  expect((await store.list()).map((row) => row.sessionId)).toEqual(["a", "b", "c"]);
});

it("reads answer from the saved snapshot while a batch write is in flight", async () => {
  const store = new SessionLifecycleStore(directory);
  await store.updateMany(["a"], settle);
  const batch = store.updateMany(
    Array.from({ length: 200 }, (_, index) => `s${index}`),
    settle,
  );
  // The saved rows stay readable and unchanged until the whole batch has landed.
  expect((await store.list()).map((row) => row.sessionId)).toEqual(["a"]);
  await batch;
  expect(await store.list()).toHaveLength(201);
});
