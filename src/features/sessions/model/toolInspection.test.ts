import { describe, expect, it } from "vitest";
import {
  budgetStepOutputs,
  AGENT_OUTPUT_RUN_CHARS,
  PERSISTED_AGENT_OUTPUT_RUN_CHARS,
} from "./agentOutput";
import { boundedToolPreview, MAX_TOOL_INSPECTION_CHARS } from "./toolInspection";
import type { AgentStep, ToolPreview } from "./session";

describe("retained tool inspection limits", () => {
  it("validates loaded payloads and keeps valid preview metadata when dropping malformed inspection", () => {
    for (const inspection of [
      null,
      3,
      { kind: "html", text: "unsafe-kind" },
      { kind: "diff", text: 4 },
    ]) {
      const preview = { kind: "write", path: "app.ts", inspection } as unknown as ToolPreview;
      expect(boundedToolPreview(preview)).toEqual({ kind: "write", path: "app.ts" });
    }
    const capped = boundedToolPreview({
      kind: "write",
      inspection: { kind: "content", text: "x".repeat(50_000) },
    });
    expect(capped?.inspection?.text).toHaveLength(MAX_TOOL_INSPECTION_CHARS);
    expect(capped?.inspection?.truncated).toBe(true);
  });

  it.each([AGENT_OUTPUT_RUN_CHARS, PERSISTED_AGENT_OUTPUT_RUN_CHARS])(
    "holds inputs and outputs together within %i characters without dropping useful results",
    (budget) => {
      const steps: AgentStep[] = Array.from({ length: 10 }, (_, index) => ({
        id: `step-${index}`,
        kind: "tool",
        text: "Write app.ts",
        output: `useful-${index}`,
        preview: { kind: "write", inspection: { kind: "content", text: "x".repeat(24_000) } },
      }));
      const bounded = budgetStepOutputs(steps, budget);
      const size = bounded.reduce(
        (sum, step) =>
          sum + (step.output?.length ?? 0) + (step.preview?.inspection?.text.length ?? 0),
        0,
      );
      expect(size).toBeLessThanOrEqual(budget);
      expect(bounded.map((step) => step.output)).toEqual(steps.map((step) => step.output));
      expect(bounded[0].preview?.inspection?.truncated).toBe(true);
      expect(steps[0].preview?.inspection?.text).toHaveLength(24_000);
    },
  );
});
