import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { Block } from "../../src/features/sessions/model/session";
import type { HarnessEvent } from "../../src/integrations/harness/core/types";
import { writeFileAtomic } from "../storage/atomic-write";

/** A running turn's state and the provider events applied to it since its last accepted write. */
export interface LiveBatch {
  value: HostSession;
  /** `value` as it was before the first event of `events` was applied. */
  base?: HostSession;
  events: HarnessEvent[];
  blockChanges?: Map<string, Block | null>;
}

/** Fields every save assigns itself; neither side of a rebase owns them. */
const SAVE_OWNED = new Set(["session", "revision", "updatedAt", "blockRevisions"]);

/** Equality of what a save would persist: JSON drops undefined fields and key order. */
const samePersisted = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
};

/**
 * The live state re-expressed on `head`, or undefined when that is not provable.
 *
 * Provider events read and replace only `session`. When the batch was built purely by events
 * on `base` (no save moved the revision in between) and `head.session` persists the same as
 * `base.session`, applying the same events to `head` yields exactly `value.session`. The
 * remaining fields merge three-way; a field both sides changed to different values refuses
 * the rebase.
 */
export function rebaseLiveBatch(live: LiveBatch, head: HostSession): HostSession | undefined {
  const { base, value } = live;
  if (
    !base ||
    base.revision !== value.revision ||
    head.revision <= value.revision ||
    head.session.id !== value.session.id ||
    head.projectId !== value.projectId ||
    head.runId !== value.runId ||
    head.status !== "running" ||
    value.status !== "running" ||
    head.authorityGeneration !== value.authorityGeneration ||
    !samePersisted(head.session, base.session)
  )
    return undefined;
  const merged: Record<string, unknown> = { ...head, session: value.session };
  const field = (side: HostSession, key: string) =>
    (side as unknown as Record<string, unknown>)[key];
  for (const key of new Set([...Object.keys(base), ...Object.keys(value), ...Object.keys(head)])) {
    if (SAVE_OWNED.has(key)) continue;
    const [before, mine, theirs] = [field(base, key), field(value, key), field(head, key)];
    if (samePersisted(mine, before) || samePersisted(mine, theirs)) continue;
    if (!samePersisted(theirs, before)) return undefined;
    if (mine === undefined) delete merged[key];
    else merged[key] = mine;
  }
  return merged as unknown as HostSession;
}

const fileComponent = (id: string) =>
  /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : createHash("sha256").update(id).digest("hex");

/**
 * Durably writes the exact unwritten batch beside the Host's other recovery data, reports it
 * once without transcript content and returns the file path. The name is derived from the
 * batch, so preserving it again replaces the same file instead of accumulating copies.
 */
export async function preserveLiveBatch(
  dataDir: string,
  live: LiveBatch,
  reason: "revision-conflict" | "storage-constraint" | "shutdown",
  headRevision?: number,
): Promise<string> {
  const { value, events } = live;
  const digest = createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 16);
  const path = join(
    // An in-memory store has no data directory of its own.
    dataDir === "." ? join(tmpdir(), "bycoda-host-memory") : dataDir,
    "session-recovery",
    fileComponent(value.session.id),
    `unwritten-${value.revision + 1}-${digest}.json`,
  );
  await writeFileAtomic(
    path,
    JSON.stringify({
      kind: "bycoda.session.unwritten-batch",
      version: 1,
      reason,
      sessionId: value.session.id,
      runId: value.runId,
      liveRevision: value.revision,
      headRevision,
      preservedAt: Date.now(),
      events,
      // The transcript blocks these events produced, as the turn last held them.
      blocks: live.blockChanges
        ? [...live.blockChanges.values()].filter((block) => block !== null)
        : value.session.blocks,
    }),
  );
  console.error(
    `Session ${value.session.id}: ${events.length} unwritten event(s) built on revision ${value.revision} could not be written (${reason}${
      headRevision === undefined ? "" : `, persisted revision ${headRevision}`
    }). Preserved at ${path}.`,
  );
  return path;
}

/**
 * Settles a refused batch without losing it: rebased onto `head` and written through `write`,
 * or preserved as evidence with the live state reset to `head`. Returns false when the batch
 * was preserved instead of written; a failed write or preservation leaves `live` untouched.
 */
export async function resolveRevisionConflict(
  live: LiveBatch,
  head: HostSession,
  dataDir: string,
  write: (value: HostSession, event: unknown) => Promise<HostSession>,
): Promise<boolean> {
  const rebased = rebaseLiveBatch(live, head);
  if (rebased) live.value = await write(rebased, { type: "events", events: live.events });
  else {
    await preserveLiveBatch(dataDir, live, "revision-conflict", head.revision);
    live.value = head;
  }
  live.base = undefined;
  live.events = [];
  live.blockChanges = new Map();
  return rebased !== undefined;
}
