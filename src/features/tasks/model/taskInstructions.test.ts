import { expect, it } from "vitest";
import {
  readTaskInstructions,
  taskInstructionsMarkdown,
  taskInstructionsSummary,
} from "./taskInstructions";
import { parseGoalPlan } from "./hostGoals";

const brief = {
  schema: "bycoda.task.v1",
  objective: "Fix playback",
  deliverables: ["Retain seek position"],
  acceptance: ["Resume at 4s"],
  constraints: ["Keep offline support"],
  verification: ["Run audio tests"],
};

it("renders every structured condition without exposing JSON on the card", () => {
  const prompt = JSON.stringify(brief);
  expect(taskInstructionsSummary(prompt)).toBe("Fix playback");
  const markdown = taskInstructionsMarkdown(prompt);
  expect(markdown).toContain("### Acceptance criteria\n\n- Resume at 4s");
  expect(markdown).toContain("Keep offline support");
  expect(markdown).toContain("Run audio tests");
  expect(markdown).not.toContain('"schema"');
});

it.each([
  "Keep the old prompt exactly.\nDo not remove line 2.",
  '{"objective":"not a versioned brief"}',
  JSON.stringify({ ...brief, extra: "must not be silently dropped" }),
])("preserves legacy and unrecognized instructions: %s", (prompt) => {
  expect(readTaskInstructions(prompt)).toBeUndefined();
  expect(taskInstructionsMarkdown(prompt)).toBe(prompt);
});

it("accepts structured planner output without losing acceptance conditions", () => {
  const plan = parseGoalPlan(
    "```json\n" +
      JSON.stringify({
        tasks: [{ key: "audio", project: "/app", title: "Audio", prompt: brief }],
      }) +
      "\n```",
    ["/app"],
  );
  expect(readTaskInstructions(plan.tasks[0].prompt)).toEqual(brief);
});

it("rejects malformed structured planner instructions", () => {
  expect(() =>
    parseGoalPlan(
      "```json\n" +
        JSON.stringify({
          tasks: [
            {
              key: "audio",
              project: "/app",
              title: "Audio",
              prompt: { ...brief, acceptance: "missing list" },
            },
          ],
        }) +
        "\n```",
      ["/app"],
    ),
  ).toThrow("prompt");
});
