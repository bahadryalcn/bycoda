// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newDefaultSession,
  newSession,
  newSessionForProject,
  retargetSessionToProject,
  setHarnessModeLimits,
} from "./session";
import { providerSessionDefaults, saveGlobalSessionDefaults } from "./providerSessionDefaults";
import { rebaseProjectProviders, setProjectSessionDefaults } from "./projectProviders";
import {
  modelEffortSetting,
  resolveModel,
  saveLastModelChoice,
  saveLastModelSettings,
  setHarnessModels,
  resetHarnessModelOverlays,
} from "./models";

describe("provider session defaults", () => {
  beforeEach(() => {
    localStorage.clear();
    setHarnessModels("codex", [
      {
        id: "codex:gpt-6.1-sol",
        harness: "codex",
        name: "GPT-6.1-Sol",
        settings: [
          {
            id: "reasoningEffort",
            label: "Effort",
            kind: "select",
            value: "medium",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ]);
    saveLastModelChoice("codex", "codex:gpt-6.1-sol");
  });
  afterEach(() => {
    setHarnessModeLimits("codex", undefined);
    resetHarnessModelOverlays();
  });

  it("applies saved effort and permissions to new conversations ahead of recent settings", () => {
    const model = resolveModel("codex", "codex:gpt-6.1-sol");
    const effort = modelEffortSetting(model)!;
    const value = effort.options[0].value;
    saveLastModelSettings({ [effort.id]: effort.options.at(-1)!.value });
    saveGlobalSessionDefaults("codex", {
      effort: value,
      runtimeMode: "full-access",
    });
    const session = newDefaultSession("/repo", "supervised");
    expect(session.runtimeMode).toBe("full-access");
    expect(session.modelSettings?.[effort.id]).toBe(value);
    expect(newSession("claude", "/repo").runtimeMode).toBe("supervised");
  });

  it("inherits global fields, supports project overrides and resetting them", () => {
    saveGlobalSessionDefaults("codex", {
      effort: "high",
      runtimeMode: "full-access",
    });
    setProjectSessionDefaults("/repo", "codex", { runtimeMode: "auto" });
    expect(providerSessionDefaults("codex", "/repo")).toEqual({
      effort: "high",
      runtimeMode: "auto",
    });
    setProjectSessionDefaults("/repo", "codex", {});
    expect(providerSessionDefaults("codex", "/repo").runtimeMode).toBe("full-access");
  });

  it("applies default extras per setting with project overrides on top", () => {
    setHarnessModels("claude", [
      {
        id: "claude:opus-5-5",
        harness: "claude",
        name: "Opus 5.5",
        nativeId: "claude-opus-5-5",
      },
    ]);
    saveLastModelSettings({ autoCompact: "on", advisor: "fable" });
    saveGlobalSessionDefaults("claude", {
      extras: { autoCompact: "off", autoCompactWindow: "500000" },
    });
    setProjectSessionDefaults("/repo", "claude", {
      extras: { autoCompact: "on", subagentModel: "not-offered" },
    });
    expect(providerSessionDefaults("claude", "/repo").extras).toEqual({
      autoCompact: "on",
      autoCompactWindow: "500000",
      subagentModel: "not-offered",
    });
    const global = newSession("claude", "/elsewhere", "claude:opus-5-5");
    expect(global.modelSettings).toMatchObject({
      autoCompact: "off",
      autoCompactWindow: "500000",
      advisor: "fable",
    });
    const project = newSession("claude", "/repo", "claude:opus-5-5");
    expect(project.modelSettings).toMatchObject({
      autoCompact: "on",
      subagentModel: "default",
    });
  });

  it("keeps explicit modes and ignores effort the model does not support", () => {
    saveGlobalSessionDefaults("codex", {
      effort: "unsupported",
      runtimeMode: "full-access",
    });
    const session = newSession("codex", "/repo", undefined, "supervised");
    expect(session.runtimeMode).toBe("supervised");
    expect(Object.values(session.modelSettings ?? {})).not.toContain("unsupported");
  });

  it("applies project permissions to seeded and blank retargeted sessions", () => {
    const seed = newSession("codex", "/other");
    setProjectSessionDefaults("/repo", "codex", {
      runtimeMode: "auto-accept-edits",
    });
    expect(newSessionForProject(seed, "/repo").runtimeMode).toBe("auto-accept-edits");
    expect(retargetSessionToProject(seed, "/repo").runtimeMode).toBe("auto-accept-edits");
    expect(
      retargetSessionToProject({ ...seed, providerSessionId: "existing" }, "/repo").runtimeMode,
    ).toBe("supervised");
    rebaseProjectProviders("/repo", "/renamed");
    expect(providerSessionDefaults("codex", "/renamed").runtimeMode).toBe("auto-accept-edits");
  });

  it("respects transport mode limits and rejects malformed stored permissions", () => {
    saveGlobalSessionDefaults("codex", { runtimeMode: "full-access" });
    setHarnessModeLimits("codex", {
      runtimeModes: { "full-access": "Unsupported" },
      newSessionMode: "supervised",
    });
    expect(newDefaultSession("/repo").runtimeMode).toBe("supervised");
    localStorage.setItem(
      "bycoda.providerSessionDefaults.v1",
      '{"codex":{"runtimeMode":"invalid"}}',
    );
    expect(providerSessionDefaults("codex")).toEqual({});
  });
});
