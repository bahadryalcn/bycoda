import { describe, expect, it } from "vitest";
import { agentRunMarkdown, isReportStep } from "./agentRunMarkdown";
import type { Block } from "./session";

const block = (run: NonNullable<Block["agentRun"]>, detail?: string): Block => ({
  id: "b1",
  role: "tool",
  text: "Correctness review",
  tool: { callId: "a1", kind: "agent", status: "completed", detail },
  agentRun: run,
});

describe("agentRunMarkdown", () => {
  it("reads as prompt, work in order, then the report", () => {
    const text = agentRunMarkdown(
      block(
        {
          name: "Correctness review",
          agentType: "code-reviewer",
          prompt: "Review the reducer.",
          steps: [
            { id: "m1", kind: "message", text: "Starting with the reducer." },
            { id: "r1", kind: "reasoning", text: "Check the edge cases." },
            {
              id: "t1",
              kind: "tool",
              text: "Read src/a.ts",
              status: "completed",
              output: "export const a = 1;",
            },
            {
              id: "t2",
              kind: "tool",
              text: "Bash npm test",
              status: "failed",
              detail: "1 failed",
            },
            { id: "x:report", kind: "message", text: "All good." },
          ],
        },
        "All good.",
      ),
      "Done",
    );
    expect(text).toContain("# Correctness review");
    expect(text).toContain("_Done · code-reviewer_");
    const order = [
      "## Prompt",
      "Review the reducer.",
      "Starting with the reducer.",
      "> **Thinking**",
      "- `Read src/a.ts`",
      "export const a = 1;",
      "- `Bash npm test` (failed)",
      "1 failed",
      "## Report",
    ].map((part) => text?.indexOf(part) ?? -1);
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The mirrored closing message is the report, shown once.
    expect(text?.match(/All good\./g)).toHaveLength(1);
  });

  it("fences output that contains backticks without breaking out", () => {
    const text = agentRunMarkdown(
      block({
        name: "Review",
        steps: [
          {
            id: "t1",
            kind: "tool",
            text: "Read a.md",
            output: "```ts\nconst a = 1;\n```",
            outputTruncated: true,
          },
        ],
      }),
    );
    expect(text).toContain("````\n```ts\nconst a = 1;\n```\n````");
    expect(text).toContain("shortened");
  });

  it("has nothing to copy for a block with no run", () => {
    expect(agentRunMarkdown({ id: "b", role: "tool", text: "Shell" })).toBeUndefined();
  });

  it("only treats a closing message as the report", () => {
    expect(isReportStep({ id: "t:report", kind: "message", text: "x" }, "x")).toBe(true);
    expect(isReportStep({ id: "m1", kind: "message", text: "other" }, "x")).toBe(false);
    expect(isReportStep({ id: "t:report", kind: "tool", text: "x" }, "x")).toBe(false);
    expect(isReportStep({ id: "t:report", kind: "message", text: "x" }, undefined)).toBe(false);
  });
});
