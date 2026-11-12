import { HARNESSES, type HarnessId } from "../../../shared/model/harnessIdentity";
import { humanizeModelId } from "../../../shared/model/modelNameFromId";
import { allModels, findModelIdentity, type AgentModel } from "./models";

/** Keeps a date or context tag off a native id (`claude-haiku-4-5-20251001`, `opus[1m]`) for lookup. */
function lookupKeys(raw: string): string[] {
  const colon = raw.indexOf(":");
  const slug = (colon >= 0 ? raw.slice(colon + 1) : raw).replace(/\[[^\]]*\]$/, "");
  const undated = slug.replace(/[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2})$/, "");
  const keys = [raw, slug, undated];
  // Claude ids appear with and without the vendor prefix and with dotted versions.
  const claude = undated.startsWith("claude-") ? undated : `claude-${undated}`;
  keys.push(claude, claude.replace(/\.(?=\d)/g, "-"));
  return [...new Set(keys)];
}

function sameModel(model: AgentModel, key: string): boolean {
  return model.id === key || model.nativeId === key;
}

const VENDOR_HARNESS: [RegExp, HarnessId][] = [
  [/(^|[-/:])claude|^(opus|sonnet|haiku|fable)(\b|-)/i, "claude"],
  [/(^|[-/:])(gpt|codex)|^o\d/i, "codex"],
  [/(^|[-/:])grok/i, "grok"],
  [/(^|[-/:])composer/i, "cursor"],
  [/(^|[-/:])gemini/i, "antigravity"],
];

/** The catalog entry behind a raw model id, preferring the given harness; never a fallback default. */
export function catalogModelFor(id: string, harness?: string): AgentModel | undefined {
  const raw = id.trim();
  if (!raw) return undefined;
  const keys = lookupKeys(raw);
  // Several harnesses list the same vendor model under different names; without a
  // given harness the vendor's own entry names it (`Claude Haiku 4.5`, not `Haiku 4.5`).
  const preferred = harness ?? VENDOR_HARNESS.find(([pattern]) => pattern.test(raw))?.[1];
  if (preferred) {
    for (const key of keys) {
      const hit = allModels().find((model) => model.harness === preferred && sameModel(model, key));
      if (hit) return hit;
    }
  }
  for (const key of keys) {
    const hit = findModelIdentity(key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The one readable name of any model id the user sees: the catalog's display name, else a name
 * derived from the id (`claude-haiku-4-5-20251001` → `Claude Haiku 4.5`). Never the raw id.
 * Stored and submitted values stay the raw id; only the display uses this. Render it with
 * `ModelLabel` so the provider icon comes along.
 */
export function modelDisplayName(id: string, harness?: string): string {
  const raw = id.trim();
  if (!raw) return raw;
  const found = catalogModelFor(raw, harness);
  if (!found) return humanizeModelId(raw);
  // Catalogs name older Claude models by family alone (`Haiku 4.5`); one list reads consistently.
  return /^(Opus|Sonnet|Haiku|Fable) /.test(found.name) ? `Claude ${found.name}` : found.name;
}

/** Search text of a model: the readable name plus the raw id, so either one finds it. */
export function modelSearchText(id: string, harness?: string): string {
  return `${modelDisplayName(id, harness)} ${id}`;
}

/** Provider whose icon marks a model id: the given harness (any string, e.g. a usage provider), the catalog's, else the id's vendor. */
export function modelHarness(id: string, harness?: string): HarnessId | undefined {
  const given = HARNESSES.find((known) => known === harness);
  if (given) return given;
  const found = catalogModelFor(id);
  if (found) return found.harness;
  return VENDOR_HARNESS.find(([pattern]) => pattern.test(id.trim()))?.[1];
}
