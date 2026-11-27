import { expect, it } from "vitest";
import type { AgentModel, ModelSetting } from "../../sessions/public/models";
import { missingProviderWideSettings, providerWideSetting } from "./providerWideSetting";

const tier = (...values: [string, string][]): ModelSetting => ({
  id: "serviceTier",
  label: "Service tier",
  kind: "select",
  value: "default",
  options: values.map(([value, label]) => ({ value, label })),
});
const model = (id: string, setting: ModelSetting): AgentModel =>
  ({ id, harness: "codex", name: id, settings: [setting] }) as AgentModel;

it("offers every tier any of the provider's models has, selected model's order first", () => {
  const current = tier(["default", "Standard"], ["priority", "Fast"]);
  const models = [
    model("codex:terra", current),
    model(
      "codex:sol",
      tier(["default", "Standard"], ["priority", "Fast"], ["ultrafast", "Ultrafast"]),
    ),
  ];
  expect(providerWideSetting(current, models).options.map((option) => option.label)).toEqual([
    "Standard",
    "Fast",
    "Ultrafast",
  ]);
});

it("leaves per-model settings and complete lists unchanged", () => {
  const effort: ModelSetting = { ...tier(["low", "Low"]), id: "reasoningEffort" };
  const models = [model("codex:a", { ...effort, options: [{ value: "max", label: "Max" }] })];
  expect(providerWideSetting(effort, models)).toBe(effort);
  const current = tier(["default", "Standard"]);
  expect(providerWideSetting(current, [model("codex:a", current)])).toBe(current);
});

it("finds a provider-wide setting the selected model lacks", () => {
  const sol = tier(["default", "Standard"], ["ultrafast", "Ultrafast"]);
  const models = [
    { id: "codex:a", harness: "codex", name: "a", settings: [] } as unknown as AgentModel,
    model("codex:sol", sol),
  ];
  expect(missingProviderWideSettings([], models, (m) => m.settings ?? [])).toEqual([sol]);
  expect(missingProviderWideSettings([sol], models, (m) => m.settings ?? [])).toEqual([]);
});
