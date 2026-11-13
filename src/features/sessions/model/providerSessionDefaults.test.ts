// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newDefaultSession,
  newSession,
  newSessionForProject,
  retargetSessionToProject,
  setHarnessModeLimits,
} from "./session";
import {
  globalProviderSessionDefaults,
  providerSessionDefaults,
  saveGlobalSessionDefaults,
  mergeProviderExtras,
  applySessionDefaults,
} from "./providerSessionDefaults";
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
  it("explicit Automatic removes an inherited and recent subagent ceiling", () => {
    const extras = mergeProviderExtras(
      "codex",
      { crossSubagentMaxEffort: "max" },
      { crossSubagentMaxEffort: "" },
    );
    expect(extras).toEqual({ crossSubagentMaxEffort: "" });
    const settings = applySessionDefaults(
      resolveModel("codex", "codex:gpt-6.1-sol"),
      { crossSubagentMaxEffort: "high", reasoningEffort: "medium" },
      { extras },
    );
    expect(settings).toEqual({ reasoningEffort: "medium" });
  });
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
    expect(providerSessionDefaults("codex", "/repo")).toMatchObject({
      effort: "high",
      runtimeMode: "auto",
    });
    setProjectSessionDefaults("/repo", "codex", {});
    expect(providerSessionDefaults("codex", "/repo").runtimeMode).toBe("full-access");
  });

  it("lets a project turn off inherited delegation and restore it by reset", () => {
    const advisor = JSON.stringify({ harness: "claude", model: "claude:opus" });
    const subagents = JSON.stringify([{ harness: "codex", model: "codex:gpt" }]);
    saveGlobalSessionDefaults("codex", {
      extras: { crossAdvisor: advisor, crossSubagents: subagents },
    });
    setProjectSessionDefaults("/repo", "codex", {
      extras: { crossAdvisor: "null", crossSubagents: "[]" },
    });
    saveLastModelSettings({ crossAdvisor: advisor, crossSubagents: subagents });
    expect(newSession("codex", "/repo").modelSettings).toMatchObject({
      crossAdvisor: "null",
      crossSubagents: "[]",
    });
    setProjectSessionDefaults("/repo", "codex", {});
    expect(newSession("codex", "/repo").modelSettings).toMatchObject({
      crossAdvisor: advisor,
      crossSubagents: subagents,
    });
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
    expect(providerSessionDefaults("claude", "/repo").extras).toMatchObject({
      autoCompact: "on",
      autoCompactWindow: "500000",
      subagentModel: "not-offered",
    });
    const global = newSession("claude", "/elsewhere", "claude:opus-5-5");
    expect(global.modelSettings).toMatchObject({
      autoCompact: "off",
      autoCompactWindow: "500000",
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

  it.each([
    "codex",
    "cursor",
    "grok",
    "antigravity",
    "opencode",
    "pi",
    "omp",
    "fx",
    "hermes",
    "acp",
  ] as const)("applies %s catalog feature defaults to new conversations", (harness) => {
    const modelId = `${harness}:defaults-fixture`;
    setHarnessModels(harness, [
      {
        id: modelId,
        harness,
        name: "Defaults fixture",
        settings: [
          {
            id: "context",
            label: "Context",
            kind: "select",
            value: "normal",
            options: [
              { value: "normal", label: "Normal" },
              { value: "extended", label: "Extended" },
            ],
          },
        ],
      },
    ]);
    saveLastModelSettings({ context: "normal" });
    saveGlobalSessionDefaults(harness, { extras: { context: "extended", unknownFeature: "on" } });
    const existing = newSession(harness, "/repo", modelId);
    expect(existing.modelSettings?.context).toBe("extended");
    expect(existing.modelSettings).not.toHaveProperty("unknownFeature");
    setProjectSessionDefaults("/repo", harness, { extras: { context: "normal" } });
    expect(newSession(harness, "/repo", modelId).modelSettings?.context).toBe("normal");
    expect(existing.modelSettings?.context).toBe("extended");
    setProjectSessionDefaults("/repo", harness, {});
    expect(newSession(harness, "/repo", modelId).modelSettings?.context).toBe("extended");
    expect(
      newSession(harness, "/repo", modelId, "supervised", { context: "normal" }).modelSettings
        ?.context,
    ).toBe("normal");
  });

  it("applies Claude delegation, advisor and compact defaults together", () => {
    setHarnessModels("claude", [
      {
        id: "claude:sonnet-5-5",
        harness: "claude",
        name: "Sonnet 5.5",
        nativeId: "claude-sonnet-5-5",
      },
      { id: "claude:opus-5-5", harness: "claude", name: "Opus 5.5", nativeId: "claude-opus-5-5" },
    ]);
    saveGlobalSessionDefaults("claude", {
      extras: {
        advisor: "claude-opus-5-5",
        subagentModel: "claude-sonnet-5-5",
        subagentPolicy: "force",
        autoCompact: "off",
        autoCompactWindow: "500000",
      },
    });
    expect(newSession("claude", "/repo", "claude:sonnet-5-5").modelSettings).toMatchObject({
      advisor: "claude-opus-5-5",
      subagentModel: "claude-sonnet-5-5",
      subagentPolicy: "force",
      autoCompact: "off",
      autoCompactWindow: "500000",
    });
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
    expect(providerSessionDefaults("codex").runtimeMode).toBeUndefined();
  });
});

describe("provider session defaults carry cross-provider delegation", () => {
  const subagents = JSON.stringify([{ harness: "codex", model: "codex:gpt-6.1-sol" }]);
  const advisor = JSON.stringify({ harness: "codex", model: "codex:gpt-6.1-sol" });

  beforeEach(() => {
    localStorage.clear();
    setHarnessModels("claude", [
      {
        id: "claude:sonnet-5-5",
        harness: "claude",
        name: "Sonnet 5.5",
        nativeId: "claude-sonnet-5-5",
      },
    ]);
  });

  afterEach(() => {
    resetHarnessModelOverlays();
    localStorage.clear();
  });

  it("applies saved subagent and advisor choices to a new session", () => {
    saveGlobalSessionDefaults("claude", {
      extras: { crossSubagents: subagents, crossAdvisor: advisor },
    });
    expect(newSession("claude", "/repo", "claude:sonnet-5-5").modelSettings).toMatchObject({
      crossSubagents: subagents,
      crossAdvisor: advisor,
    });
  });

  it("drops a malformed delegation value from the defaults", () => {
    saveGlobalSessionDefaults("claude", { extras: { crossAdvisor: "{nope" } });
    expect(newSession("claude", "/repo", "claude:sonnet-5-5").modelSettings).not.toHaveProperty(
      "crossAdvisor",
    );
  });

  it("does not apply last-used delegation choices to a new session", () => {
    localStorage.setItem(
      "bycoda.lastModelSettings",
      JSON.stringify({ crossSubagents: subagents, crossAdvisor: advisor }),
    );
    const settings = newSession("claude", "/repo", "claude:sonnet-5-5").modelSettings;
    expect(settings.crossSubagents).not.toBe(subagents);
    expect(settings.crossAdvisor).not.toBe(advisor);
  });
});

describe("product delegation inheritance", () => {
  beforeEach(() => {
    localStorage.clear();
    setHarnessModels("claude", [
      { id: "claude:opus", nativeId: "opus", harness: "claude", name: "Opus" },
      { id: "claude:sonnet", nativeId: "sonnet", harness: "claude", name: "Sonnet" },
    ]);
  });
  afterEach(() => {
    resetHarnessModelOverlays();
    localStorage.clear();
  });

  it("binds both product references to each selected account without writing preferences", () => {
    for (const account of ["one", "two"]) {
      const extras = globalProviderSessionDefaults("claude", account).extras!;
      expect(extras.crossSubagents).toBe("auto");
      expect(JSON.parse(extras.crossAdvisor)).toEqual({
        harness: "claude",
        model: "claude:opus",
        providerAccountId: account,
      });
    }
    expect(localStorage.getItem("bycoda.providerSessionDefaults.v1")).toBeNull();
  });

  it("preserves explicit off and Claude legacy off at higher scopes", () => {
    saveGlobalSessionDefaults("claude", { extras: { crossSubagents: "[]", advisor: "off" } });
    expect(globalProviderSessionDefaults("claude", "one").extras).toMatchObject({
      crossSubagents: "[]",
      advisor: "off",
    });
    expect(globalProviderSessionDefaults("claude", "one").extras).not.toHaveProperty(
      "crossAdvisor",
    );
    setProjectSessionDefaults("/repo", "claude", { extras: { crossAdvisor: "null" } });
    expect(providerSessionDefaults("claude", "/repo", "one").extras?.crossAdvisor).toBe("null");
  });

  it("lets higher-scope legacy values override lower-scope cross settings", () => {
    saveGlobalSessionDefaults("claude", {
      extras: { crossAdvisor: JSON.stringify({ harness: "claude", model: "claude:opus" }) },
    });
    setProjectSessionDefaults("/repo", "claude", {
      extras: { advisor: "off", subagentModel: "sonnet" },
    });
    const extras = providerSessionDefaults("claude", "/repo", "one").extras!;
    expect(extras).not.toHaveProperty("crossAdvisor");
    expect(extras).not.toHaveProperty("crossSubagents");
  });
});
