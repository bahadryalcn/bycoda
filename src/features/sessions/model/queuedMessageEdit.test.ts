import { describe, expect, it } from "vitest";
import {
  addDraftAttachments,
  applyQueuedEdit,
  deleteDraftTokenAtCaret,
  editDraftText,
  hasQueuedEditChanges,
  isQueuedEditEmpty,
  queuedEditDraft,
  removeDraftAttachment,
} from "./queuedMessageEdit";
import { isEditingQueuedHead } from "./messageQueue";
import type { Attachment, QueuedMessage, Session } from "./session";

function file(id: string, kind: Attachment["kind"] = "image", extra = {}): Attachment {
  return { id, name: id, mimeType: "image/png", kind, size: 1, ...extra };
}

function message(extra: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id: "q1", text: "", attachments: [], ...extra };
}

describe("removeDraftAttachment", () => {
  it("removes the chip's token and renumbers the rest", () => {
    const draft = {
      text: "a [image1] b [image2]",
      attachments: [file("x"), file("y")],
    };
    const next = removeDraftAttachment(draft, "x");
    expect(next.text).toBe("a b [image1]");
    expect(next.attachments.map((f) => f.id)).toEqual(["y"]);
  });

  it("ignores an unknown id", () => {
    const draft = { text: "[image1]", attachments: [file("x")] };
    expect(removeDraftAttachment(draft, "nope")).toBe(draft);
  });
});

describe("editDraftText", () => {
  it("drops the attachment whose token the edit removed and keeps the caret in place", () => {
    const draft = {
      text: "see [image1] and [image2]",
      attachments: [file("x"), file("y")],
    };
    const { draft: next, caret } = editDraftText(draft, "see  and [image2]", 4);
    expect(next.attachments.map((f) => f.id)).toEqual(["y"]);
    expect(next.text).toBe("see  and [image1]");
    expect(caret).toBe(4);
  });

  it("leaves attachments alone when no token was touched", () => {
    const draft = { text: "[image1]", attachments: [file("x")] };
    const { draft: next } = editDraftText(draft, "[image1] more", 13);
    expect(next.attachments).toHaveLength(1);
    expect(next.text).toBe("[image1] more");
  });
});

describe("deleteDraftTokenAtCaret", () => {
  it("Backspace right after a token removes the token and its attachment", () => {
    const draft = { text: "look [file1]", attachments: [file("f", "file")] };
    const result = deleteDraftTokenAtCaret(draft, 12, "back")!;
    expect(result.draft.attachments).toEqual([]);
    expect(result.draft.text).toBe("look ");
  });

  it("is null away from a token", () => {
    const draft = { text: "look [file1]", attachments: [file("f", "file")] };
    expect(deleteDraftTokenAtCaret(draft, 3, "back")).toBeNull();
  });
});

describe("addDraftAttachments", () => {
  it("appends the files and puts their tokens at the caret", () => {
    const draft = { text: "hello", attachments: [file("x")] };
    const result = addDraftAttachments(draft, [file("y"), file("d", "file")], {
      start: 5,
      end: 5,
    });
    expect(result.draft.attachments.map((f) => f.id)).toEqual(["x", "y", "d"]);
    expect(result.draft.text).toBe("hello [image2] [file1]");
    expect(result.caret).toBe(result.draft.text.length);
  });

  it("adds no token for a duplicate", () => {
    const draft = { text: "[image1]", attachments: [file("x")] };
    const result = addDraftAttachments(draft, [file("x")], null);
    expect(result.draft).toBe(draft);
  });
});

describe("applyQueuedEdit", () => {
  it("keeps the id, cards and intent", () => {
    const noteCard = { id: "n" } as never;
    const handoffCard = { id: "h" } as never;
    const original = message({
      text: "old",
      noteCard,
      handoffCard,
      intent: "plan",
    });
    const next = applyQueuedEdit(original, { text: "new", attachments: [] });
    expect(next).toEqual({
      id: "q1",
      text: "new",
      attachments: [],
      noteCard,
      handoffCard,
      intent: "plan",
    });
  });

  it("drops missing attachments and their tokens", () => {
    const original = message({ text: "[image1] [image2]" });
    const next = applyQueuedEdit(original, {
      text: "[image1] [image2]",
      attachments: [file("gone", "image", { missing: true }), file("here")],
    });
    expect(next.attachments.map((f) => f.id)).toEqual(["here"]);
    expect(next.text).toBe("[image1]");
  });
});

describe("isQueuedEditEmpty", () => {
  it("is empty with no text and no attachments", () => {
    expect(isQueuedEditEmpty(message(), { text: "  \n", attachments: [] })).toBe(true);
  });

  it("is not empty with only an attachment", () => {
    expect(isQueuedEditEmpty(message(), { text: "", attachments: [file("x")] })).toBe(false);
  });

  it("is empty when only a missing attachment remains", () => {
    expect(
      isQueuedEditEmpty(message(), {
        text: "[image1]",
        attachments: [file("x", "image", { missing: true })],
      }),
    ).toBe(true);
  });
});

describe("hasQueuedEditChanges", () => {
  const original = message({ text: "a", attachments: [file("x")] });
  it("is false for the untouched draft", () => {
    expect(hasQueuedEditChanges(original, queuedEditDraft(original))).toBe(false);
  });
  it("sees text and attachment changes", () => {
    expect(hasQueuedEditChanges(original, { text: "b", attachments: original.attachments })).toBe(
      true,
    );
    expect(hasQueuedEditChanges(original, { text: "a", attachments: [] })).toBe(true);
  });
});

describe("hold while editing", () => {
  const session = (editing?: string) =>
    ({
      queuedMessages: [message({ id: "a", text: "1" }), message({ id: "b", text: "2" })],
      editingQueuedMessageId: editing,
    }) as unknown as Session;

  it("holds the queue while its head is being edited, so rows behind wait too", () => {
    expect(isEditingQueuedHead(session("a"))).toBe(true);
  });

  it("does not hold for a row further back; it is held once it reaches the head", () => {
    expect(isEditingQueuedHead(session("b"))).toBe(false);
  });
});
