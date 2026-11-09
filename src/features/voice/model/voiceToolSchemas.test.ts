import { expect, it } from "vitest";
import { voiceTools } from "./voiceToolSchemas";
import { VOICE_TOOL_MAX_LIMIT } from "./voiceToolCatalog";

const tool = (name: string) => voiceTools.find((item) => item.name === name)!;

it("describes give_jobs as direct start with opt-in review, not review-only", () => {
  const text = tool("give_jobs").description;
  expect(text).not.toContain("only shows the exact editable content");
  expect(text).toContain("start directly unless");
  expect(text).toContain("started");
});

it("keeps the app_tools_list limit and project hint aligned with the client", () => {
  const list = tool("app_tools_list");
  expect((list.parameters.properties as any).limit.maximum).toBe(VOICE_TOOL_MAX_LIMIT);
  expect(list.description).toContain("requiresProject");
});
