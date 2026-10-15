import { describe, expect, it } from "vitest";
import { HARNESSES, newSession, type Block } from "./session";
import { canRewindConversation, rewindConversationBeforeMessage } from "./conversationRewind";
import { conversationRewindStrategy } from "./conversationRewindStrategy";

const blocks: Block[] = [
  { id: "first", role: "user", text: "Retain this" },
  { id: "answer", role: "assistant", text: "Retained result" },
  { id: "wrong", role: "user", text: "Wrong session request", providerTurnId: "turn-2" },
];

describe("conversation rewind strategies", () => {
  it.each(HARNESSES)("supports fresh-context correction for %s", (harness) => {
    const session = { ...newSession(harness, "/repo"), blocks, providerSessionId: "old-provider" };
    expect(canRewindConversation(session, "wrong")).toBe(true);
    const strategy = conversationRewindStrategy(session, "wrong", false);
    const result = rewindConversationBeforeMessage(session, strategy.blockId, 1, strategy);
    expect(result.providerSessionId).toBeUndefined();
    expect(result.pendingContextReplay).toContain("Retained result");
    expect(result.pendingContextReplay).not.toContain("Wrong session request");
    expect(result.rewindHistory?.[0].blocks.map((block) => block.id)).toEqual(["wrong"]);
  });

  it("uses the complete native Codex turn for a steered final message", () => {
    const session = {
      ...newSession("codex", "/repo"), providerSessionId: "provider",
      blocks: [...blocks, { id: "steer", role: "user" as const, text: "Second request", providerTurnId: "turn-2" }],
    };
    expect(conversationRewindStrategy(session, "steer", true)).toEqual({
      blockId: "wrong", preserveProviderBinding: true, providerTurnId: "turn-2",
    });
    expect(conversationRewindStrategy(session, "first", true).preserveProviderBinding).toBe(false);
    expect(conversationRewindStrategy({ ...session, pendingContextReplay: "undelivered context" }, "steer", true).preserveProviderBinding).toBe(false);
  });
});
