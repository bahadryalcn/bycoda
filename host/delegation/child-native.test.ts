import { describe, expect, it } from "vitest";
import {
  DELEGATION_CHAT_ONLY_KEY,
  DELEGATION_PARENT_KEY,
} from "../../src/shared/model/host-contracts/delegation";
import {
  bycodaMcpOnly,
  leanContext,
  nativeReadOnly,
} from "../../src/integrations/harness/core/nativeToolLimits";
import { delegatedChildInput } from "./child-native";

const child = { [DELEGATION_PARENT_KEY]: "{}" };

describe("delegatedChildInput", () => {
  it("leaves an ordinary session untouched", () => {
    const input = { runtimeMode: "default", modelSettings: { effort: "high" } };
    expect(delegatedChildInput("claude", input)).toBe(input);
    const bare = { runtimeMode: "default" };
    expect(delegatedChildInput("claude", bare)).toBe(bare);
  });

  it("limits a delegated child to bycoda's MCP servers without changing its mode", () => {
    const out = delegatedChildInput("codex", {
      runtimeMode: "auto-accept-edits",
      modelSettings: child,
    });
    expect(bycodaMcpOnly(out.modelSettings)).toBe(true);
    expect(nativeReadOnly(out.modelSettings)).toBe(false);
    expect(leanContext(out.modelSettings)).toBe(false);
    expect(out.runtimeMode).toBe("auto-accept-edits");
  });

  it("runs a chat-only child read-only, supervised and lean", () => {
    for (const provider of ["claude", "codex"]) {
      const out = delegatedChildInput(provider, {
        runtimeMode: "full-access",
        modelSettings: { ...child, [DELEGATION_CHAT_ONLY_KEY]: "on" },
      });
      expect(out.runtimeMode).toBe("supervised");
      expect(nativeReadOnly(out.modelSettings)).toBe(true);
      expect(leanContext(out.modelSettings)).toBe(true);
      expect(bycodaMcpOnly(out.modelSettings)).toBe(true);
    }
  });

  it("refuses a chat-only child on a provider that cannot run read-only", () => {
    expect(() =>
      delegatedChildInput("cursor", {
        modelSettings: { ...child, [DELEGATION_CHAT_ONLY_KEY]: "on" },
      }),
    ).toThrow("Claude or Codex");
    expect(() => delegatedChildInput("cursor", { modelSettings: child })).not.toThrow();
  });
});
