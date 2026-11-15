import { expect, it } from "vitest";
import { defaultAutoCompactWindow, withAutoCompactSettings } from "./autoCompact";
import type { AgentModel } from "./models";
import { CLAUDE_COMPACT_SETTINGS } from "./claudeCompact";

it("offers Codex native thresholds from 200K bounded by the reported model window", () => {
  const model: AgentModel = {
    id: "codex:test",
    name: "Test",
    harness: "codex",
    contextWindow: 300_000,
  };
  const enhanced = withAutoCompactSettings(model);
  expect(enhanced.settings?.[0].options.map((option) => option.value)).toEqual([
    "default",
    "200000",
    "250000",
    "300000",
  ]);
  expect(withAutoCompactSettings(enhanced)).toBe(enhanced);
});

it("adds no window control when the model is smaller than the 200K floor", () => {
  const model: AgentModel = {
    id: "codex:small",
    name: "Small",
    harness: "codex",
    contextWindow: 180_000,
  };
  expect(withAutoCompactSettings(model)).toBe(model);
});

it("places Default on the provider's own window", () => {
  const claude: AgentModel = {
    id: "claude:test",
    name: "Test",
    harness: "claude",
    settings: [
      {
        id: "context",
        label: "Context",
        kind: "select",
        value: "1m",
        options: [],
      },
    ],
  };
  expect(defaultAutoCompactWindow(claude, {})).toBe(1_000_000);
  expect(defaultAutoCompactWindow(claude, { context: "200k" })).toBe(200_000);
  expect(
    defaultAutoCompactWindow(
      { id: "codex:x", name: "X", harness: "codex", contextWindow: 400_000 },
      {},
    ),
  ).toBe(400_000);
});

it("does not invent native controls for unsupported adapters", () => {
  const model: AgentModel = {
    id: "cursor:test",
    name: "Test",
    harness: "cursor",
  };
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
  ).toEqual(["default", "200000", "250000", "300000", "350000", "400000"]);
});

it("starts Claude thresholds at 200K in 50K steps", () => {
  const options = CLAUDE_COMPACT_SETTINGS.find(
    (setting) => setting.id === "autoCompactWindow",
  )!.options;
  expect(options[0].value).toBe("default");
  expect(options.slice(1).map((option) => Number(option.value))).toEqual(
    Array.from({ length: 17 }, (_, index) => 200_000 + index * 50_000),
  );
});
