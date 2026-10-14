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
  supersededMessage: string;
}) {
  const queue = (input: I, recycle: boolean): Promise<L> => {
    const epoch = policy.epochs.get(input.sessionId) ?? 0;
    const previous = policy.queue.get(input.sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if ((policy.epochs.get(input.sessionId) ?? 0) !== epoch)
        throw new Error(policy.supersededMessage);
      const live = policy.live.get(input.sessionId);
      if (live) {
        if (!recycle || (!live.stale && live.cwd === input.cwd)) return live;
        if (live.cwd !== input.cwd) policy.resume.delete(input.sessionId);
        await policy.teardown(live);
      }
      return policy.start(input, epoch);
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
