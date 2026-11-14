/**
 * Researched benefit and list price of the current catalog families, the baseline that smart
 * setup ranks by and hands to the AI planner. `score` is a 0-100 capability estimate from
 * public coding leaderboards (SWE-bench Pro / Verified); prices are standard API dollars per
 * million input and output tokens.
 *
 * shortcut: a hand-kept table researched 2026-11-15 from third-party price trackers and
 * leaderboards; update it when a provider ships or reprices a family, or replace it with a
 * live catalog feed once one carries capability and price.
 */
export type CatalogModelFacts = { score: number; inputUsd: number; outputUsd: number };

const facts = (score: number, inputUsd: number, outputUsd: number): CatalogModelFacts => ({
  score,
  inputUsd,
  outputUsd,
});

// Matched against the normalized id; the first match wins, so specific versions come first.
const TABLE: readonly [RegExp, CatalogModelFacts][] = [
  [/^(?:fable|mythos)-5[-.]2(?:\b|_)/, facts(96, 8, 40)],
  [/^(?:fable|mythos)-5(?:\b|_)/, facts(94, 10, 50)],
  [/^gpt-6(?:\.\d+)?-astra/, facts(95, 10, 50)],
  [/^opus-5[-.]5(?:\b|_)/, facts(92, 4, 20)],
  [/^opus-5(?:\b|_)/, facts(90, 5, 25)],
  [/^gpt-6(?:\.\d+)?-sol/, facts(90, 2, 10)],
  [/^grok-4[-.]7(?:\b|_)/, facts(86, 2, 6)],
  [/^grok-4[-.]6(?:\b|_)/, facts(84, 2, 6)],
  [/^sonnet-5/, facts(82, 2, 10)],
  [/^grok-4[-.]5(?:\b|_)/, facts(80, 2, 6)],
  [/^gpt-6(?:\.\d+)?-terra/, facts(80, 1, 5)],
  [/^glm-5[-.][23]-flash/, facts(66, 0.37, 1.25)],
  [/^glm-5[-.][23](?:\b|_)/, facts(80, 1.4, 4.4)],
  [/^glm-5(?:\b|_)/, facts(76, 1, 3.2)],
  [/^haiku-4[-.]5/, facts(60, 1, 5)],
  [/^haiku(?:-5|\b|_)/, facts(68, 0.1, 0.5)],
  [/^gpt-6(?:\.\d+)?-luna/, facts(66, 0.1, 0.5)],
];

/** `codex:gpt-6.1-sol`, `opencode/glm-5` and `claude-opus-5-5` all name their family. */
function normalize(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:/, "")
    .replace(/^.*\//, "")
    .replace(/^claude-/, "");
}

export function catalogModelFacts(modelId: string): CatalogModelFacts | undefined {
  const id = normalize(modelId);
  return TABLE.find(([pattern]) => pattern.test(id))?.[1];
}

/** Mean of input and output list price per million tokens. */
export const blendedUsd = (value: CatalogModelFacts) => (value.inputUsd + value.outputUsd) / 2;

/**
 * Benefit per cost: capability minus 6 points per doubling of the blended price, so a model
 * that costs four times as much must be 12 points better to rank above.
 */
export const valueScore = (value: CatalogModelFacts) =>
  value.score - 6 * Math.log2(Math.max(0.25, blendedUsd(value)));
