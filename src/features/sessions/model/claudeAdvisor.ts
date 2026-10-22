import type { AgentModel, ModelSetting } from "./models";
import { CLAUDE_COMPACT_SETTINGS } from "./claudeCompact";
import { CLAUDE_SUBAGENT_SETTINGS } from "./claudeSubagents";

/** Conservative family pairings; the CLI/account remains the authority. */
export function claudeAdvisorSetting(native: string): ModelSetting | undefined {
  const id = native
    .replace(/\[.*$/, "")
    .replace(/\./g, "-")
    .replace(/^claude-/, "");
  const supported =
    /^(opus-(?:4-[678]|5(?:-5)?)|sonnet-(?:4-6|5(?:-5)?)|haiku-(?:4-5|5-5)|fable-5(?:-1)?|opus|sonnet|haiku|fable)$/.test(
      id,
    );
  if (!supported) return undefined;
  const families = id.startsWith("fable")
    ? ["fable"]
    : /^(sonnet|haiku)/.test(id)
      ? ["opus", "sonnet", "fable"]
      : ["opus", "fable"];
  return {
    id: "advisor",
    label: "Advisor",
    kind: "select",
    value: "default",
    description:
      "Experimental second opinion. Uses extra tokens; requires a compatible Claude Code version, model and account. Fable may require usage-credit consent in Claude Code.",
    options: [
      { value: "default", label: "Claude default" },
      { value: "off", label: "Off" },
      ...families.map((value) => ({
        value,
        label: value[0].toUpperCase() + value.slice(1),
      })),
    ],
  };
}

// Mirrors Claude Code's advisor compatibility table. Unknown IDs stay out of
// the advisor list; subagents can still use models returned by the catalog.
function advisorRank(native: string): number | undefined {
  const id = native
    .replace(/\[.*$/, "")
    .replace(/\./g, "-")
    .replace(/^claude-/, "");
  if (id === "haiku-4-5") return 0;
  if (id === "sonnet-4-6") return 1;
  if (id === "opus-4-6") return 2;
  if (id === "sonnet-5" || id === "haiku-5-5") return 3;
  if (id === "opus-4-7" || id === "opus-4-8") return 4;
  if (id === "sonnet-5-5") return 5;
  if (id === "opus-5" || id === "opus-5-5") return 6;
  if (id === "fable-5") return 7;
  if (id === "fable-5-1") return 8;
  return undefined;
}

export function withClaudeAdvisor(model: AgentModel, catalog: AgentModel[] = []): AgentModel {
  if (model.harness !== "claude") return model;
  const setting = claudeAdvisorSetting(model.nativeId ?? model.id.replace(/^claude:/, ""));
  const settings = [...(model.settings ?? [])];
  for (const extra of [
    ...(setting ? [setting] : []),
    ...CLAUDE_SUBAGENT_SETTINGS,
    ...CLAUDE_COMPACT_SETTINGS,
  ]) {
    if (!settings.some((s) => s.id === extra.id)) settings.push(extra);
  }
  const mainRank = advisorRank(model.nativeId ?? model.id.replace(/^claude:/, ""));
  return {
    ...model,
    settings: settings.map((extra) => {
      if (extra.id !== "advisor" && extra.id !== "subagentModel") return extra;
      const known = new Set(extra.options.map((option) => option.value));
      const pinned = catalog.flatMap((candidate) => {
        if (candidate.harness !== "claude") return [];
        const native = candidate.nativeId ?? candidate.id.replace(/^claude:/, "");
        // Family aliases don't pin a version, so keep them in their own rows.
        if (!/\d/.test(native) || known.has(native)) return [];
        const rank = advisorRank(native);
        if (
          extra.id === "advisor" &&
          (mainRank == null || rank == null || rank < mainRank || rank === 0)
        )
          return [];
        known.add(native);
        return [{ value: native, label: candidate.name }];
      });
      return { ...extra, options: [...extra.options, ...pinned] };
    }),
  };
}

const FAMILIES = new Set(["haiku", "sonnet", "opus", "fable"]);

/**
 * Limits advisor/subagent rows to the models offered for new work, so models
 * turned off in Settings disappear here too. Family aliases take the live
 * catalog's versioned label ("Opus 5.5"). The current value always stays.
 */
export function offeredDelegationSetting(
  setting: ModelSetting,
  offered: AgentModel[],
  current?: string,
): ModelSetting {
  if (setting.id !== "advisor" && setting.id !== "subagentModel") return setting;
  const natives = offered
    .filter((model) => model.harness === "claude")
    .map((model) => ({
      name: model.name,
      id: (model.nativeId ?? model.id.replace(/^claude:/, ""))
        .replace(/\[.*$/, "")
        .replace(/\./g, "-")
        .replace(/^claude-/, ""),
    }));
  const options = setting.options.flatMap((option) => {
    const value = option.value;
    if (value === "default" || value === "off") return [option];
    const alias = FAMILIES.has(value) ? natives.find((model) => model.id === value) : undefined;
    if (alias) {
      const label = alias.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
      return [{ ...option, label: label || option.label }];
    }
    const offeredHere = FAMILIES.has(value)
      ? natives.some((model) => model.id.startsWith(`${value}-`))
      : natives.some((model) => model.id === value.replace(/\./g, "-").replace(/^claude-/, ""));
    return offeredHere || value === current ? [option] : [];
  });
  return { ...setting, options };
}
