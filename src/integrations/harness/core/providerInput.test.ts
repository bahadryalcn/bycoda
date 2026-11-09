import { describe, expect, it } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_PARENT_KEY,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { providerInput } from "./providerInput";

const reserved = {
  [CROSS_SUBAGENTS_KEY]: encodeSubagents([{ harness: "codex", model: "gpt-6.1-sol" }]) ?? "",
  [CROSS_ADVISOR_KEY]: encodeAdvisor({ harness: "claude", model: "claude:opus-5-5" }) ?? "",
  [DELEGATION_PARENT_KEY]: "{}",
};

describe("providerInput", () => {
  it("removes every reserved key before the adapter sees the input", () => {
    const input = { prompt: "hi", modelSettings: { effort: "high", ...reserved } };
    expect(providerInput(input).modelSettings).toEqual({ effort: "high" });
    expect(input.modelSettings).toHaveProperty(CROSS_ADVISOR_KEY);
  });

  it("returns the same input object when there is nothing to strip", () => {
    const input = { prompt: "hi", modelSettings: { effort: "high" } };
    expect(providerInput(input)).toBe(input);
  });

  it("passes input without model settings through unchanged", () => {
    const input = { prompt: "hi" } as { prompt: string; modelSettings?: Record<string, string> };
    expect(providerInput(input)).toBe(input);
  });
});
