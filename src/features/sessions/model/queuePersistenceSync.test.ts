import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createQueuePersistenceSync,
  QUEUE_RETRY_LIMIT,
  QUEUE_RETRY_MAX_MS,
  queueRetryDelay,
} from "./queuePersistenceSync";
import type { QueuedMessage } from "./session";

type Row = { id: string; cwd: string; queuedMessages?: QueuedMessage[]; inboxAsk?: never };

const queueOf = (...texts: string[]): QueuedMessage[] =>
  texts.map((text) => ({ id: text, text, attachments: [] }));

let sessions: Row[];
let writes: Array<{
  id: string;
  queue: QueuedMessage[] | undefined;
  resolve: () => void;
  reject: (error: Error) => void;
}>;
let notices: boolean[];
let retry: (() => void) | undefined;

function create() {
  const sync = createQueuePersistenceSync({
    sessions: () => sessions as never,
    write: (id, queue) =>
      new Promise<void>((resolve, reject) => {
        writes.push({ id, queue, resolve, reject });
      }),
    onUnsavedChange: (unsaved, retryAll) => {
      notices.push(unsaved);
      retry = retryAll;
    },
  });
  sync.start();
  return sync;
}

async function settle(index: number, outcome: "ok" | Error) {
  if (outcome === "ok") writes[index].resolve();
  else writes[index].reject(outcome);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  sessions = [{ id: "a", cwd: "/project", queuedMessages: queueOf("one") }];
  writes = [];
  notices = [];
  retry = undefined;
});
afterEach(() => vi.useRealTimers());

it("retries a failed write on a backoff timer without another store change", async () => {
  create();
  expect(writes).toHaveLength(1);
  await settle(0, new Error("disk full"));
  expect(writes).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  expect(writes).toHaveLength(2);
  expect(writes[1].queue).toBe(sessions[0].queuedMessages);
  await settle(1, new Error("disk full"));
  await vi.advanceTimersByTimeAsync(queueRetryDelay(2) - 1);
  expect(writes).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(writes).toHaveLength(3);
});

it("doubles the delay up to a cap", () => {
  expect(queueRetryDelay(1)).toBe(1_000);
  expect(queueRetryDelay(3)).toBe(4_000);
  expect(queueRetryDelay(20)).toBe(QUEUE_RETRY_MAX_MS);
});

it("warns only after repeated failures and clears the notice once a retry is saved", async () => {
  create();
  await settle(0, new Error("busy"));
  expect(notices).toEqual([]);
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  await settle(1, new Error("busy"));
  expect(notices).toEqual([true]);
  await vi.advanceTimersByTimeAsync(queueRetryDelay(2));
  await settle(2, "ok");
  expect(notices).toEqual([true, false]);
  await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MAX_MS * 2);
  expect(writes).toHaveLength(3);
});

it("writes only the newest queue: an edit cancels the old retry and its late failure is ignored", async () => {
  const sync = create();
  const edited = queueOf("one", "two");
  sessions = [{ ...sessions[0], queuedMessages: edited }];
  // A newer edit arrives while the first write is still in flight.
  sync.sync();
  expect(writes).toHaveLength(2);
  expect(writes[1].queue).toBe(edited);
  await settle(0, new Error("old request failed"));
  await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MAX_MS * 2);
  expect(writes).toHaveLength(2);
  await settle(1, "ok");
  expect(notices).toEqual([]);
});

it("never retries a queue that was changed or sent after the failure", async () => {
  const sync = create();
  await settle(0, new Error("busy"));
  const sent = queueOf();
  sessions = [{ ...sessions[0], queuedMessages: sent }];
  sync.sync();
  expect(writes).toHaveLength(2);
  expect(writes[1].queue).toBe(sent);
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1) * 4);
  // The pending retry for the delivered message is gone: only the empty queue was written.
  expect(writes).toHaveLength(2);
  await settle(1, "ok");
  expect(writes.map((write) => write.queue?.length)).toEqual([1, 0]);
});

it("retries clearing a queue that was emptied but not saved", async () => {
  const sync = create();
  await settle(0, "ok");
  const emptied = queueOf();
  sessions = [{ ...sessions[0], queuedMessages: emptied }];
  sync.sync();
  await settle(1, new Error("busy"));
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  expect(writes).toHaveLength(3);
  expect(writes[2].queue).toBe(emptied);
});

it("stops retrying a session that was removed", async () => {
  const sync = create();
  await settle(0, new Error("busy"));
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  await settle(1, new Error("busy"));
  expect(notices).toEqual([true]);
  sessions = [];
  sync.sync();
  expect(notices).toEqual([true, false]);
  await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MAX_MS * 2);
  expect(writes).toHaveLength(2);
});

it("does not write a session with nothing queued and nothing ever written", () => {
  sessions = [{ id: "a", cwd: "/project" }];
  create();
  expect(writes).toHaveLength(0);
});

it("leaves remote sessions to their host", () => {
  sessions = [{ id: "a", cwd: "remote://host/project", queuedMessages: queueOf("one") }];
  create();
  expect(writes).toHaveLength(0);
});

it("gives up automatic retries after the limit and a manual retry starts a new round", async () => {
  create();
  for (let attempt = 0; attempt <= QUEUE_RETRY_LIMIT; attempt += 1) {
    await settle(attempt, new Error("busy"));
    await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MAX_MS);
  }
  expect(writes).toHaveLength(QUEUE_RETRY_LIMIT + 1);
  retry?.();
  expect(writes).toHaveLength(QUEUE_RETRY_LIMIT + 2);
  await settle(QUEUE_RETRY_LIMIT + 1, "ok");
  expect(notices.at(-1)).toBe(false);
});

it("does not resend a pending write when retried by hand", async () => {
  create();
  await settle(0, new Error("busy"));
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  await settle(1, new Error("busy"));
  await vi.advanceTimersByTimeAsync(queueRetryDelay(2));
  expect(writes).toHaveLength(3);
  retry?.();
  expect(writes).toHaveLength(3);
});

it("keeps its state across stop and start, so a remount writes nothing twice", async () => {
  const sync = create();
  sync.stop();
  sync.start();
  expect(writes).toHaveLength(1);
  await settle(0, new Error("busy"));
  sync.stop();
  await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MAX_MS * 2);
  expect(writes).toHaveLength(1);
  sync.start();
  await vi.advanceTimersByTimeAsync(queueRetryDelay(1));
  expect(writes).toHaveLength(2);
});
