import { expect, it } from "vitest";
import { taskLaunchSettings } from "./launch";

it("defaults task subagents to existing Automatic contract without losing advisor or effort", () => {
  const settings = { crossAdvisor: "advisor", effort: "high", crossSubagentMaxEffort: "medium" };
  expect(taskLaunchSettings(settings)).toEqual({ ...settings, crossSubagents: "auto" });
  expect(settings).not.toHaveProperty("crossSubagents");
});

it.each(["auto", "[]", '[{"harness":"codex","model":"gpt-6.1"}]'])(
  "preserves explicit subagent selection %s",
  (crossSubagents) => {
    expect(taskLaunchSettings({ crossSubagents })).toEqual({ crossSubagents });
  },
);
