const automaticModels = vi.hoisted(() =>
  vi.fn(() => [] as Array<{ harness: string; model: string; providerAccountId?: string }>),
);
vi.mock("./automaticSubagents", () => ({ runtimeAutomaticSubagents: automaticModels }));
import { describe, expect, it, vi } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_PARENT_KEY,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { providerInput, providerTurnInput } from "./providerInput";

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

it("Automatic disables native delegation when its runtime set is not exactly one same-account Claude ref", () => {
  const input = {
    harness: "claude",
    providerAccountId: "own",
    modelSettings: { crossSubagents: "auto" } as Record<string, string>,
  };
  const result = providerTurnInput(input, (id) => id);
  expect(result.modelSettings.subagentModel).toBe("off");
  expect(
    providerTurnInput({ ...input, harness: "codex" }, (id) => id).modelSettings.nativeSubagents,
  ).toBe("off");
});

it("Automatic keeps Claude native Agent only for exactly one resolved same-account model", () => {
  const input = {
    harness: "claude",
    providerAccountId: "own",
    modelSettings: { crossSubagents: "auto" } as Record<string, string>,
  };
  automaticModels.mockReturnValue([
    { harness: "claude", model: "sonnet", providerAccountId: "own" },
  ]);
  expect(providerTurnInput(input, (id) => id).modelSettings).toMatchObject({
    subagentModel: "sonnet",
    subagentPolicy: "force",
  });
  automaticModels.mockReturnValue([
    { harness: "claude", model: "sonnet", providerAccountId: "other" },
  ]);
  expect(providerTurnInput(input, (id) => id).modelSettings.subagentModel).toBe("off");
  automaticModels.mockReturnValue([
    { harness: "claude", model: "sonnet", providerAccountId: "own" },
    { harness: "codex", model: "sol" },
  ]);
  expect(providerTurnInput(input, (id) => id).modelSettings.subagentModel).toBe("off");
  automaticModels.mockReturnValue([]);
});
