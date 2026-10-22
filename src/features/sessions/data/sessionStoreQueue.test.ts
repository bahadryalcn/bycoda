import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "./sessionStore";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { getSession, setSessionQueue } = await import("./sessionStore");

function record(): SessionRecord {
  return {
    id: "s1",
    harness: "claude",
    model: "m",
    cwd: "/repo",
    blocks: [{ id: "b0", role: "user", text: "hi" }],
  } as unknown as SessionRecord;
}

const saved = [
  { id: "q1", text: "first", attachments: [] },
  {
    id: "q2",
    text: "see [file1]",
    attachments: [
      {
        id: "f1",
        name: "a.txt",
        mimeType: "text/plain",
        kind: "file",
        size: 1,
        path: "/tmp/a.txt",
      },
      {
        id: "f2",
        name: "b.txt",
        mimeType: "text/plain",
        kind: "file",
        size: 1,
        path: "/tmp/gone.txt",
      },
    ],
  },
];

function answer(queue: unknown) {
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "session_get") return Promise.resolve(record());
    if (cmd === "session_get_queue") return Promise.resolve(queue);
    if (cmd === "inspect_paths") {
      return Promise.resolve([{ path: "/tmp/a.txt", name: "a.txt", size: 1, isDir: false }]);
    }
    return Promise.resolve(null);
  });
}

describe("restoring a saved queue", () => {
  beforeEach(() => invoke.mockReset());

  it("brings the queue back in order, waiting for the user, with gone files flagged", async () => {
    answer(saved);
    const session = await getSession("s1");
    expect(session?.queueStatus).toBe("restored");
    expect(session?.queuedMessages?.map((message) => message.id)).toEqual(["q1", "q2"]);
    expect(session?.queuedMessages?.[1].attachments.map((file) => file.missing)).toEqual([
      undefined,
      true,
    ]);
  });

  it("leaves a session without a saved queue as it was", async () => {
    answer(null);
    const session = await getSession("s1");
    expect(session?.queuedMessages).toBeUndefined();
    expect(session?.queueStatus).toBeUndefined();
  });

  it("still returns the session when the queue cannot be read", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(record());
      if (cmd === "session_get_queue") return Promise.reject(new Error("db locked"));
      return Promise.resolve(null);
    });
    const session = await getSession("s1");
    expect(session?.id).toBe("s1");
    expect(session?.queuedMessages).toBeUndefined();
  });
});

describe("writing the queue through", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));

  it("saves what can be restored, and removes the row for an empty queue", async () => {
    await setSessionQueue("s1", [
      {
        id: "q1",
        text: "x",
        attachments: [
          {
            id: "f",
            name: "p.png",
            mimeType: "image/png",
            kind: "image",
            size: 1,
            previewUrl: "blob:z",
          },
        ],
      },
    ]);
    const [, args] = invoke.mock.calls[0];
    expect(args.sessionId).toBe("s1");
    expect(args.queue[0].attachments[0]).toMatchObject({ id: "f", missing: true });
    expect(args.queue[0].attachments[0]).not.toHaveProperty("previewUrl");

    await setSessionQueue("s1", undefined);
    expect(invoke.mock.calls[1][1]).toEqual({ sessionId: "s1", queue: null });
  });

  it("ignores ids the store would reject", async () => {
    await setSessionQueue("../escape", [{ id: "q", text: "x", attachments: [] }]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
