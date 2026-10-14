import { describe, expect, it } from "vitest";
import { claudeAdvisorSetting } from "./claudeAdvisor";
import {
  buildClaudeSpawnArgs,
  claudeAutoCompactSettings,
  claudeSettingsKey,
} from "../../../integrations/harness/providers/claude/claudeProtocol";

describe("Claude advisor selection", () => {
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
