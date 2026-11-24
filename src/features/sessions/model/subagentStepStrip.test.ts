import { expect, it } from "vitest";
import type { AgentStep } from "./session";
import { SUBAGENT_STRIP_CELLS, subagentStepStrip } from "./subagentStepStrip";

const tool = (id: number, status = "completed"): AgentStep => ({
  id: `step-${id}`,
  kind: "tool",
  text: "Read file",
  status,
});

it("counts only tool calls and marks the newest as current while working", () => {
  const prose: AgentStep = { id: "note", kind: "message", text: "Checking" };
  expect(subagentStepStrip([tool(1), prose, tool(2)], true)).toEqual({
    cells: ["done", "active"],
    total: 2,
    failed: 0,
  });
  expect(subagentStepStrip([tool(1), tool(2)], false).cells).toEqual(["done", "done"]);
});

it("keeps a failed newest step red while the run is working", () => {
  expect(subagentStepStrip([tool(1), tool(2, "failed")], true).cells).toEqual(["done", "failed"]);
});

it("counts a failure that scrolled out of the drawn window", () => {
  const steps = [
    tool(0, "error"),
    ...Array.from({ length: SUBAGENT_STRIP_CELLS }, (_, index) => tool(index + 1)),
  ];
  const strip = subagentStepStrip(steps, false);
  expect(strip.cells).toHaveLength(SUBAGENT_STRIP_CELLS);
  expect(strip.cells).not.toContain("failed");
  expect(strip.total).toBe(SUBAGENT_STRIP_CELLS + 1);
  expect(strip.failed).toBe(1);
});
