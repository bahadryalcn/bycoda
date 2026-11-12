import { afterEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("./child", () => ({ invokeProviderCommand: invoke }));
import { conversationDelegationReady, delegationFallback } from "./delegationReadiness";
import { providerTurnInput } from "./providerInput";
import { codexThreadConfig } from "../providers/codex/codexSubagentLimits";

afterEach(() => {
  vi.useRealTimers();
  invoke.mockReset();
});

it.each([
  ["auto", undefined, true, false],
  ["auto", undefined, false, true],
  ['[{"harness":"codex","model":"codex:test"}]', undefined, false, false],
  ['[{"harness":"codex","model":"codex:test"}]', undefined, true, false],
  ["auto", "high", false, false],
  ["auto", "high", true, false],
  ["", undefined, false, false],
  ["", undefined, true, false],
  ["[]", undefined, false, false],
])(
  "preserves bounds for selection %s, ceiling %s, ready %s",
  (selection, ceiling, ready, native) => {
    const modelSettings: Record<string, string> = {
      crossSubagents: selection!,
      ...(ceiling ? { crossSubagentMaxEffort: ceiling } : {}),
    };
    for (const harness of ["codex", "claude"]) {
      const input = { harness, modelSettings };
      const result = providerTurnInput(input, (id) => id, ready);
      expect(input.modelSettings).toEqual(modelSettings);
      expect(
        harness === "codex"
          ? result.modelSettings.nativeSubagents === "on"
          : result.modelSettings.subagentModel !== "off",
      ).toBe(native);
    }
    const guidance = delegationFallback(modelSettings, ready);
    if (native) expect(guidance).toContain("use your built-in subagents");
    else if (!ready && selection && selection !== "[]")
      expect(guidance).toContain("Do not use unrestricted");
    else expect(guidance).toBe("");
  },
);

it("checks initialize readiness, rejects metadata and normalizes split session ids", async () => {
  invoke
    .mockResolvedValueOnce({ command: "node", args: [] })
    .mockResolvedValueOnce({ ready: true });
  expect(await conversationDelegationReady("session#2")).toBe(false);
  expect(await conversationDelegationReady("session#2")).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("harness_conversation_tools_bridge", {
    sessionId: "session",
    checkReady: true,
  });
});

it("bounds a hung backend and handles rejected calls", async () => {
  vi.useFakeTimers();
  invoke.mockReturnValueOnce(new Promise(() => {}));
  const pending = conversationDelegationReady("session");
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toBe(false);
  invoke.mockRejectedValueOnce(new Error("Host offline"));
  expect(await conversationDelegationReady("session")).toBe(false);
});

it("restores Codex agent config after an earlier restricted turn", () => {
  const prior = codexThreadConfig(undefined, { nativeSubagents: "off" });
  expect(codexThreadConfig(prior, { nativeSubagents: "on" })).toEqual({
    "agents.enabled": true,
    "features.multi_agent": true,
    "features.multi_agent_v2": false,
  });
});

it("enforces a ceiling even without a saved subagent list", () => {
  for (const harness of ["claude", "codex"]) {
    const result = providerTurnInput(
      { harness, modelSettings: { crossSubagentMaxEffort: "high" } as Record<string, string> },
      (id) => id,
      false,
    );
    expect(result.modelSettings[harness === "claude" ? "subagentModel" : "nativeSubagents"]).toBe(
      "off",
    );
  }
});
