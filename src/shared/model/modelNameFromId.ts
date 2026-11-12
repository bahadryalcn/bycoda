/**
 * Readable model name derived from a raw model id, for ids no catalog knows.
 * Pure and dependency-free so the catalog (`models.ts`) can use it for fallbacks;
 * UI code calls `modelDisplayName` in the sessions feature, never this directly.
 *
 * `claude-haiku-4-5-20251001` → `Claude Haiku 4.5`, `gpt-5.4-codex-mini` → `GPT-5.4-Codex-Mini`.
 */

const ACRONYMS = new Set(["gpt", "glm", "oss", "ai", "llm", "xai"]);
const BRAND_CASE: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  qwen: "Qwen",
};
const DATE_SUFFIX = /[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2}|\d{4})$/;

function titleToken(token: string): string {
  const lower = token.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  if (BRAND_CASE[lower]) return BRAND_CASE[lower];
  // Parameter counts (`70b`, `405b`) and quantisations stay compact capitals.
  if (/^\d+(?:\.\d+)?[bkmt]$/i.test(token)) return token.toUpperCase();
  // OpenAI-style reasoning families (`o3`, `o4`) are lowercase brand names.
  if (/^o\d/i.test(token)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Context-window tags of a native id (`[1m]`) become a trailing note. */
function splitContextTag(id: string): { base: string; context: string } {
  const match = /^(.*?)\s*\[(\d+[km])\]$/i.exec(id);
  return match
    ? { base: match[1], context: `(${match[2].toUpperCase()} context)` }
    : { base: id, context: "" };
}

export function humanizeModelId(id: string): string {
  const { base, context } = splitContextTag(id.trim());
  // Drop the harness/vendor routing prefix (`claude:`, `openrouter/anthropic/`) and the date suffix.
  const last = base.split(/[:/]/).filter(Boolean).pop() ?? base;
  const withoutDate = last.replace(DATE_SUFFIX, "");
  const tokens = withoutDate.split(/[-_\s]+/).filter(Boolean);
  if (tokens.length === 0) return id.trim();

  const words: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^\d{1,2}$/.test(token)) {
      // Consecutive short numbers are one version: `4-5` → `4.5`.
      let version = token;
      while (index + 1 < tokens.length && /^\d{1,2}$/.test(tokens[index + 1])) {
        version += `.${tokens[++index]}`;
      }
      words.push(version);
    } else {
      words.push(titleToken(token));
    }
    index += 1;
  }
  // The GPT family is written hyphenated, as the catalog does: `GPT-5.6-Sol`.
  const hyphenated = words[0] === "GPT" && /^\d/.test(words[1] ?? "");
  const name = words.join(hyphenated ? "-" : " ");
  return context ? `${name} ${context}` : name;
}
