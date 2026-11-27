import type { ModelCatalogFact } from "../../../shared/model/host-contracts/model-routing";
import { liveFactsFor } from "./liveCatalogFacts";

/**
 * Benefit and list price of the current catalog families, the baseline that smart setup ranks
 * by and hands to the AI planner. `score` is a 0-100 capability estimate; prices are standard
 * API dollars per million input and output tokens. Prices (and scores of families the table
 * does not know) come live from OpenRouter / Artificial Analysis via the Host
 * (`liveCatalogFacts.ts`); the hand-kept table below is the ordering of record and the offline
 * fallback.
 *
 * shortcut: the table was researched from https://artificialanalysis.ai on 2026-11-27 (score =
 * 30 + Intelligence Index, the live mapping below; prices from each model page). It MUST be kept
 * current: refresh it whenever a provider ships a family or prices change (check
 * artificialanalysis.ai/leaderboards/models and the per-model pages), or drop a row once the live
 * index ranks it as the owner expects. Rows marked legacy are not listed by Artificial Analysis;
 * they keep their earlier researched values, held below their successor's score.
 */
export type CatalogModelFacts = { score: number; inputUsd: number; outputUsd: number };

const facts = (score: number, inputUsd: number, outputUsd: number): CatalogModelFacts => ({
  score,
  inputUsd,
  outputUsd,
});

// Matched against the normalized id; the first match wins, so specific versions come first.
const TABLE: readonly [RegExp, CatalogModelFacts][] = [
  // Artificial Analysis 2026-11-27, https://artificialanalysis.ai/models/<slug>; index in comments.
  [/^(?:fable|mythos)-5[-.]2(?:\b|_)/, facts(95, 8, 40)], // 65
  [/^gpt-6(?:\.\d+)?-astra/, facts(92, 8, 40)], // 62
  [/^opus-5[-.]5(?:\b|_)/, facts(89, 4, 20)], // 59
  [/^gpt-6(?:\.\d+)?-sol/, facts(87, 2, 10)], // 57
  [/^sonnet-5[-.]5(?:\b|_)/, facts(85, 2, 10)], // 55
  [/^gpt-6(?:\.\d+)?-terra/, facts(81, 1, 5)], // 51
  [/^haiku-5/, facts(67, 0.1, 0.5)], // 37
  [/^grok-4[-.]7(?:\b|_)/, facts(65, 2, 6)], // 35
  [/^glm-5[-.]3-flash/, facts(58, 0.15, 0.5)], // 28
  [/^glm-5[-.]3(?:\b|_)/, facts(62, 1.4, 4.4)], // 32
  [/^gpt-6(?:\.\d+)?-luna/, facts(58, 0.1, 0.5)], // 28
  // Legacy: not listed by Artificial Analysis, earlier values kept below the successor.
  [/^(?:fable|mythos)-5(?:\b|_)/, facts(94, 10, 50)],
  [/^opus-5(?:\b|_)/, facts(88, 5, 25)],
  [/^sonnet-5/, facts(82, 2, 10)],
  [/^grok-4[-.]6(?:\b|_)/, facts(64, 2, 6)],
  [/^grok-4[-.]5(?:\b|_)/, facts(63, 2, 6)],
  [/^glm-5[-.]2-flash/, facts(57, 0.37, 1.25)],
  [/^glm-5[-.]2(?:\b|_)/, facts(61, 1.4, 4.4)],
  [/^glm-5(?:\b|_)/, facts(60, 1, 3.2)],
  [/^haiku-4[-.]5/, facts(60, 1, 5)],
  [/^haiku(?:\b|_)/, facts(67, 0.1, 0.5)],
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

/** Live catalog family of a model id: dots become dashes and a dated or `-latest` suffix goes. */
function liveFamilies(modelId: string): string[] {
  const id = normalize(modelId)
    .replace(/\./g, "-")
    .replace(/-(?:\d{8}|latest)$/, "");
  return [id, `claude-${id}`];
}

/** Score on the researched scale for a model only the live catalog rates. */
const scoreFromIntelligence = (index: number) => Math.min(100, 30 + index);

/**
 * Prices come from the live catalog when it lists the family. The score is the researched
 * table's (owner-validated ordering) and, for a family the table does not know, `30 +` the
 * live Artificial Analysis index. Undefined when neither source can rate the model.
 */
export function catalogModelFacts(modelId: string): CatalogModelFacts | undefined {
  const id = normalize(modelId);
  const researched = TABLE.find(([pattern]) => pattern.test(id))?.[1];
  let live: ModelCatalogFact | undefined;
  for (const family of liveFamilies(modelId)) {
    live = liveFactsFor(family);
    if (live) break;
  }
  const score =
    researched?.score ??
    (live?.intelligenceIndex === undefined
      ? undefined
      : scoreFromIntelligence(live.intelligenceIndex));
  if (score === undefined) return undefined;
  const prices = live ?? researched;
  if (!prices) return undefined;
  return { score, inputUsd: prices.inputUsd, outputUsd: prices.outputUsd };
}

/** Mean of input and output list price per million tokens. */
export const blendedUsd = (value: CatalogModelFacts) => (value.inputUsd + value.outputUsd) / 2;

/**
 * Benefit per cost: capability minus 6 points per doubling of the blended price, so a model
 * that costs four times as much must be 12 points better to rank above.
 */
export const valueScore = (value: CatalogModelFacts) =>
  value.score - 6 * Math.log2(Math.max(0.25, blendedUsd(value)));
