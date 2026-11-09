import { normalizeVoiceSearch, voiceSearchClauses } from "./voiceFeatureLexicon";

/** Metadata only. The owning Host remains responsible for validation and authorization. */
export type VoiceToolFamily = "conversation" | "social" | "runtime-logs";

export type VoiceToolDescriptor = {
  family: VoiceToolFamily;
  action: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type VoiceToolSelection = {
  query?: string;
  category?: string;
  family?: VoiceToolFamily;
  offset?: number;
  limit?: number;
};

export type VoiceToolPage = {
  tools: VoiceToolDescriptor[];
  total: number;
  nextOffset: number | null;
  /** Full catalog category names; an empty search must not hide other available domains. */
  categories: string[];
  /** Unrecognized query words dropped after the full query matched nothing. */
  ignoredTerms?: string[];
};

/** Host action ids: dot or underscore separated words; words may contain hyphens
 * (for example "programs.preview-schedule"). */
export const VOICE_TOOL_ACTION =
  /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*(?:[._][A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)*$/;

export function isVoiceToolFamily(value: unknown): value is VoiceToolFamily {
  return value === "conversation" || value === "social" || value === "runtime-logs";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A malformed catalog is not evidence that tools are unavailable. Fail explicitly. */
export function readVoiceToolCatalog(value: unknown): VoiceToolDescriptor[] {
  if (!record(value) || !Array.isArray(value.tools) || value.tools.length > 1000)
    throw new Error("The voice tool catalog is invalid.");
  const identities = new Set<string>();
  return value.tools.map((entry: unknown) => {
    if (
      !record(entry) ||
      !isVoiceToolFamily(entry.family) ||
      typeof entry.action !== "string" ||
      !VOICE_TOOL_ACTION.test(entry.action) ||
      entry.action.length > 200 ||
      typeof entry.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(entry.name) ||
      typeof entry.description !== "string" ||
      entry.description.length > 16000 ||
      !record(entry.inputSchema) ||
      (entry.annotations !== undefined && !record(entry.annotations))
    )
      throw new Error("The voice tool catalog contains an invalid tool.");
    const key = `${entry.family}:${entry.action}`;
    if (identities.has(key)) throw new Error("The voice tool catalog contains duplicate tools.");
    identities.add(key);
    return entry as VoiceToolDescriptor;
  });
}

export function voiceToolCategory(tool: VoiceToolDescriptor): string {
  return `${tool.family}:${tool.action.split(".")[0]}`;
}

/** Largest page `selectVoiceTools` returns; the realtime tool schema should not advertise more. */
export const VOICE_TOOL_MAX_LIMIT = 40;

/** Lower is better: exact action > action word/prefix > family/category > description only. */
function rankVoiceTool(tool: VoiceToolDescriptor, clauses: ReturnType<typeof voiceSearchClauses>) {
  const action = tool.action.toLowerCase();
  const parts = action.split(/[._-]/);
  if (clauses.length && clauses.map((term) => term.text).join(" ") === parts.join(" ")) return -1;
  let score = 0;
  for (const term of clauses) {
    if (action === term.text) score += 0;
    else if (
      (term.action !== undefined && parts.includes(term.action)) ||
      parts.includes(term.text) ||
      action.startsWith(term.text) ||
      parts.some((part) => part.startsWith(term.text))
    )
      score += 1;
    else if (
      tool.family === term.feature ||
      tool.family === term.text ||
      (term.feature !== undefined && parts[0] === term.feature) ||
      parts[0] === term.text
    )
      score += 2;
    else score += 3;
  }
  return score;
}

/** Search uses trusted metadata, never log, document or transcript instructions. */
export function selectVoiceTools(
  catalog: readonly VoiceToolDescriptor[],
  selection: VoiceToolSelection = {},
): VoiceToolPage {
  const terms = voiceSearchClauses((selection.query ?? "").replace(/['’](?=\p{L})/gu, ""));
  const offset = boundedInteger(selection.offset, 0, 0, catalog.length);
  const limit = boundedInteger(selection.limit, 12, 1, VOICE_TOOL_MAX_LIMIT);
  const matches = (tool: VoiceToolDescriptor, clauses: typeof terms) => {
    if (selection.family && selection.family !== tool.family) return false;
    if (selection.category && selection.category !== voiceToolCategory(tool)) return false;
    const searchable = normalizeVoiceSearch(
      `${tool.family} ${tool.action} ${tool.name} ${tool.description}`,
    );
    const parts = tool.action.toLowerCase().split(/[._-]/);
    return clauses.every(
      (term) =>
        (term.feature !== undefined &&
          (parts.includes(term.feature) ||
            tool.family === term.feature ||
            (term.feature === "logs" && tool.family === "runtime-logs") ||
            searchable.includes(term.feature))) ||
        (term.action !== undefined &&
          (parts.includes(term.action) || (term.action === "list" && parts.includes("open")))) ||
        searchable.includes(term.text),
    );
  };
  let filtered = catalog.filter((tool) => matches(tool, terms));
  // Spoken queries carry filler words ("ekip yönetimi", "manage my crew"). When the full
  // phrase matches nothing, keep only the recognized feature/action words and say so.
  const recognized = terms.filter(
    (term) => term.feature !== undefined || term.action !== undefined,
  );
  const ignoredTerms =
    !filtered.length && recognized.length && recognized.length < terms.length
      ? terms.filter((term) => !recognized.includes(term)).map((term) => term.text)
      : undefined;
  if (ignoredTerms) filtered = catalog.filter((tool) => matches(tool, recognized));
  const rankClauses = ignoredTerms ? recognized : terms;
  if (rankClauses.length)
    filtered = filtered
      .map((tool, index) => ({ tool, index, score: rankVoiceTool(tool, rankClauses) }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((entry) => entry.tool);
  const end = offset + limit;
  return {
    tools: filtered.slice(offset, end),
    total: filtered.length,
    nextOffset: end < filtered.length ? end : null,
    categories: [...new Set(catalog.map(voiceToolCategory))].sort(),
    ...(ignoredTerms && filtered.length ? { ignoredTerms } : {}),
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(min, Math.trunc(value)));
}
