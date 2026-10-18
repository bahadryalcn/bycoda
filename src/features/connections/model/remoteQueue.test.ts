import { describe, expect, it } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import {
  EMPTY_REMOTE_QUEUE,
  REMOTE_QUEUE_MAX_BYTES,
  editRemoteMessage,
  enqueueRemoteMessage,
  nextRemoteQueuedMessage,
  pauseRemoteQueue,
  queueSessionFields,
  releaseRemoteQueue,
  removeRemoteMessage,
  reorderRemoteMessages,
  sentRemoteMessage,
  setRemoteEditing,
  shouldQueueRemoteMessage,
  type RemoteQueue,
} from "./remoteQueue";

const draft = (id: string, text = id) => ({ id, text, attachments: [] });
const queueOf = (...ids: string[]): RemoteQueue =>
  ids.reduce((queue, id) => enqueueRemoteMessage(queue, draft(id)), EMPTY_REMOTE_QUEUE);

describe("queue transitions", () => {
  it("rejects over-budget edits atomically, including the other rows and attachment data", () => {
    const original = setRemoteEditing(queueOf("a", "b"), "a");
    const oversized = "x".repeat(Math.floor(REMOTE_QUEUE_MAX_BYTES / 3) + 1);
    expect(() => enqueueRemoteMessage(EMPTY_REMOTE_QUEUE, draft("large", oversized))).toThrow(
      "Remote queue is full",
    );
    expect(() => editRemoteMessage(original, "a", oversized, [])).toThrow("Remote queue is full");
    expect(original.messages[0].text).toBe("a");
    expect(original.editingId).toBe("a");
    const nearLimit = "x".repeat(Math.floor(REMOTE_QUEUE_MAX_BYTES / 3));
    expect(() => editRemoteMessage(original, "a", nearLimit, [])).toThrow("Remote queue is full");
    const attachment = {
      id: "f",
      name: "large.txt",
      kind: "file" as const,
      mimeType: "text/plain",
      size: 1,
      data: "x".repeat(REMOTE_QUEUE_MAX_BYTES / 2),
    };
    expect(() => editRemoteMessage(original, "a", "a", [attachment])).toThrow(
      "Remote queue is full",
    );
    expect(editRemoteMessage(original, "a", "recovered", []).messages[0].text).toBe("recovered");
  });
  it("queues in order and becomes active", () => {
    const queue = queueOf("a", "b");
    expect(queue.messages.map((message) => message.id)).toEqual(["a", "b"]);
    expect(queue.status).toBe("active");
  });

  it("keeps a paused queue paused when more is added", () => {
    const queue = enqueueRemoteMessage(pauseRemoteQueue(queueOf("a")), draft("b"));
    expect(queue.status).toBe("paused");
    expect(queue.messages).toHaveLength(2);
  });

  it("removes a row, closes its edit, and forgets the status once empty", () => {
    const editing = setRemoteEditing(queueOf("a", "b"), "a");
    const next = removeRemoteMessage(editing, "a");
    expect(next.messages.map((message) => message.id)).toEqual(["b"]);
    expect(next.editingId).toBeUndefined();
    expect(removeRemoteMessage(next, "b")).toEqual({
      messages: [],
      status: undefined,
      editingId: undefined,
    });
  });

  it("edits a row, drops attachments that are gone with their tokens, and ends the edit", () => {
    const gone = {
      id: "f1",
      name: "a.png",
      mimeType: "image/png",
      kind: "image" as const,
      size: 1,
      missing: true,
    };
    const queue = setRemoteEditing(
      { ...queueOf("a"), messages: [{ id: "a", text: "see [image1]", attachments: [gone] }] },
      "a",
    );
    const next = editRemoteMessage(queue, "a", "see [image1] now", [gone]);
    expect(next.messages[0]).toMatchObject({ text: "see now", attachments: [] });
    expect(next.editingId).toBeUndefined();
  });

  it("stops (pause) only a queue with something in it, and Send next / Resume release it", () => {
    expect(pauseRemoteQueue(EMPTY_REMOTE_QUEUE)).toBe(EMPTY_REMOTE_QUEUE);
    const paused = pauseRemoteQueue(queueOf("a"));
    expect(paused.status).toBe("paused");
    expect(releaseRemoteQueue(paused).status).toBe("active");
    const restored: RemoteQueue = { messages: queueOf("a").messages, status: "restored" };
    expect(releaseRemoteQueue(restored).status).toBe("active");
    const active = queueOf("a");
    expect(releaseRemoteQueue(active)).toBe(active);
  });

  it("a sent row leaves, and a restored queue drains on afterwards", () => {
    const restored: RemoteQueue = { messages: queueOf("a", "b").messages, status: "restored" };
    const next = sentRemoteMessage(restored, "a");
    expect(next.messages.map((message) => message.id)).toEqual(["b"]);
    expect(next.status).toBe("active");
  });

  it("shows its fields on a session only while something is queued", () => {
    expect(queueSessionFields(EMPTY_REMOTE_QUEUE)).toEqual({
      queuedMessages: undefined,
      queueStatus: undefined,
      editingQueuedMessageId: undefined,
    });
    const fields = queueSessionFields(setRemoteEditing(queueOf("a"), "a"));
    expect(fields.queuedMessages).toHaveLength(1);
    expect(fields.queueStatus).toBe("active");
    expect(fields.editingQueuedMessageId).toBe("a");
  });
});

describe("shouldQueueRemoteMessage", () => {
  it("queues while the chat is busy or an earlier command is in flight", () => {
    expect(shouldQueueRemoteMessage({ busy: true, working: false, asDraft: false })).toBe(true);
    expect(shouldQueueRemoteMessage({ busy: false, working: true, asDraft: false })).toBe(true);
  });

  it("sends when idle, and never queues a saved draft", () => {
    expect(shouldQueueRemoteMessage({ busy: false, working: false, asDraft: false })).toBe(false);
    expect(shouldQueueRemoteMessage({ busy: true, working: true, asDraft: true })).toBe(false);
  });
});

describe("nextRemoteQueuedMessage", () => {
  const session = (patch: Partial<Session> = {}, queue = queueOf("a", "b")): Session => ({
    ...newSession("claude", "remote://env/app"),
    ...queueSessionFields(queue),
    ...patch,
  });
  const ready = {
    loaded: true,
    online: true,
    canSend: true,
    working: false,
    changing: false,
  };

  it("hands out the head once the turn is over and the machine is reachable", () => {
    expect(nextRemoteQueuedMessage({ session: session(), ...ready })?.id).toBe("a");
  });

  it("adding work preserves the restored hold until explicit release", () => {
    const restored: RemoteQueue = { ...queueOf("a"), status: "restored" };
    const added = enqueueRemoteMessage(restored, draft("b"));
    expect(added.status).toBe("restored");
    expect(nextRemoteQueuedMessage({ session: session({}, added), ...ready })).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session({}, releaseRemoteQueue(added)), ...ready })?.id,
    ).toBe("a");
  });

  it("waits while the turn runs", () => {
    expect(nextRemoteQueuedMessage({ session: session({ busy: true }), ...ready })).toBeUndefined();
  });

  it("holds the queue while the machine is unreachable, instead of sending into the void", () => {
    expect(
      nextRemoteQueuedMessage({ session: session(), ...ready, online: false }),
    ).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session(), ...ready, canSend: false }),
    ).toBeUndefined();
    // ...and resumes the moment it comes back.
    expect(nextRemoteQueuedMessage({ session: session(), ...ready })?.id).toBe("a");
  });

  it("waits for a restored queue, a paused one, a usage limit, and the saved queue to load", () => {
    const restored: RemoteQueue = { messages: queueOf("a").messages, status: "restored" };
    expect(nextRemoteQueuedMessage({ session: session({}, restored), ...ready })).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session({}, pauseRemoteQueue(queueOf("a"))), ...ready }),
    ).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session({ usageLimit: {} }), ...ready }),
    ).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session(), ...ready, loaded: false }),
    ).toBeUndefined();
  });

  it("waits while a command is in flight, a setting change is pending, or its head is being edited", () => {
    expect(
      nextRemoteQueuedMessage({ session: session(), ...ready, working: true }),
    ).toBeUndefined();
    expect(
      nextRemoteQueuedMessage({ session: session(), ...ready, changing: true }),
    ).toBeUndefined();
    const editing = setRemoteEditing(queueOf("a", "b"), "a");
    expect(nextRemoteQueuedMessage({ session: session({}, editing), ...ready })).toBeUndefined();
  });

  it("holds a head whose attachment is gone", () => {
    const gone = {
      id: "f",
      name: "a.png",
      mimeType: "image/png",
      kind: "image" as const,
      size: 1,
      missing: true,
    };
    const queue: RemoteQueue = {
      messages: [{ id: "a", text: "x", attachments: [gone] }],
      status: "active",
    };
    expect(nextRemoteQueuedMessage({ session: session({}, queue), ...ready })).toBeUndefined();
  });

  it("sends the new head after a reorder, and still waits when paused", () => {
    const queue = queueOf("a", "b");
    const moved = reorderRemoteMessages(queue, ["b", "a"]);
    expect(nextRemoteQueuedMessage({ session: session({}, moved), ...ready })?.id).toBe("b");
    const paused = reorderRemoteMessages(pauseRemoteQueue(queue), ["b", "a"]);
    expect(nextRemoteQueuedMessage({ session: session({}, paused), ...ready })).toBeUndefined();
  });
});

describe("reordering a remote queue", () => {
  const ids = (queue: RemoteQueue) => queue.messages.map((message) => message.id);

  it("changes only the order, keeping status and the edited row", () => {
    const restored: RemoteQueue = {
      ...setRemoteEditing(queueOf("a", "b", "c"), "b"),
      status: "restored",
    };
    const next = reorderRemoteMessages(restored, ["c", "b", "a"]);
    expect(ids(next)).toEqual(["c", "b", "a"]);
    expect(next.status).toBe("restored");
    expect(next.editingId).toBe("b");
  });

  it("is a no-op for the same order and resolves ids against the live queue", () => {
    const queue = queueOf("a", "c", "d");
    expect(reorderRemoteMessages(queue, ["a", "c", "d"])).toBe(queue);
    expect(ids(reorderRemoteMessages(queue, ["c", "b", "a"]))).toEqual(["c", "a", "d"]);
  });
});
