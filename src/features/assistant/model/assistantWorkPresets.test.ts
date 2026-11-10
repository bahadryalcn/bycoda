import { describe, expect, it } from "vitest";
import type { AssistantExecution } from "../../../shared/model/host-contracts/assistant";
import {
  applyAssistantWorkPreset,
  ASSISTANT_WORK_PRESETS,
  assistantWorkPreset,
  type AssistantWorkPreset,
} from "./assistantWorkPresets";

const execution: AssistantExecution = {
  harness: "codex",
  model: "gpt",
  modelSettings: {},
  runtimeMode: "supervised",
  maxRunMinutes: 60,
};

describe("assistant work presets", () => {
  it.each(Object.keys(ASSISTANT_WORK_PRESETS) as AssistantWorkPreset[])(
    "round-trips %s",
    (name) => {
      const patch = applyAssistantWorkPreset({ execution }, name);
      expect(assistantWorkPreset({ execution, ...patch })).toBe(name);
    },
  );

  it("keeps the worker model and changes only its permission", () => {
    const patch = applyAssistantWorkPreset({ execution }, "free");
    expect(patch.execution).toEqual({ ...execution, runtimeMode: "full-access" });
  });

  it("leaves execution unset when there is no worker model", () => {
    expect(applyAssistantWorkPreset({}, "ask")).not.toHaveProperty("execution");
  });

  it("reports custom for a mixed combination", () => {
    const patch = applyAssistantWorkPreset({ execution }, "ask");
    expect(assistantWorkPreset({ execution, ...patch, planApproval: "never" })).toBe("custom");
    expect(
      assistantWorkPreset({
        ...patch,
        execution: { ...execution, runtimeMode: "auto-accept-edits" },
      }),
    ).toBe("custom");
  });
});
