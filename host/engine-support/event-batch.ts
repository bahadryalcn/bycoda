import type { HarnessEvent } from "../../src/integrations/harness/core/types";
import type { Session } from "../../src/features/sessions/model/session";
import { applyHarnessEvents } from "../../src/integrations/harness/core/apply";
import { changedBlocks } from "../../src/features/sessions/model/blockChanges";
import type { LiveBatch } from "../sessions/live-batch-recovery";

// Streamed output is written in batches. Anything a user may need to act on
// (approvals, questions, errors, completion) is written immediately.
export const FLUSH_MS = 120;
export const BATCHED = new Set<string>([
  "message.delta",
  "reasoning.delta",
  "tool.updated",
  "agent.step",
  "status",
]);

/** One provider event waiting for its session's operation turn. */
export type PendingEvent = {
  runId: string;
  event: HarnessEvent;
  observedAt: number;
  /** Runs before the event is applied (accepted replay acknowledgements). */
  before?: () => Promise<void>;
};

type DeltaEvent = Extract<HarnessEvent, { type: "message.delta" | "reasoning.delta" }>;
export type DeltaItem = PendingEvent & { event: DeltaEvent };

/** Streaming text: its only side effect besides the transcript is `before`. */
export function isPlainDelta(item: PendingEvent): item is DeltaItem {
  return item.event.type === "message.delta" || item.event.type === "reasoning.delta";
}

/** Length of the run of plain deltas of one run id starting at `from`. */
export function plainDeltaRun(items: readonly PendingEvent[], from: number): number {
  let end = from;
  while (end < items.length && isPlainDelta(items[end]) && items[end].runId === items[from].runId)
    end++;
  return end - from;
}

/**
 * Apply a burst of deltas with one transcript copy. `events` holds what the
 * sequential path would have recorded: events with text, or all when the
 * transcript changed. `lastActivityAt` is the newest observation with text.
 */
export function applyDeltaBurst(
  session: Session,
  items: readonly DeltaItem[],
): { session: Session; events: HarnessEvent[]; lastActivityAt?: number } {
  const next = applyHarnessEvents(
    session,
    items.map((item) => item.event),
  );
  const changed = next !== session;
  const kept = items.filter((item) => changed || item.event.text.length > 0);
  const active = items.filter((item) => item.event.text.length > 0);
  return {
    session: next,
    events: kept.map((item) => item.event),
    lastActivityAt: active.length ? Math.max(...active.map((item) => item.observedAt)) : undefined,
  };
}

/** Records an applied burst on the running turn; false when nothing changed. */
function recordDeltaBurst(live: LiveBatch, runId: string, items: readonly DeltaItem[]): boolean {
  const burst = applyDeltaBurst(live.value.session, items);
  if (!burst.events.length) return false;
  if (live.blockChanges) {
    const changed = changedBlocks(live.value.session.blocks, burst.session.blocks);
    if (changed === undefined) live.blockChanges = undefined;
    else for (const [blockId, block] of changed) live.blockChanges.set(blockId, block);
  }
  if (!live.events.length) live.base = live.value;
  const previous = live.value.runActivity;
  const seen = previous?.runId === runId ? previous.lastActivityAt : 0;
  live.value = {
    ...live.value,
    session: burst.session,
    ...(burst.lastActivityAt === undefined
      ? {}
      : { runActivity: { runId, lastActivityAt: Math.max(burst.lastActivityAt, seen) } }),
  };
  live.events.push(...burst.events);
  return true;
}

/** Events queued for a session; the first one of a burst starts the drain. */
export class PendingEvents {
  private readonly queues = new Map<string, PendingEvent[]>();

  /** True when the caller must queue a drain, false when one is already waiting. */
  add(id: string, item: PendingEvent): boolean {
    const queue = this.queues.get(id);
    if (queue) queue.push(item);
    else this.queues.set(id, [item]);
    return !queue;
  }

  take(id: string): PendingEvent[] {
    const queue = this.queues.get(id) ?? [];
    this.queues.delete(id);
    return queue;
  }
}

type DrainHooks = {
  live: () => LiveBatch | undefined;
  assertAuthority: (generation: number | undefined) => Promise<unknown>;
  applyOne: (item: PendingEvent) => Promise<void>;
  /** A burst changed the transcript. */
  recorded: (runId: string) => void;
};

/**
 * Applies queued events in order. Consecutive deltas are one burst: one authority
 * check, one hook run and one transcript copy. A failing event does not drop the
 * rest; the first failure is rethrown after everything was attempted.
 */
export async function drainPendingEvents(
  items: readonly PendingEvent[],
  hooks: DrainHooks,
): Promise<void> {
  let failure: { error: unknown } | undefined;
  for (let index = 0; index < items.length;) {
    const item = items[index];
    const count = isPlainDelta(item) ? plainDeltaRun(items, index) : 1;
    index += count;
    try {
      const live = hooks.live();
      if (!live || live.value.runId !== item.runId) continue;
      await hooks.assertAuthority(live.value.authorityGeneration);
      if (!isPlainDelta(item)) {
        await item.before?.();
        await hooks.applyOne(item);
        continue;
      }
      const burst = items.slice(index - count, index).filter(isPlainDelta);
      // The same hook rides on every delta of a turn; once per burst is enough.
      for (const before of new Set(burst.map((entry) => entry.before))) await before?.();
      const current = hooks.live();
      if (current?.value.runId === item.runId && current.value.status === "running")
        if (recordDeltaBurst(current, item.runId, burst)) hooks.recorded(item.runId);
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}
