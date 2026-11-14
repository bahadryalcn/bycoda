import { expect, it } from "vitest";
import { withAutoCompactSettings } from "./autoCompact";
import type { AgentModel } from "./models";
import { CLAUDE_COMPACT_SETTINGS } from "./claudeCompact";

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

it("offers every 50K step through the supported window", () => {
  const model: AgentModel = {
    id: "codex:test",
    name: "Test",
    harness: "codex",
    contextWindow: 400_000,
  };
  expect(
    withAutoCompactSettings(model).settings?.[0].options.map((option) => option.value),
  ).toEqual([
    "default",
    "50000",
    "100000",
    "150000",
    "200000",
    "250000",
    "300000",
    "350000",
    "400000",
  ]);
});

it("keeps Claude thresholds within its native 100K minimum in 50K steps", () => {
  const options = CLAUDE_COMPACT_SETTINGS.find(
    (setting) => setting.id === "autoCompactWindow",
  )!.options;
  expect(options[0].value).toBe("default");
  expect(options.slice(1).map((option) => Number(option.value))).toEqual(
    Array.from({ length: 19 }, (_, index) => 100_000 + index * 50_000),
  );
});
