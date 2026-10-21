import { describe, expect, it } from "vitest";
import {
  MAX_PERSISTED_ATTACHMENT_CHARS,
  hasMissingAttachment,
  markMissingAttachments,
  persistableQueue,
  restoreQueuedMessages,
  withoutMissingAttachments,
} from "./queuePersistence";
import type { Attachment, QueuedMessage } from "./session";

function file(patch: Partial<Attachment> = {}): Attachment {
  return { id: "f1", name: "a.txt", mimeType: "text/plain", kind: "file", size: 3, ...patch };
}

function message(patch: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id: "q1", text: "hello", attachments: [], ...patch };
}

it("preserves the unknown-delivery hold across persistence and restore", () => {
  const queue = [message({ deliveryUnknown: true })];
  expect(restoreQueuedMessages(persistableQueue(queue))).toEqual(queue);
});

it("persists a shared attachment's host identity and does not probe its path on another PC", async () => {
  const saved = persistableQueue([
    message({ attachments: [file({ path: "/host/upload", hostEnvironmentId: "host" })] }),
  ]);
  const restored = restoreQueuedMessages(saved);
  expect(restored[0].attachments[0].hostEnvironmentId).toBe("host");
  const probe = async () => {
    throw new Error("Foreign paths must not be inspected locally");
  };
  expect(await markMissingAttachments(restored, probe)).toBe(restored);
});

describe("persistableQueue", () => {
  it("restores each row's original model and effort without sharing settings", () => {
    const modelTarget = {
      harness: "codex" as const,
      model: "gpt-5",
      modelSettings: { effort: "high" },
    };
    const saved = persistableQueue([message({ modelTarget })]);
    modelTarget.modelSettings.effort = "low";
    const restored = restoreQueuedMessages(saved);
    expect(restored[0].modelTarget?.modelSettings).toEqual({ effort: "high" });
    expect(
      restoreQueuedMessages([
        {
          ...message(),
          modelTarget: { ...modelTarget, modelSettings: { effort: 123 } },
        },
      ]),
    ).toEqual([]);
    expect(restoreQueuedMessages([message()])).toEqual([message()]);
  });
  it("keeps nothing for an empty queue", () => {
    expect(persistableQueue(undefined)).toBeNull();
    expect(persistableQueue([])).toBeNull();
  });

  it("keeps order, text, intent and cards, and drops object URLs", () => {
    const saved = persistableQueue([
      message({ id: "q2", text: "two", intent: "plan" }),
      message({
        id: "q1",
        attachments: [file({ path: "/tmp/a.txt", previewUrl: "blob:x", copyFromPath: true })],
        handoffCard: { from: "claude", to: "codex", brief: "b" },
      }),
    ]);
    expect(saved?.map((entry) => entry.id)).toEqual(["q2", "q1"]);
    expect(saved?.[0].intent).toBe("plan");
    expect(saved?.[1].handoffCard?.to).toBe("codex");
    expect(saved?.[1].attachments[0]).toEqual(file({ path: "/tmp/a.txt" }));
  });

  it("keeps only the path of a file, and the payload of a small pasted image", () => {
    const saved = persistableQueue([
      message({
        attachments: [
          file({ id: "p", kind: "image", path: "/tmp/p.png", data: "AAAA" }),
          file({ id: "d", kind: "image", data: "BBBB", previewUrl: "blob:y" }),
        ],
      }),
    ]);
    expect(saved?.[0].attachments[0]).not.toHaveProperty("data");
    expect(saved?.[0].attachments[1]).toMatchObject({ id: "d", data: "BBBB" });
    expect(saved?.[0].attachments[1]).not.toHaveProperty("previewUrl");
  });

  it("marks an attachment that cannot come back instead of dropping it", () => {
    const saved = persistableQueue([
      message({
        attachments: [
          file({ id: "gone", kind: "image" }),
          file({ id: "big", kind: "image", data: "x".repeat(MAX_PERSISTED_ATTACHMENT_CHARS + 1) }),
        ],
      }),
    ]);
    expect(saved?.[0].attachments.map((entry) => entry.missing)).toEqual([true, true]);
  });
});

describe("restoreQueuedMessages", () => {
  it("round-trips what was saved", () => {
    const original = [
      message({ id: "q1", attachments: [file({ path: "/tmp/a.txt" })], intent: "orchestrate" }),
      message({ id: "q2", text: "two" }),
    ];
    const raw = JSON.parse(JSON.stringify(persistableQueue(original)));
    expect(restoreQueuedMessages(raw)).toEqual(original);
  });

  it("drops rows and attachments that do not fit, without throwing", () => {
    expect(restoreQueuedMessages("nope")).toEqual([]);
    const restored = restoreQueuedMessages([
      null,
      { id: 1, text: "bad id" },
      { id: "empty", text: "  ", attachments: [] },
      { id: "ok", text: "kept", attachments: [{ id: "x" }, file({ path: "/p" })], intent: "weird" },
    ]);
    expect(restored).toHaveLength(1);
    expect(restored[0].attachments).toEqual([file({ path: "/p" })]);
    expect(restored[0]).not.toHaveProperty("intent");
  });
});

describe("markMissingAttachments", () => {
  const queue = [
    message({ attachments: [file({ id: "a", path: "/here" }), file({ id: "b", path: "/gone" })] }),
  ];

  it("flags only the paths that no longer exist", async () => {
    const marked = await markMissingAttachments(queue, async () => new Set(["/here"]));
    expect(marked[0].attachments.map((entry) => entry.missing)).toEqual([undefined, true]);
    expect(hasMissingAttachment(marked[0])).toBe(true);
  });

  it("unblocks a restored file while preserving a missing inline attachment", async () => {
    const saved = persistableQueue([
      message({ attachments: [file({ path: "/returned", missing: true })] }),
    ]);
    const restored = restoreQueuedMessages(saved);
    const checked = await markMissingAttachments(restored, async () => new Set(["/returned"]));
    expect(hasMissingAttachment(checked[0])).toBe(false);
    expect(checked[0].attachments[0].path).toBe("/returned");
    const mixed = [
      {
        ...restored[0],
        attachments: [...restored[0].attachments, file({ id: "inline", missing: true })],
      },
    ];
    const rechecked = await markMissingAttachments(mixed, async () => new Set(["/returned"]));
    expect(rechecked[0].attachments.map((entry) => entry.missing)).toEqual([undefined, true]);
  });

  it("keeps attachments untouched when existence cannot be checked", async () => {
    const marked = await markMissingAttachments(queue, async () => {
      throw new Error("offline");
    });
    expect(marked).toBe(queue);
  });

  it("does not ask when nothing is on disk", async () => {
    const plain = [message()];
    let asked = false;
    await markMissingAttachments(plain, async () => {
      asked = true;
      return new Set();
    });
    expect(asked).toBe(false);
  });
});

describe("withoutMissingAttachments", () => {
  it("drops gone files with their tokens and renumbers the rest", () => {
    const edited = withoutMissingAttachments(
      message({
        text: "compare [file1] and [file2]",
        attachments: [file({ id: "a", missing: true }), file({ id: "b", path: "/b" })],
      }),
    );
    expect(edited.attachments.map((entry) => entry.id)).toEqual(["b"]);
    expect(edited.text).toBe("compare and [file1]");
  });
});
