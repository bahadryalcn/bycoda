import { describe, expect, it } from "vitest";
import { claudeAdvisorSetting, offeredDelegationSetting, withClaudeAdvisor } from "./claudeAdvisor";
import { mergeModelSettings } from "./models";
import type { AgentModel } from "./models";
import {
  buildClaudeSpawnArgs,
  claudeAutoCompactSettings,
  claudeSettingsKey,
} from "../../../integrations/harness/providers/claude/claudeProtocol";

describe("Claude advisor selection", () => {
  const model = (nativeId: string, name: string, aliasTarget?: string): AgentModel => ({
    id: `claude:${nativeId}`,
    harness: "claude",
    nativeId,
    name,
    aliasTarget,
  });
  it("builds versioned advisor choices from the offered catalog for a moving main alias", () => {
    const main = model("opus", "Opus 5.5", "claude-opus-5-5");
    const offered = [
      main,
      model("fable", "Fable 5.1", "claude-fable-5-1"),
      model("claude-sonnet-4-6", "Sonnet 4.6"),
      model("claude-opus-4-8", "Opus 4.8"),
    ];
    const setting = claudeAdvisorSetting("opus")!;
    expect(offeredDelegationSetting(setting, offered, undefined, main).options).toEqual([
      { value: "default", label: "Claude default" },
      { value: "off", label: "Off" },
      { value: "claude-opus-5-5", label: "Opus 5.5" },
      { value: "claude-fable-5-1", label: "Fable 5.1" },
    ]);
  });
  it("uses version-only catalogs and retains a saved advisor missing from offered models", () => {
    const main = model("claude-fable-5-1", "Fable 5.1");
    const offered = [
      main,
      model("claude-opus-5-5", "Opus 5.5"),
      model("claude-fable-5", "Fable 5"),
    ];
    const setting = claudeAdvisorSetting(main.nativeId!)!;
    expect(
      offeredDelegationSetting(setting, offered, undefined, main).options.map((o) => o.label),
    ).toEqual(["Claude default", "Off", "Fable 5.1"]);
    expect(
      offeredDelegationSetting(setting, [main], "claude-private-advisor", main).options.at(-1),
    ).toEqual({ value: "claude-private-advisor", label: "claude-private-advisor" });
  });
  it("deduplicates resolved aliases, labels generic names and excludes unknown targets", () => {
    const main = model("opus", "Opus", "claude-opus-5-5");
    const offered = [
      main,
      model("claude-opus-5-5", "Opus 5.5"),
      model("fable", "Fable", "claude-fable-5-1"),
      model("claude-fable-99", "Fable 99"),
    ];
    const setting = claudeAdvisorSetting("opus")!;
    expect(offeredDelegationSetting(setting, offered, undefined, main).options.slice(2)).toEqual([
      { value: "claude-opus-5-5", label: "Opus 5.5" },
      { value: "claude-fable-5-1", label: "Fable 5.1" },
    ]);
    expect(offeredDelegationSetting(setting, [main], "opus", main).options.at(-1)?.value).toBe(
      "opus",
    );
  });
  it("retains a versioned choice through settings normalization before launching", () => {
    const main = model("opus", "Opus 5.5", "claude-opus-5-5");
    const fable = model("fable", "Fable 5.1", "claude-fable-5-1");
    const enriched = withClaudeAdvisor(main, [main, fable]);
    expect(mergeModelSettings(enriched, { advisor: "claude-fable-5-1" }).advisor).toBe(
      "claude-fable-5-1",
    );
    const unresolved = withClaudeAdvisor({ ...main, aliasTarget: undefined }, [main, fable]);
    expect(mergeModelSettings(unresolved, { advisor: "claude-fable-5-1" }).advisor).toBe(
      "claude-fable-5-1",
    );
  });
  it("preserves pinned advisor and subagent versions in CLI arguments", () => {
    const args = buildClaudeSpawnArgs({
      model: "claude-sonnet-5",
      advisor: "claude-opus-5-5",
      subagentModel: "claude-haiku-4-5",
    });
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5");
    expect(args[args.indexOf("--advisor") + 1]).toBe("claude-opus-5-5");
    expect(JSON.parse(args[args.indexOf("--settings") + 1]).env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(
      "claude-haiku-4-5",
    );
  });
  it("combines advisor and subagent choices in a child-local environment", () => {
    const args = buildClaudeSpawnArgs({
      model: "sonnet",
      advisor: "off",
      subagentModel: "haiku",
      subagentPolicy: "force",
      settings: { env: { KEEP: "yes" } },
    });
    expect(args).not.toContain("--subagents");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(JSON.parse(args[args.indexOf("--settings") + 1]).env).toEqual({
      KEEP: "yes",
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
      CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
    });
    const fallback = buildClaudeSpawnArgs({
      subagentModel: "haiku",
      subagentPolicy: "fallback",
    });
    expect(
      JSON.parse(fallback[fallback.indexOf("--settings") + 1]).env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE,
    ).toBe("0");
    const defaults = buildClaudeSpawnArgs({
      subagentModel: "default",
      subagentPolicy: "force",
    });
    expect(JSON.parse(defaults[defaults.indexOf("--settings") + 1]).env).toBeUndefined();
  });
  it("removes Claude's native subagent tool when the selection cannot run there", () => {
    const args = buildClaudeSpawnArgs({
      subagentModel: "off",
      disabledSkills: ["good-css"],
    });
    const at = args.indexOf("--disallowedTools");
    expect(args.filter((arg) => arg === "--disallowedTools")).toHaveLength(1);
    expect(args.slice(at + 1, at + 4)).toEqual(["Skill(good-css)", "Agent", "Task"]);
    expect(JSON.parse(args[args.indexOf("--settings") + 1]).env).toBeUndefined();
  });
  it("rebinds when the subagent model or policy changes", () => {
    const input = {
      model: "sonnet",
      runtimeMode: "supervised" as const,
      subagentModel: "haiku",
    };
    expect(claudeSettingsKey(input)).not.toBe(
      claudeSettingsKey({ ...input, subagentModel: "opus" }),
    );
    expect(claudeSettingsKey(input)).not.toBe(
      claudeSettingsKey({ ...input, subagentPolicy: "force" }),
    );
  });
  it("maps auto-compact extras to Claude settings and rebinds on change", () => {
    expect(claudeAutoCompactSettings({})).toEqual({});
    expect(
      claudeAutoCompactSettings({
        autoCompact: "default",
        autoCompactWindow: "default",
      }),
    ).toEqual({});
    expect(
      claudeAutoCompactSettings({
        autoCompact: "on",
        autoCompactWindow: "500000",
      }),
    ).toEqual({
      autoCompactEnabled: true,
      autoCompactWindow: 500000,
      env: {
        DISABLE_AUTO_COMPACT: "0",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000",
      },
    });
    expect(
      claudeAutoCompactSettings({
        autoCompact: "off",
        autoCompactWindow: "500000",
      }),
    ).toEqual({ autoCompactEnabled: false });
    expect(claudeAutoCompactSettings({ autoCompactWindow: "50000" })).toEqual({});
    const args = buildClaudeSpawnArgs({
      subagentModel: "haiku",
      settings: claudeAutoCompactSettings({ autoCompactWindow: "300000" }),
    });
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({
      autoCompactWindow: 300000,
      env: {
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000",
        CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
        CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "0",
      },
    });
    const input = { model: "opus", runtimeMode: "supervised" as const };
    expect(claudeSettingsKey(input)).not.toBe(claudeSettingsKey({ ...input, autoCompact: "off" }));
    expect(claudeSettingsKey(input)).not.toBe(
      claudeSettingsKey({ ...input, autoCompactWindow: "300000" }),
    );
  });
  it("limits pairings for Fable and Opus, and excludes unsupported models", () => {
    expect(claudeAdvisorSetting("claude-fable-5")?.options.map((o) => o.value)).toEqual([
      "default",
      "off",
      "fable",
    ]);
    expect(claudeAdvisorSetting("claude-opus-5-5")?.options.map((o) => o.value)).toEqual([
      "default",
      "off",
      "opus",
      "fable",
    ]);
    expect(claudeAdvisorSetting("claude-haiku-4-5")?.options.some((o) => o.value === "opus")).toBe(
      true,
    );
    expect(claudeAdvisorSetting("claude-opus-4-5")).toBeUndefined();
    expect(claudeAdvisorSetting("custom-model")).toBeUndefined();
  });
  it("forwards an advisor without changing user defaults and disables only this child", () => {
    expect(buildClaudeSpawnArgs({ advisor: "opus" })).toContain("--advisor");
    const off = buildClaudeSpawnArgs({
      advisor: "off",
      settings: { env: { KEEP: "yes" } },
    });
    expect(off).not.toContain("--advisor");
    expect(JSON.parse(off[off.indexOf("--settings") + 1]).env).toEqual({
      KEEP: "yes",
      CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
    });
    expect(buildClaudeSpawnArgs({ advisor: "default" })).not.toContain("--advisor");
  });
  it("requires a process rebind when the advisor changes", () => {
    const input = { model: "sonnet", runtimeMode: "supervised" as const };
    expect(claudeSettingsKey({ ...input, advisor: "opus" })).not.toBe(
      claudeSettingsKey({ ...input, advisor: "off" }),
    );
  });
});
