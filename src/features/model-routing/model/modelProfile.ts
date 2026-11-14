import type { ModelRoutingScope } from "../../../shared/model/host-contracts/model-routing";
import { subagentTier } from "../../../shared/model/automaticSubagents";
import { usageRate } from "../../providers/public/providerUsage";

export type ModelProfile = {
  /** 5 is the strongest tier. */
  intelligence: 1 | 2 | 3 | 4 | 5;
  /** 1 is the cheapest bucket. */
  cost: 1 | 2 | 3 | 4;
  /** True when either dimension came from a name heuristic instead of a known table. */
  estimated: boolean;
};

const TIER_INTELLIGENCE = { best: 5, strong: 4, medium: 3, light: 2 } as const;

// Name heuristics for models the tier table does not know; first match wins.
const NAME_INTELLIGENCE: readonly [ModelProfile["intelligence"], ReadonlySet<string>][] = [
  [5, new Set(["ultra", "max", "fable", "mythos"])],
  [4, new Set(["opus", "pro", "sol", "large", "thinking", "reasoner"])],
  [2, new Set(["haiku", "luna", "nano", "lite", "small", "tiny", "instant"])],
  [3, new Set(["sonnet", "terra", "mini", "flash", "medium", "fast"])],
];

function estimateIntelligence(modelId: string): ModelProfile["intelligence"] {
  const words = new Set(modelId.toLowerCase().split(/[^a-z0-9]+/));
  for (const [level, names] of NAME_INTELLIGENCE)
    if ([...names].some((name) => words.has(name))) return level;
  return 3;
}

/**
 * Cost bucket from the blended list price, the mean of input and output dollars per million
 * tokens: up to 4 is 1, up to 10 is 2, up to 20 is 3, above that 4.
 */
function costBucket(input: number, output: number): ModelProfile["cost"] {
  const blended = (input + output) / 2;
  return blended <= 4 ? 1 : blended <= 10 ? 2 : blended <= 20 ? 3 : 4;
}

const COST_FROM_INTELLIGENCE = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 } as const;

/** Known models come from the tier and price tables; the rest are estimated from the name. */
export function modelProfile(harness: string, modelId: string): ModelProfile {
  const tier = subagentTier(`${harness}:${modelId}`);
  const known = tier === "unranked" ? undefined : TIER_INTELLIGENCE[tier];
  const intelligence = known ?? estimateIntelligence(modelId);
  const rate = usageRate(modelId);
  return {
    intelligence,
    cost: rate ? costBucket(rate.input, rate.output) : COST_FROM_INTELLIGENCE[intelligence],
    estimated: known === undefined || !rate,
  };
}

const WORK_WORDS = ["work", "iş", "is", "şirket", "company", "corp", "office", "job"];
const PERSONAL_WORDS = ["personal", "kişisel", "private", "home", "kendi"];

const hasWord = (label: string, words: string[]) => {
  const tokens = label
    .toLowerCase()
    .replace(/̇/g, "")
    .split(/[^\p{L}\p{N}]+/u);
  return words.some((word) => tokens.includes(word));
};

/** The scope an account label names, or undefined when it names both or neither. */
export function inferAccountKind(label: string): ModelRoutingScope | undefined {
  const work = hasWord(label, WORK_WORDS);
  const personal = hasWord(label, PERSONAL_WORDS);
  return work === personal ? undefined : work ? "work" : "personal";
}
