import type { AgentModel, ModelSetting } from "./models";
import { CLAUDE_COMPACT_SETTINGS } from "./claudeCompact";
import { CLAUDE_SUBAGENT_SETTINGS } from "./claudeSubagents";

const FAMILIES = new Set(["haiku", "sonnet", "opus", "fable"]);

/** Conservative family pairings; the CLI/account remains the authority. */
export function claudeAdvisorSetting(native: string): ModelSetting | undefined {
  const id = native
    .replace(/\[.*$/, "")
    .replace(/\./g, "-")
    .replace(/^claude-/, "");
  if (!FAMILIES.has(id) && advisorRank(id) == null) return undefined;
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

// Anchors from Claude Code's advisor compatibility table, oldest first.
const ADVISOR_ANCHORS: [string, number][] = [
  ["haiku-4-5", 0],
  ["sonnet-4-6", 1],
  ["opus-4-6", 2],
  ["sonnet-5", 3],
  ["haiku-5-5", 3],
  ["opus-4-7", 4],
  ["opus-4-8", 4],
  ["sonnet-5-5", 5],
  ["opus-5", 6],
  ["opus-5-5", 6],
  ["fable-5", 7],
  ["fable-5-1", 8],
];

function familyVersion(id: string): { family: string; version: number[] } | undefined {
  const match = /^([a-z]+)-(\d+(?:-\d+)*)$/.exec(id);
  if (!match || !FAMILIES.has(match[1]) || /\d{8}/.test(match[2])) return undefined;
  return { family: match[1], version: match[2].split("-").map(Number) };
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Advisor compatibility rank. A release newer than every anchor of its family
 * (Fable 5.2, a future Opus 6) ranks just above that family's newest older
 * anchor, so new models work without an app release. Older unknown ids stay out.
 */
function advisorRank(native: string): number | undefined {
  const id = native
    .replace(/\[.*$/, "")
    .replace(/\./g, "-")
    .replace(/^claude-/, "");
  const exact = ADVISOR_ANCHORS.find(([anchor]) => anchor === id);
  if (exact) return exact[1];
  const parsed = familyVersion(id);
  if (!parsed) return undefined;
  const older = ADVISOR_ANCHORS.flatMap(([anchor, rank]) => {
    const known = familyVersion(anchor);
    return known?.family === parsed.family && compareVersions(known.version, parsed.version) < 0
      ? [{ version: known.version, rank }]
      : [];
  });
  const newestFamily = ADVISOR_ANCHORS.filter(([anchor]) => anchor.startsWith(`${parsed.family}-`));
  // Only releases past the family's newest anchor; a gap between anchors is unknown.
  const newer = newestFamily.some(
    ([anchor]) => compareVersions(familyVersion(anchor)!.version, parsed.version) > 0,
  );
  if (older.length === 0 || newer) return undefined;
  const base = older.reduce((a, b) => (compareVersions(a.version, b.version) >= 0 ? a : b));
  return base.rank + 0.5;
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
  return {
    ...model,
    settings: settings.map((extra) => {
      if (extra.id !== "advisor" && extra.id !== "subagentModel") return extra;
      const known = new Set(extra.options.map((option) => option.value));
      if (extra.id === "advisor") {
        return {
          ...extra,
          options: [
            ...extra.options,
            ...offeredAdvisors(extra, catalog, model).filter((option) => !known.has(option.value)),
          ],
        };
      }
      const pinned = catalog.flatMap((candidate) => {
        if (candidate.harness !== "claude") return [];
        const native = candidate.nativeId ?? candidate.id.replace(/^claude:/, "");
        // Family aliases don't pin a version, so keep them in their own rows.
        if (!/\d/.test(native) || known.has(native)) return [];
        known.add(native);
        return [{ value: native, label: candidate.name }];
      });
      return { ...extra, options: [...extra.options, ...pinned] };
    }),
  };
}

function advisorNative(model: AgentModel): string {
  return model.aliasTarget ?? model.nativeId ?? model.id.replace(/^claude:/, "");
}

function offeredAdvisors(setting: ModelSetting, offered: AgentModel[], main: AgentModel) {
  const mainRank = advisorRank(advisorNative(main));
  const seen = new Set<string>();
  return offered.flatMap((candidate) => {
    if (candidate.harness !== "claude") return [];
    const value = advisorNative(candidate).replace(/\[.*$/, "");
    const id = value.replace(/^claude-/, "").replace(/\./g, "-");
    const rank = advisorRank(value);
    const compatible =
      mainRank == null
        ? (rank != null || FAMILIES.has(id)) &&
          setting.options.some((option) => option.value === id.split("-")[0])
        : rank != null && rank >= mainRank && rank !== 0;
    if (!compatible || seen.has(id)) return [];
    seen.add(id);
    const name = candidate.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const label =
      /^(?:Claude )?(?:Opus|Sonnet|Haiku|Fable)$/i.test(name) && rank != null
        ? id[0].toUpperCase() + id.slice(1).replace("-", " ").replace(/-/g, ".")
        : name;
    return [{ value, label }];
  });
}

/**
 * Limits advisor/subagent rows to the models offered for new work, so models
 * turned off in Settings disappear here too. Family aliases take the live
 * catalog's versioned label ("Opus 5.5"). Advisors use concrete alias targets
 * and the main model's compatibility rank. The current value always stays.
 */
export function offeredDelegationSetting(
  setting: ModelSetting,
  offered: AgentModel[],
  current?: string,
  main?: AgentModel,
): ModelSetting {
  if (setting.id !== "advisor" && setting.id !== "subagentModel") return setting;
  if (setting.id === "advisor" && main) {
    const options = [
      ...setting.options.filter((option) => option.value === "default" || option.value === "off"),
      ...offeredAdvisors(setting, offered, main),
    ];
    if (current && !options.some((option) => option.value === current)) {
      const saved = setting.options.find((option) => option.value === current);
      const alias = offered.find(
        (model) => model.harness === "claude" && model.nativeId === current,
      );
      options.push({ value: current, label: alias?.name ?? saved?.label ?? current });
    }
    return { ...setting, options };
  }
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
