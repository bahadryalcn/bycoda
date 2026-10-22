// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  canEnqueueRemoteMessage,
  enqueueRemoteMessage,
  EMPTY_REMOTE_QUEUE,
  REMOTE_QUEUE_MAX_MESSAGES,
} from "./remoteQueue";
import { pendingRemoteCommand, remoteOutboxIssues, savePendingRemoteCommand } from "./remoteOutbox";
import type { HostCommand } from "./protocol";
beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
const command: HostCommand = {
  type: "send",
  commandId: "one",
  sessionId: "s",
  text: "hello",
};
it("rejects another queue entry at the limit without truncating existing messages", () => {
  let queue = EMPTY_REMOTE_QUEUE;
  for (let index = 0; index < REMOTE_QUEUE_MAX_MESSAGES; index++)
    queue = enqueueRemoteMessage(queue, {
      id: String(index),
      text: "message",
      attachments: [],
    });
  const next = { id: "overflow", text: "preserved draft", attachments: [] };
  expect(canEnqueueRemoteMessage(queue, next)).toBe(false);
  expect(() => enqueueRemoteMessage(queue, next)).toThrow("full");
  expect(queue.messages).toHaveLength(REMOTE_QUEUE_MAX_MESSAGES);
});
it("keeps expired requests visible for recovery instead of replaying beyond host receipt retention", () => {
  vi.useFakeTimers();
  savePendingRemoteCommand("p", "host", command);
  vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000);
  expect(pendingRemoteCommand("p", "host", "s")).toBeUndefined();
  expect(remoteOutboxIssues("p", "host")).toHaveLength(1);
  expect(localStorage.length).toBe(1);
  vi.useRealTimers();
});
it("limits serialized outbox data before accepting the composer draft", () => {
  expect(() =>
    savePendingRemoteCommand("p", "host", {
      ...command,
      text: "x".repeat(2 * 1024 * 1024),
    }),
  ).toThrow("large");
  expect(localStorage.length).toBe(0);
});

it("refuses another outbox entry without erasing pending commands", () => {
  for (let index = 0; index < 100; index++) {
    savePendingRemoteCommand("p", "host", {
      ...command,
      commandId: `pending-${index}`,
      sessionId: `s-${index}`,
    });
  }
  expect(() =>
    savePendingRemoteCommand("p", "host", {
      ...command,
      commandId: "overflow",
      sessionId: "extra",
    }),
  ).toThrow();
  expect(pendingRemoteCommand("p", "host", "s-0")?.commandId).toBe("pending-0");
  expect(localStorage.length).toBe(100);
});
