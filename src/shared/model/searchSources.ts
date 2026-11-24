import { asRecord } from "../lib/records";

/** One page a provider's web search returned. */
export type SearchSource = {
  title: string;
  url: string;
  /** Host without a leading `www.`, the label the chip shows. */
  domain: string;
};

export const MAX_SEARCH_SOURCES = 20;
const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 2_048;

export function searchSourceDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.hostname.replace(/^www\./i, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate provider output and saved/remote history alike: http(s) links only, one row
 * per URL, bounded in count and length. Rows with no title fall back to the domain.
 */
export function normalizeSearchSources(raw: unknown): SearchSource[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    const url = typeof row?.url === "string" ? row.url.trim() : "";
    if (!url || url.length > MAX_URL_CHARS || seen.has(url)) continue;
    const domain = searchSourceDomain(url);
    if (!domain) continue;
    const title = typeof row?.title === "string" ? row.title.trim().slice(0, MAX_TITLE_CHARS) : "";
    seen.add(url);
    out.push({ title: title || domain, url, domain });
    if (out.length >= MAX_SEARCH_SOURCES) break;
  }
  return out;
}

export function sameSearchSources(a?: SearchSource[], b?: SearchSource[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (source, index) => source.url === b[index]?.url && source.title === b[index]?.title,
  );
}

const FENCE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;
// `[3]` that is not already a link, reference or footnote, and not glued to a word.
const CITATION = /(?<![\w\\])\[(\d{1,2})\](?![(:])/g;

function escapeLinkTitle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "'").replace(/\s+/g, " ");
}

/**
 * Turn `[n]` in reply prose into a link to the nth source. The title and domain ride on the
 * link title, so hovering shows where the claim came from. Code is left alone, and a number
 * with no matching source stays plain text.
 */
export function linkSearchCitations(text: string, sources: readonly SearchSource[]): string {
  if (sources.length === 0 || !text.includes("[")) return text;
  return text
    .split(FENCE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(CITATION, (match, digits: string, offset: number, whole: string) => {
            const source = sources[Number(digits) - 1];
            if (!source) return match;
            // `[1][2]` is two citations; `[label][1]` is a reference link and stays as written.
            if (whole[offset - 1] === "]" && !/\[\d{1,2}\]$/.test(whole.slice(0, offset))) {
              return match;
            }
            const title = escapeLinkTitle(`${source.title} · ${source.domain}`);
            return `[\\[${digits}\\]](<${new URL(source.url).href}> "${title}")`;
          }),
    )
    .join("");
}
