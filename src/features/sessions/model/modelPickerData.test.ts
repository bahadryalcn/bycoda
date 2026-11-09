import { expect, it } from "vitest";
import type { AgentModel, ModelSetting } from "./models";
import {
  fastSetting,
  fastToggleValues,
  groupSettings,
  pickerSettings,
  settingGroupId,
  settingLabel,
} from "./modelPickerData";

const select = (id: string, label = id): ModelSetting => ({
  id,
  label,
  kind: "select",
  value: "a",
  options: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
});
const toggle = (id: string, label = id): ModelSetting => ({
  id,
  label,
  kind: "toggle",
  value: "false",
  options: [
    { value: "true", label: "On" },
    { value: "false", label: "Off" },
  ],
});
const model = (settings: ModelSetting[]): AgentModel => ({
  id: "m",
  name: "M",
  harness: "claude",
  settings,
});

it("orders delegation, Context, Fast and Reasoning regardless of catalog order", () => {
  const settings = [
    select("subagentModel"),
    select("autoCompactWindow"),
    toggle("fast", "Fast"),
    select("advisor"),
    select("effort", "Reasoning"),
    toggle("autoCompact"),
    select("context"),
  ];
  const ordered = groupSettings(pickerSettings(model(settings))).flatMap((group) =>
    group.settings.map((setting) => setting.id),
  );
  expect(ordered).toEqual([
    "subagentModel",
    "advisor",
    "autoCompactWindow",
    "autoCompact",
    "context",
    "fast",
    "effort",
  ]);
  expect(groupSettings(pickerSettings(model(settings))).map((group) => group.id)).toEqual([
    "delegation",
    "context",
    "model",
  ]);
});

it("keeps unknown provider options in the primary model group", () => {
  expect(settingGroupId(select("custom"))).toBe("model");
  expect(groupSettings([])).toEqual([]);
});

it("names every reasoning setting the same way", () => {
  expect(settingLabel(select("effort", "Effort"))).toBe("Reasoning");
  expect(settingLabel(select("reasoningEffort", "Reasoning"))).toBe("Reasoning");
  expect(settingLabel(select("variant", "Variant"))).toBe("Variant");
});

it("only treats a plain on/off pair as Fast", () => {
  expect(fastToggleValues(toggle("fast"))).toEqual({ on: "true", off: "false" });
  const tier: ModelSetting = {
    id: "serviceTier",
    label: "Service Tier",
    kind: "select",
    value: "default",
    options: [
      { value: "default", label: "Standard" },
      { value: "priority", label: "Fast" },
    ],
  };
  expect(fastSetting(model([tier]))?.id).toBe("serviceTier");
  expect(fastToggleValues(tier)).toEqual({ on: "priority", off: "default" });
  expect(fastToggleValues(select("effort"))).toBeUndefined();
  expect(fastToggleValues(undefined)).toBeUndefined();
});
