import { describe, expect, it } from "vitest";
import type { AgentStep } from "../model/session";
import { agentStepBlock, blockForStep } from "./agentStepBlocks";

const tool = { id: "s1", kind: "tool", text: "Read file", status: "completed" } as AgentStep;
const reasoning = { id: "s2", kind: "reasoning", text: "thinking" } as AgentStep;

describe("agentStepBlocks", () => {
  it("restores the nested agent run for inspection", () => {
    const step: AgentStep = {
      ...tool,
      toolKind: "subagent",
      agentRun: {
        name: "Reviewer",
        model: "claude-sonnet-4-6",
        startedAt: 1000,
        steps: [{ id: "reply", kind: "message", text: "Verified" }],
      },
    };
    expect(agentStepBlock(step)).toMatchObject({ role: "tool", agentRun: step.agentRun });
  });
  it("builds tool and reasoning blocks", () => {
    expect(agentStepBlock(tool)).toMatchObject({ role: "tool", tool: { callId: "s1" } });
    expect(agentStepBlock(reasoning)).toMatchObject({ role: "reasoning", text: "thinking" });
  });

  it("returns the same block for the same step object", () => {
    expect(blockForStep(tool)).toBe(blockForStep(tool));
  });

  it("builds a fresh block when the step object changes", () => {
    const changed = { ...tool, text: "Read other" } as AgentStep;
    expect(blockForStep(changed)).not.toBe(blockForStep(tool));
    expect(blockForStep(changed).text).toBe("Read other");
  });
});
