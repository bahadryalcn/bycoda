import { expect, it } from "vitest";
import { withAutoCompactSettings } from "./autoCompact";
import type { AgentModel } from "./models";

it("offers Codex native thresholds bounded by the reported model window", () => {
  const model: AgentModel = {
    id: "codex:test",
    name: "Test",
    harness: "codex",
    contextWindow: 180_000,
  };
  const enhanced = withAutoCompactSettings(model);
  expect(enhanced.settings?.[0].options.map((option) => option.value)).toEqual([
    "default",
    "50000",
    "100000",
    "150000",
  ]);
  expect(withAutoCompactSettings(enhanced)).toBe(enhanced);
});

it("does not invent native controls for unsupported adapters", () => {
  const model: AgentModel = { id: "cursor:test", name: "Test", harness: "cursor" };
  expect(withAutoCompactSettings(model)).toBe(model);
});
