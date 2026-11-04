import type { AgentStep, Block } from "../model/session";

/**
 * A mirrored step as the transcript block it stands for, so a subagent's trail
 * goes through the same rows — labels, file chips, diffs — as the main agent's.
 */
export function agentStepBlock(step: AgentStep): Block {
  if (step.kind !== "tool") {
    return {
      id: step.id,
      role: step.kind === "reasoning" ? "reasoning" : "assistant",
      text: step.text,
    };
  }
  return {
    id: step.id,
    role: "tool",
    text: step.text,
    tool: {
      callId: step.id,
      title: step.text,
      ...(step.toolKind ? { kind: step.toolKind } : {}),
      ...(step.status ? { status: step.status } : {}),
      ...(step.detail ? { detail: step.detail } : {}),
      ...(step.preview ? { preview: step.preview } : {}),
      ...(step.output ? { output: step.output } : {}),
      ...(step.outputTruncated ? { outputTruncated: true } : {}),
    },
  };
}

const stepBlocks = new WeakMap<AgentStep, Block>();

/** Stable block per step object, so an unchanged step does not re-render as the run grows. */
export function blockForStep(step: AgentStep): Block {
  let block = stepBlocks.get(step);
  if (!block) {
    block = agentStepBlock(step);
    stepBlocks.set(step, block);
  }
  return block;
}
