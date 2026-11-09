import { describe, expect, it } from "vitest";
import { buildDeterministicHandoff, shouldAskOutgoingAgent } from "./handoff";
import { newSession } from "./session";
import { repairSessionModelIdentity } from "./sessionModelIdentity";

describe("legacy mixed provider/model recovery", () => {
  const broken = () => ({
    ...newSession("codex", "/repo"),
    model: "antigravity:gemini-3.8-flash-high",
    modelSettings: { reasoning: "high" },
    providerSessionId: "codex-thread",
    providerAccountId: "codex-work",
    context: { used: 123, window: 1000 },
    blocks: [
      { id: "u", role: "user" as const, text: "Preserve SKY-7421 and the parser contract" },
      { id: "a", role: "assistant" as const, text: "The parser contract is verified" },
    ],
  });
  it("keeps the selected Gemini model and original conversation without binding its Codex thread", () => {
    const original = broken();
    const repaired = repairSessionModelIdentity(original);
    expect(repaired.id).toBe(original.id);
    expect(repaired.blocks).toBe(original.blocks);
    expect(repaired.model).toBe(original.model);
    expect(repaired.harness).toBe("antigravity");
    expect(repaired.providerSessionId).toBeUndefined();
    expect(repaired.providerAccountId).toBeUndefined();
    expect(repaired.context).toBeUndefined();
    expect(repaired.pendingSwitch?.fromProviderSessionId).toBe("codex-thread");
    expect(shouldAskOutgoingAgent(repaired)).toBe(false);
    expect(buildDeterministicHandoff(repaired)).toContain("SKY-7421");
    expect(repairSessionModelIdentity(repaired)).toBe(repaired);
    expect(original.harness).toBe("codex");
  });
  it.each(["codex:gpt-6.1-sol", "my-custom-model", "gateway:custom"])(
    "keeps valid or unowned model %s unchanged",
    (model) => {
      const session = { ...broken(), model };
      expect(repairSessionModelIdentity(session)).toBe(session);
    },
  );
  it.each(["busy", "continuingElsewhere", "historyLoading"] as const)(
    "does not reassign a session while %s",
    (state) => {
      const session = { ...broken(), [state]: true };
      expect(repairSessionModelIdentity(session)).toBe(session);
    },
  );
});
