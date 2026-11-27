import { describe, expect, it } from "vitest";
import { branchSessionFromReply } from "../../src/features/sessions/model/conversationBranch";
import { newSession, type Block, type Session } from "../../src/features/sessions/model/session";

/** A Host-held conversation bound to a native provider session, as the Host store holds it. */
function hostConversation(): Session {
  const blocks: Block[] = [
    { id: "u1", role: "user", text: "plan the migration", providerTurnId: "turn-1" },
    { id: "a1", role: "assistant", text: "step one then step two" },
    { id: "u2", role: "user", text: "now do step one", providerTurnId: "turn-2" },
    { id: "a2", role: "assistant", text: "step one done" },
  ];
  return {
    ...newSession("codex", "/srv/project"),
    id: "host-session-1",
    providerSessionId: "native-thread-1",
    blocks,
  };
}

describe("Host conversation branch", () => {
  it("cuts the history at the reply and starts the branch on a fresh provider binding", () => {
    const original = hostConversation();
    const branch = branchSessionFromReply(original, original.blocks.slice(0, 2))!;
    expect(branch.blocks.slice(1).map((block) => block.id)).toEqual(["u1", "a1"]);
    expect(branch.providerSessionId).toBeUndefined();
    expect(branch.pendingContextReplay).toContain("step one then step two");
    expect(branch.pendingContextReplay).not.toContain("now do step one");
    expect(branch.id).not.toBe(original.id);
  });

  it("does not touch the conversation it was cut from", () => {
    const original = hostConversation();
    const before = JSON.stringify(original);
    branchSessionFromReply(original, original.blocks.slice(0, 2));
    expect(JSON.stringify(original)).toBe(before);
    expect(original.providerSessionId).toBe("native-thread-1");
    expect(original.blocks).toHaveLength(4);
  });
});
