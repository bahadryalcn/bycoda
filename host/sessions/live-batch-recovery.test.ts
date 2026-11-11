import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { HarnessEvent } from "../../src/integrations/harness/core/types";
import {
  preserveLiveBatch,
  rebaseLiveBatch,
  resolveRevisionConflict,
  type LiveBatch,
} from "./live-batch-recovery";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const base = {
  projectId: "project",
  revision: 4,
  status: "running",
  runId: "run",
  updatedAt: 100,
  session: {
    id: "session",
    cwd: "/work",
    title: "Title",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    blocks: [{ id: "a", role: "user", text: "Question" }],
  },
} as unknown as HostSession;

const events: HarnessEvent[] = [{ type: "message.delta", text: "Answer" }];

/** The turn applied `events` to `base`: one new block and its activity stamp. */
function batch(): LiveBatch {
  const reply = { id: "b", role: "assistant" as const, text: "Answer" };
  return {
    base,
    value: {
      ...base,
      runActivity: { runId: "run", lastActivityAt: 150 },
      session: { ...base.session, blocks: [...base.session.blocks, reply] },
    },
    events,
    blockChanges: new Map([[reply.id, reply]]),
  };
}

it("re-expresses the live state on a head whose session is unchanged and keeps both sides", () => {
  const live = batch();
  // The other writer went through JSON and touched only fields outside the session.
  const head = {
    ...(JSON.parse(JSON.stringify(base)) as HostSession),
    revision: 5,
    updatedAt: 120,
    pinned: true,
  };
  expect(rebaseLiveBatch(live, head)).toEqual({
    ...head,
    runActivity: live.value.runActivity,
    session: live.value.session,
  });
});

it.each<[string, (live: LiveBatch) => HostSession]>([
  [
    "the head changed the transcript",
    () => ({ ...base, revision: 5, session: { ...base.session, title: "Other" } }),
  ],
  [
    "both sides changed the same field differently",
    () => ({ ...base, revision: 5, runActivity: { runId: "run", lastActivityAt: 999 } }),
  ],
  ["the head is not ahead of the live turn", () => ({ ...base })],
  ["the head belongs to another run", () => ({ ...base, revision: 5, runId: "other" })],
  ["the head is no longer running", () => ({ ...base, revision: 5, status: "idle" })],
  [
    "a save moved the live revision inside the batch",
    (live) => {
      live.value = { ...live.value, revision: 5 };
      return { ...base, revision: 6 };
    },
  ],
  [
    "the batch has no recorded starting point",
    (live) => {
      live.base = undefined;
      return { ...base, revision: 5 };
    },
  ],
])("refuses a rebase when %s", (_name, arrange) => {
  const live = batch();
  expect(rebaseLiveBatch(live, arrange(live))).toBeUndefined();
});

it("preserves the exact batch in one readable file and resets the live turn to the head", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "bycoda-live-batch-"));
  directories.push(dataDir);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const live = batch();
  const head = { ...base, revision: 5, session: { ...base.session, title: "Other" } };
  const write = vi.fn();

  expect(await resolveRevisionConflict(live, head, dataDir, write)).toBe(false);

  expect(write).not.toHaveBeenCalled();
  expect(live).toMatchObject({ value: head, events: [], base: undefined });
  const directory = join(dataDir, "session-recovery", "session");
  const [file] = readdirSync(directory);
  expect(JSON.parse(readFileSync(join(directory, file), "utf8"))).toMatchObject({
    kind: "bycoda.session.unwritten-batch",
    reason: "revision-conflict",
    sessionId: "session",
    runId: "run",
    liveRevision: 4,
    headRevision: 5,
    events,
    blocks: [{ id: "b", role: "assistant", text: "Answer" }],
  });
  expect(errors).toHaveBeenCalledOnce();
  expect(String(errors.mock.calls[0][0])).not.toContain("Answer");

  // The same batch preserved again replaces its file instead of adding another.
  const again = batch();
  expect(dirname(await preserveLiveBatch(dataDir, again, "shutdown"))).toBe(directory);
  expect(readdirSync(directory)).toEqual([file]);
});

it("keeps the batch in memory when the rebased write fails", async () => {
  const live = batch();
  const head = { ...base, revision: 5, pinned: true };
  const failure = new Error("write failed");
  await expect(
    resolveRevisionConflict(live, head, "unused", () => Promise.reject(failure)),
  ).rejects.toBe(failure);
  expect(live.events).toBe(events);
  expect(live.base).toBe(base);

  const saved = { ...head, revision: 6 };
  expect(await resolveRevisionConflict(live, head, "unused", async () => saved)).toBe(true);
  expect(live).toMatchObject({ value: saved, events: [], base: undefined });
});
