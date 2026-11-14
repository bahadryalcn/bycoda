import { expect, it } from "vitest";
import { codexThreadConfig } from "./codexSubagentLimits";

it("turns Codex's native subagents off only when the selection requires it", () => {
  const skills = { "skills.config": [] };
  expect(codexThreadConfig(skills, { reasoningEffort: "high" })).toBe(skills);
  expect(codexThreadConfig(undefined, undefined)).toBeUndefined();
  expect(codexThreadConfig(skills, { nativeSubagents: "off" })).toEqual({
    "skills.config": [],
    "agents.enabled": false,
    "features.multi_agent": false,
    "features.multi_agent_v2": false,
  });
});

it("reenables native fallback even when the base config disables agents", () => {
  expect(codexThreadConfig({ "agents.enabled": false }, { nativeSubagents: "on" })).toEqual({
    "agents.enabled": true,
    "features.multi_agent": true,
    "features.multi_agent_v2": false,
  });
});

it("turns off provider memory and the skill listing for a chat-only child", () => {
  const lean = {
    "features.memories": false,
    "memories.use_memories": false,
    "memories.generate_memories": false,
    "skills.include_instructions": false,
  };
  expect(codexThreadConfig(undefined, { leanContext: "on" })).toEqual(lean);
  expect(
    codexThreadConfig({ "skills.config": [] }, { leanContext: "on", nativeSubagents: "off" }),
  ).toMatchObject({ ...lean, "agents.enabled": false, "skills.config": [] });
  expect(codexThreadConfig(undefined, {})).toBeUndefined();
});
