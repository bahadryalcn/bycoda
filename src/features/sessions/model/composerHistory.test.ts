import { describe, expect, it } from "vitest";
import { historyKey, userPromptHistory, type HistoryKeyInput } from "./composerHistory";
import type { Attachment, Block, QueuedMessage } from "./session";

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: text + Math.random(),
  role: "user",
  text,
  ...extra,
});

const image = (id: string): Attachment => ({
  id,
  name: `${id}.png`,
  mimeType: "image/png",
  kind: "image",
  size: 1,
});

describe("userPromptHistory", () => {
  it("lists the user's messages newest first and collapses repeats", () => {
    const blocks: Block[] = [
      user("one"),
      { id: "a", role: "assistant", text: "reply" },
      user("two"),
      user("two"),
      user("one"),
    ];
    expect(userPromptHistory({ blocks })).toEqual(["one", "two", "one"]);
  });

  it("skips internal, draft, second-opinion and empty turns", () => {
    const blocks: Block[] = [
      user("real"),
      user("worker note", { internal: true }),
      user("unsent", { draft: true }),
      user("Second opinion", {
        secondOpinion: {} as Block["secondOpinion"],
      }),
      user("   "),
    ];
    expect(userPromptHistory({ blocks })).toEqual(["real"]);
  });

  it("puts queued messages first, newest queued on top", () => {
    const queued: QueuedMessage[] = [
      { id: "1", text: "queued a", attachments: [] },
      { id: "2", text: "queued b", attachments: [] },
    ];
    expect(userPromptHistory({ blocks: [user("sent")], queuedMessages: queued })).toEqual([
      "queued b",
      "queued a",
      "sent",
    ]);
  });

  it.each(["pending", "undelivered", "uncertain"] as const)(
    "recalls a retained %s follow-up with ArrowUp while skipping ordinary drafts",
    (followUpDelivery) => {
      const entries = userPromptHistory({
        blocks: [
          user("previous"),
          user("edit this stopped message", { draft: true, followUpDelivery }),
          user("saved for later", { draft: true }),
        ],
      });
      expect(entries).toEqual(["edit this stopped message", "previous"]);
      expect(
        historyKey({
          key: "ArrowUp",
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          text: "",
          selectionStart: 0,
          selectionEnd: 0,
          composerEmpty: true,
          menuOpen: false,
          entries,
          browse: null,
        }).text,
      ).toBe("edit this stopped message");
    },
  );

  it("recalls the typed text without attachment tokens or the MCP note", () => {
    const blocks: Block[] = [
      user("look at [image1] please", { attachments: [image("i")] }),
      user(
        'MCP context: Use the configured server "docs" (claude) when relevant to this request.\n\nsearch it',
      ),
    ];
    expect(userPromptHistory({ blocks })).toEqual(["search it", "look at please"]);
  });

  it("returns an empty list for a session with no user messages", () => {
    expect(userPromptHistory({ blocks: [] })).toEqual([]);
  });
});

describe("historyKey", () => {
  const entries = ["newest", "middle", "oldest"];
  const base: HistoryKeyInput = {
    key: "ArrowUp",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
    composerEmpty: true,
    menuOpen: false,
    entries,
    browse: null,
  };
  const press = (input: Partial<HistoryKeyInput>) => historyKey({ ...base, ...input });

  it("starts at the newest entry from an empty composer", () => {
    expect(press({})).toEqual({
      browse: { index: 0, text: "newest" },
      text: "newest",
    });
  });

  it("does nothing when the composer is not empty or history is empty", () => {
    expect(press({ composerEmpty: false, text: "x" }).text).toBeUndefined();
    expect(press({ entries: [] }).text).toBeUndefined();
    expect(press({ key: "ArrowDown" }).text).toBeUndefined();
  });

  it("steps older on Up, newer on Down, then back to empty", () => {
    let browse = { index: 0, text: "newest" };
    const up = press({ text: "newest", browse, selectionStart: 6, selectionEnd: 6 });
    expect(up.text).toBe("middle");
    browse = up.browse!;
    const down = press({
      key: "ArrowDown",
      text: "middle",
      browse,
      selectionStart: 6,
      selectionEnd: 6,
    });
    expect(down.text).toBe("newest");
    const out = press({
      key: "ArrowDown",
      text: "newest",
      browse: down.browse,
      selectionStart: 6,
      selectionEnd: 6,
    });
    expect(out).toEqual({ browse: null, text: "" });
  });

  it("stays on the oldest entry", () => {
    const result = press({
      text: "oldest",
      browse: { index: 2, text: "oldest" },
      selectionStart: 6,
      selectionEnd: 6,
    });
    expect(result.text).toBeUndefined();
    expect(result.browse).toEqual({ index: 2, text: "oldest" });
  });

  it("ends browsing once the recalled text is edited", () => {
    const result = press({
      text: "newest!",
      browse: { index: 0, text: "newest" },
      composerEmpty: false,
      selectionStart: 7,
      selectionEnd: 7,
    });
    expect(result).toEqual({ browse: null });
  });

  it("navigates a multi-line entry only from its first or last line", () => {
    const text = "first\nsecond";
    const browse = { index: 1, text };
    const at = (caret: number, key: string) =>
      press({ key, text, browse, selectionStart: caret, selectionEnd: caret });
    expect(at(12, "ArrowUp").text).toBeUndefined();
    expect(at(3, "ArrowUp").text).toBe("oldest");
    expect(at(3, "ArrowDown").text).toBeUndefined();
    expect(at(12, "ArrowDown").text).toBe("newest");
  });

  it("ignores modifiers, selections and open menus", () => {
    expect(press({ shiftKey: true }).text).toBeUndefined();
    expect(press({ ctrlKey: true }).text).toBeUndefined();
    expect(press({ altKey: true }).text).toBeUndefined();
    expect(press({ metaKey: true }).text).toBeUndefined();
    expect(press({ menuOpen: true }).text).toBeUndefined();
    const selected = press({
      text: "newest",
      browse: { index: 0, text: "newest" },
      selectionStart: 0,
      selectionEnd: 6,
    });
    expect(selected.text).toBeUndefined();
  });
});
