import { describe, expect, it } from "vitest";
import { buildConversationReplay, canRewindConversation, conversationReplayPrompt, markConversationTurnStopped, rewindConversationBeforeMessage } from "./conversationRewind";
import { newSession, type Block } from "./session";

const chat = (blocks: Block[]) => ({ ...newSession("pi", "/tmp"), blocks, providerSessionId: "provider-1" });

describe("conversation rewind", () => {
  it("rewinds to any visible user message and archives every removed block", () => {
    const blocks: Block[] = [
      { id: "u1", role: "user", text: "keep" },
      { id: "a1", role: "assistant", text: "retained answer" },
      { id: "u2", role: "user", text: "remove this prompt" },
      { id: "tool", role: "tool", text: "removed tool output" },
      { id: "a2", role: "assistant", text: "removed answer" },
    ];
    const source = chat(blocks);
    expect(canRewindConversation(source, "u2")).toBe(true);
    const rewound = rewindConversationBeforeMessage(source, "u2", 123);
    expect(rewound.blocks.map((block) => block.id)).toEqual(["u1", "a1"]);
    expect(rewound.rewindHistory?.[0]).toMatchObject({ createdAt: 123, fromBlockId: "u2", blocks: blocks.slice(2) });
    expect(rewound.providerSessionId).toBeUndefined();
    expect(conversationReplayPrompt(rewound)).toContain("retained answer");
    expect(rewound.pendingContextReplay).not.toContain("remove this prompt");
    expect(rewound.pendingContextReplay).not.toContain("removed tool output");
  });

  it("clears replay for an empty prefix and excludes draft or hidden targets", () => {
    const source = chat([{ id: "target", role: "user", text: "first" }]);
    const rewound = rewindConversationBeforeMessage(source, "target", 1);
    expect(rewound.pendingContextReplay).toBeUndefined();
    expect(rewound.blocks).toEqual([]);
    expect(canRewindConversation(chat([{ id: "draft", role: "user", text: "draft", draft: true }]), "draft")).toBe(false);
    expect(canRewindConversation(chat([{ id: "hidden", role: "user", text: "hidden", internal: true }]), "hidden")).toBe(false);
  });

  it("preserves provider binding and skips replay for the native rewind path", () => {
    const source = chat([
      { id: "u1", role: "user", text: "context" },
      { id: "u2", role: "user", text: "target" },
    ]);
    source.providerAccountId = "account-choice";
    const rewound = rewindConversationBeforeMessage(source, "u2", 1, { preserveProviderBinding: true });
    expect(rewound.providerSessionId).toBe("provider-1");
    expect(rewound.providerAccountId).toBe("account-choice");
    expect(rewound.pendingContextReplay).toBeUndefined();
  });

  it("prioritizes recent context and marks omitted content explicitly", () => {
    const replay = buildConversationReplay([
      { id: "old", role: "assistant", text: "old context ".repeat(2_000) },
      { id: "recent", role: "user", text: "latest retained request" },
    ]);
    expect(replay).toContain("latest retained request");
    expect(replay).toContain("[Earlier retained context omitted to fit the replay limit.]");
  });

  it("replaces replay from the retained prefix on repeated rewinds", () => {
    const first = rewindConversationBeforeMessage(chat([
      { id: "u1", role: "user", text: "prefix one" },
      { id: "u2", role: "user", text: "middle" },
      { id: "u3", role: "user", text: "last" },
    ]), "u3", 1);
    const second = rewindConversationBeforeMessage({ ...first, blocks: [...first.blocks, { id: "u4", role: "user", text: "next" }] }, "u2", 2);
    expect(second.rewindHistory).toHaveLength(2);
    expect(second.pendingContextReplay).toContain("prefix one");
    expect(second.pendingContextReplay).not.toContain("middle");
  });

  it("replays attachment references without embedded payloads and bounds the output", () => {
    const replay = buildConversationReplay([{
      id: "u", role: "user", text: "look at this", attachments: [{ id: "att-1", name: "screen.png", kind: "image", mimeType: "image/png", size: 4, path: "/repo/screen.png", data: "secret-payload" }],
    }]);
    expect(replay).toContain("screen.png");
    expect(replay).toContain("/repo/screen.png");
    expect(replay).toContain("file contents are not reloaded");
    expect(replay).not.toContain("secret-payload");
    expect(buildConversationReplay([{ id: "long", role: "assistant", text: "x".repeat(50_000) }]).length).toBeLessThanOrEqual(24_000);
  });

  it("marks the latest initiating user block as stopped durably", () => {
    const source = chat([
      { id: "u", role: "user", text: "work" },
      { id: "assistant", role: "assistant", text: "partial", streaming: true },
    ]);
    const stopped = markConversationTurnStopped(source, 456);
    expect(stopped.blocks[0]).toMatchObject({ turnOutcome: "stopped", turnStoppedAt: 456 });
    expect(markConversationTurnStopped(stopped, 789)).toBe(stopped);
  });
});
