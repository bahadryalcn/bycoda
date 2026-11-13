import { describe, expect, it } from "vitest";
import { crewTaskPrompt } from "./crew-task-prompt";

describe("crewTaskPrompt", () => {
  it("puts the request first and retains custom instructions exactly", () => {
    const instructions = `  Owner instructions\n${"x".repeat(25_000)}\n `;
    const prompt = crewTaskPrompt({
      request: "Acceptance: fix the defect",
      instructions,
      tools: "Tool gates",
      scope: "Write scope",
    });
    expect(prompt).toBe(
      `Acceptance: fix the defect\n\nRole context and instructions:\n${instructions}\n\nTool gates\n\nWrite scope`,
    );
  });
});
