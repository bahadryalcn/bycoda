import type { HarnessId } from "./harnessIdentity";
import {
  AUTOMATIC_SUBAGENTS,
  DELEGATION_LIMITS,
  decodeSubagents,
  delegateRefKey,
  type DelegateModelRef,
} from "./host-contracts/delegation";

export const SUBAGENT_TIERS = ["best", "strong", "medium", "light", "unranked"] as const;
export type SubagentTier = (typeof SUBAGENT_TIERS)[number];
// Family anchors, not an allowlist. Unknown/new families remain usable, last.
// Claude ordering is owner-defined; OpenAI ordering follows usagePricing's
// pro / full / mini / nano and Sol / Terra / Luna price families.
const FAMILY_PATTERNS: readonly [SubagentTier, RegExp][] = [
  ["best", /(?:fable|mythos|astra|(?:gpt[-\w.]*|gemini[-\w.]*)[-/]pro)(?:\b|_)/i],
  ["light", /(?:haiku|luna|nano|flash-lite)(?:\b|_)/i],
  ["medium", /(?:sonnet|terra|mini|flash|fast)(?:\b|_)/i],
  ["strong", /(?:opus|sol|gpt-\d|composer|grok-\d|glm-\d|gemini.*pro)/i],
];
/** Harness-keyed family anchors. Aggregating harnesses may expose vendor models.
 * Catalog main-model families without a published price hierarchy are Strong
 * anchors only; this is a product heuristic, not a benchmark or price estimate. */
export const SUBAGENT_TIER_PATTERNS: Record<HarnessId, readonly [SubagentTier, RegExp][]> = {
  claude: [
    ["best", /fable|mythos/i],
    ["strong", /opus/i],
    ["medium", /sonnet/i],
    ["light", /haiku/i],
  ],
  codex: FAMILY_PATTERNS,
  grok: [
    ["light", /mini|fast/i],
    ["strong", /grok-\d/i],
  ],
  cursor: FAMILY_PATTERNS,
  antigravity: [
    ["light", /flash-lite/i],
    ["medium", /flash/i],
    ["strong", /gemini.*pro/i],
  ],
  opencode: FAMILY_PATTERNS,
  pi: FAMILY_PATTERNS,
  omp: FAMILY_PATTERNS,
  hermes: FAMILY_PATTERNS,
  fx: FAMILY_PATTERNS,
  acp: FAMILY_PATTERNS,
};

export function subagentTier(model: string): SubagentTier {
  const harness = model.split(":")[0] as HarnessId;
  return (
    (SUBAGENT_TIER_PATTERNS[harness] ?? FAMILY_PATTERNS).find(([, pattern]) =>
      pattern.test(model),
    )?.[0] ?? "unranked"
  );
}

export type AutomaticSubagentInput = {
  harness: HarnessId;
  providerAccountId?: string;
  models: readonly { id: string; harness: HarnessId; enabled?: boolean }[];
  providers: readonly HarnessId[];
  defaultAccounts?: Partial<Record<HarnessId, string>>;
  signedOutAccounts?: ReadonlySet<string>;
};
export type RankedSubagent = DelegateModelRef & { tier: SubagentTier };

/** Resolve at use time. Round-robin provider/tier buckets preserve diversity
 * before filling with further versions. Final order is rank, provider, model. */
export function resolveSubagents(value: unknown, input: AutomaticSubagentInput): RankedSubagent[] {
  if (value !== AUTOMATIC_SUBAGENTS)
    return decodeSubagents(value).map((ref) => ({ ...ref, tier: subagentTier(ref.model) }));
  const seen = new Set<string>();
  const all = input.models.flatMap((model): RankedSubagent[] => {
    if (model.enabled === false || !input.providers.includes(model.harness)) return [];
    const account =
      model.harness === input.harness
        ? (input.providerAccountId ?? "default")
        : (input.defaultAccounts?.[model.harness] ?? "default");
    if (input.signedOutAccounts?.has(`${model.harness}:${account}`)) return [];
    const ref = {
      harness: model.harness,
      model: model.id,
      ...(["claude", "codex"].includes(model.harness) ? { providerAccountId: account } : {}),
      tier: subagentTier(model.id),
    };
    const key = delegateRefKey(ref);
    if (seen.has(key)) return [];
    seen.add(key);
    return [ref];
  });
  const compare = (a: RankedSubagent, b: RankedSubagent) =>
    SUBAGENT_TIERS.indexOf(a.tier) - SUBAGENT_TIERS.indexOf(b.tier) ||
    a.harness.localeCompare(b.harness, "en") ||
    b.model.localeCompare(a.model, "en", { numeric: true });
  all.sort(compare);
  if (all.length <= DELEGATION_LIMITS.subagentModels) return all;
  const buckets = new Map<string, RankedSubagent[]>();
  for (const ref of all) {
    const key = `${ref.harness}:${ref.tier}`;
    buckets.set(key, [...(buckets.get(key) ?? []), ref]);
  }
  const providers = [...new Set(all.map((ref) => ref.harness))].sort();
  const result: RankedSubagent[] = [];
  const take = (ref: RankedSubagent | undefined) => {
    if (!ref || result.includes(ref) || result.length >= DELEGATION_LIMITS.subagentModels) return;
    result.push(ref);
    const bucket = buckets.get(`${ref.harness}:${ref.tier}`)!;
    bucket.splice(bucket.indexOf(ref), 1);
  };
  for (const provider of providers) take(all.find((ref) => ref.harness === provider));
  for (const tier of SUBAGENT_TIERS) take(all.find((ref) => ref.tier === tier));
  for (const bucket of buckets.values()) take(bucket[0]);
  // Each round visits every provider before another tier/version of it.
  while (result.length < DELEGATION_LIMITS.subagentModels) {
    let added = false;
    for (const provider of providers) {
      const bucket = SUBAGENT_TIERS.map((tier) => buckets.get(`${provider}:${tier}`)).find(
        (rows) => rows?.length,
      );
      if (!bucket?.length) continue;
      result.push(bucket.shift()!);
      added = true;
      if (result.length === DELEGATION_LIMITS.subagentModels) break;
    }
    if (!added) break;
  }
  return result.sort(compare);
}
