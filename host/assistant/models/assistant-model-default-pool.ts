import type { AssistantModelPoolRow } from "../../../src/shared/model/assistantModelPool";

/** Only Codex and Claude rows carry a provider account; any other harness must leave it unset. */
export const defaultPoolAccount = (harness: string) =>
  harness === "codex" || harness === "claude" ? { providerAccountId: "default" } : {};
import { assistantRoleExecution } from "../../../src/shared/model/assistantRoles";
import type {
  AssistantExecution,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";

/** The slice of a Host catalog model the default pool reads. */
export type CatalogModel = {
  id: string;
  name?: string;
  settings?: { id: string; kind?: string; value: string; options: { value: string }[] }[];
};
export type CatalogModels = Partial<Record<string, CatalogModel[]>>;
export type PoolProfile = Pick<
  AssistantProfile,
  "execution" | "chiefExecution" | "replyExecution" | "planningExecution"
>;

/** Value class of a model: 0 small/fast/cheap, 1 standard, 2 flagship. Judged from the model name; unknown names are standard. */
export function modelValueClass(model: CatalogModel): 0 | 1 | 2 {
  const text = `${model.name ?? ""} ${model.id}`.toLowerCase();
  if (/\b(mini|nano|haiku|flash|lite|spark|small|instant|swift)\b|-fast\b/.test(text)) return 0;
  if (/\b(opus|fable|pro|ultra|max|heavy|large)\b/.test(text)) return 2;
  return 1;
}

/** First "major.minor" number in the name; breaks ties inside one value class (newer first). */
function versionOf(model: CatalogModel): number {
  const match = /(\d+)(?:[.-](\d+))?/.exec(`${model.name ?? ""} ${model.id}`);
  return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : 0;
}

type Candidate = { harness: string; model: CatalogModel; valueClass: number; order: number };

const EFFORT_BY_ROLE = {
  deep: ["high", "xhigh", "medium"],
  worker: ["medium", "high"],
  reply: ["low", "minimal", "medium"],
} as const;

function settingsFor(model: CatalogModel, preferred: readonly string[]): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const setting of model.settings ?? []) {
    const isEffort = ["effort", "reasoning", "reasoningEffort", "thinking", "variant"].includes(
      setting.id,
    );
    const pick = isEffort
      ? preferred.find((value) => setting.options.some((option) => option.value === value))
      : undefined;
    settings[setting.id] = pick ?? setting.value;
  }
  return settings;
}

const modelKey = (e: Pick<AssistantExecution, "harness" | "model">) => `${e.harness}\0${e.model}`;

/**
 * Value-aware default for a profile that never saved a pool, or undefined to keep the profile mirror.
 * Applies only while all four role fields name the same model (the untouched default); a profile that
 * deliberately names different models per role is mirrored as is. Candidates are the catalog models of
 * the harnesses the profile already uses, ranked by value class then version. Row order is the
 * fallback order: flagship (Chief, Planning) -> mid (Worker, then Chief/Planning fallback) ->
 * cheapest (Reply, then Worker fallback). Fewer than two candidates yields undefined.
 */
export function valueAwareAssistantPool(
  profile: PoolProfile,
  catalog: CatalogModels | undefined,
): AssistantModelPoolRow[] | undefined {
  const base = profile.execution;
  if (!base || !catalog) return undefined;
  const roles = (["planning", "chief", "reply"] as const).map((role) =>
    assistantRoleExecution(profile, role),
  );
  if (roles.some((e) => e && modelKey(e) !== modelKey(base))) return undefined;

  const harnesses = new Set([base.harness]);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const harness of harnesses)
    for (const model of catalog[harness] ?? []) {
      if (seen.has(modelKey({ harness: harness as never, model: model.id }))) continue;
      seen.add(modelKey({ harness: harness as never, model: model.id }));
      candidates.push({
        harness,
        model,
        valueClass: modelValueClass(model),
        order: candidates.length,
      });
    }
  if (candidates.length < 2) return undefined;
  const ranked = [...candidates].sort(
    (a, b) =>
      b.valueClass - a.valueClass || versionOf(b.model) - versionOf(a.model) || a.order - b.order,
  );
  const top = ranked[0]!;
  const cheap = ranked.at(-1)!;
  const mid = ranked.length >= 3 ? ranked[1]! : undefined;

  const plan: [Candidate, AssistantModelPoolRow["roles"], readonly string[]][] =
    top.valueClass === cheap.valueClass
      ? [
          [top, ["worker", "planning", "chief", "reply"], EFFORT_BY_ROLE.worker],
          [cheap, ["worker", "planning", "chief", "reply"], EFFORT_BY_ROLE.worker],
        ]
      : mid
        ? [
            [top, ["chief", "planning"], EFFORT_BY_ROLE.deep],
            [mid, ["worker", "chief", "planning"], EFFORT_BY_ROLE.worker],
            [cheap, ["reply", "worker"], EFFORT_BY_ROLE.reply],
          ]
        : [
            [top, ["worker", "planning", "chief"], EFFORT_BY_ROLE.deep],
            [cheap, ["reply", "worker"], EFFORT_BY_ROLE.reply],
          ];
  return plan.map(([candidate, rowRoles, effort], index) => ({
    id: `derived-${index + 1}`,
    harness: candidate.harness as AssistantModelPoolRow["harness"],
    ...defaultPoolAccount(candidate.harness),
    model: candidate.model.id,
    modelSettings: settingsFor(candidate.model, effort),
    runtimeMode: base.runtimeMode,
    maxRunMinutes: base.maxRunMinutes,
    roles: rowRoles,
    minRemainingPercent: 0,
    unknownLimit: "use",
  }));
}
