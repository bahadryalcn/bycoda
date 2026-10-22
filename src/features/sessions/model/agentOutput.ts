import type { AgentStep } from "./session";

/**
 * Bounds for what a subagent's trail keeps of tool results and its prompt. A
 * delegated run can make hundreds of calls and one result can be megabytes, so
 * every limit here is a deliberate trade: the live panel keeps enough to read
 * what each call returned, and a saved session keeps much less.
 */
export const AGENT_OUTPUT_STEP_CHARS = 4_000;
export const AGENT_OUTPUT_RUN_CHARS = 64_000;
export const AGENT_PROMPT_CHARS = 6_000;
export const PERSISTED_AGENT_OUTPUT_STEP_CHARS = 1_200;
export const PERSISTED_AGENT_OUTPUT_RUN_CHARS = 16_000;
export const PERSISTED_AGENT_PROMPT_CHARS = 3_000;

/**
 * Keeps the start and the end of a long text with a marker where the middle
 * went: the head says what ran, the tail is usually the error or the verdict.
 */
export function capHeadTail(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  const tail = Math.floor(max / 4);
  const head = max - tail;
  const omitted = value.length - head - tail;
  return {
    text: `${value.slice(0, head)}\n… [${omitted} characters omitted] …\n${value.slice(value.length - tail)}`,
    truncated: true,
  };
}

/** Cleans a tool result for storage; nothing when there is nothing to show. */
export function capStepOutput(
  value: string | undefined,
  max = AGENT_OUTPUT_STEP_CHARS,
): { output: string; truncated: boolean } | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const { text, truncated } = capHeadTail(trimmed, max);
  return { output: text, truncated };
}

/**
 * Holds a run's outputs and retained inputs to a total. Older input detail is
 * shortened first, preserving useful results. The oldest outputs then go first, so the calls
 * nearest the report stay readable; a step that lost its output is marked so
 * the panel can say so instead of showing an empty result.
 */
export function budgetStepOutputs(
  steps: AgentStep[],
  budget = AGENT_OUTPUT_RUN_CHARS,
): AgentStep[] {
  let total = 0;
  for (const step of steps)
    total += (step.output?.length ?? 0) + (step.preview?.inspection?.text.length ?? 0);
  if (total <= budget) return steps;
  const next = steps.slice();
  for (let index = 0; index < next.length && total > budget; index += 1) {
    const step = next[index];
    const inspection = step.preview?.inspection;
    if (!inspection?.text.length) continue;
    const remove = Math.min(inspection.text.length, total - budget);
    next[index] = {
      ...step,
      preview: {
        ...step.preview!,
        inspection: {
          ...inspection,
          text: inspection.text.slice(0, inspection.text.length - remove),
          truncated: true,
        },
      },
    };
    total -= remove;
  }
  for (let index = 0; index < next.length && total > budget; index += 1) {
    const length = next[index].output?.length ?? 0;
    if (!length) continue;
    const { output: _dropped, ...rest } = next[index];
    next[index] = { ...rest, outputTruncated: true };
    total -= length;
  }
  return next;
}
