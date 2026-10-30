import { settledTail } from "./promiseQueue";

type Input = { sessionId: string; cwd: string };
type Live = { cwd: string; stale: boolean };

/** Generation checks and cwd recycling are common; transport startup remains caller-owned. */
export function createRecyclingLifecycle<I extends Input, L extends Live>(policy: {
  epochs: Map<string, number>;
  queue: Map<string, Promise<void>>;
  live: Map<string, L>;
  resume: Map<string, unknown>;
  teardown: (live: L) => Promise<void>;
  start: (input: I, epoch: number) => Promise<L>;
  prepare?: (
    input: I,
    epoch: number,
  ) => {
    start: () => Promise<L>;
    retire: (error: unknown) => Promise<never>;
  };
  supersededMessage: string;
}) {
  const queue = (input: I, recycle: boolean): Promise<L> => {
    const epoch = policy.epochs.get(input.sessionId) ?? 0;
    const previous = policy.queue.get(input.sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if ((policy.epochs.get(input.sessionId) ?? 0) !== epoch)
        throw new Error(policy.supersededMessage);
      const live = policy.live.get(input.sessionId);
      if (live && (!recycle || (!live.stale && live.cwd === input.cwd))) return live;
      // Transport admission is synchronous and precedes any mutation of A.
      // The prepared owner can be cancelled while its exact predecessor drains.
      const prepared = policy.prepare?.(input, epoch);
      try {
        if (live) {
          if (live.cwd !== input.cwd) policy.resume.delete(input.sessionId);
          await policy.teardown(live);
        }
        if (prepared && (policy.epochs.get(input.sessionId) ?? 0) !== epoch)
          throw new Error(policy.supersededMessage);
        return await (prepared ? prepared.start() : policy.start(input, epoch));
      } catch (error) {
        if (prepared) return prepared.retire(error);
        throw error;
      }
    });
    policy.queue.set(input.sessionId, settledTail(next));
    return next;
  };
  const ensure = async (input: I, recycle: boolean): Promise<L> => {
    const live = policy.live.get(input.sessionId);
    if (live && (!recycle || (!live.stale && live.cwd === input.cwd))) return live;
    return queue(input, recycle);
  };
  return { ensure };
}
