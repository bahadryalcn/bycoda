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

/** Search uses trusted metadata, never log, document or transcript instructions. */
export function selectVoiceTools(
  catalog: readonly VoiceToolDescriptor[],
  selection: VoiceToolSelection = {},
): VoiceToolPage {
  const terms = (selection.query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const offset = boundedInteger(selection.offset, 0, 0, catalog.length);
  const limit = boundedInteger(selection.limit, 12, 1, 40);
  const filtered = catalog.filter((tool) => {
    if (selection.family && selection.family !== tool.family) return false;
    if (selection.category && selection.category !== voiceToolCategory(tool)) return false;
    const searchable =
      `${tool.family} ${tool.action} ${tool.name} ${tool.description}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const end = offset + limit;
  return {
    tools: filtered.slice(offset, end),
    total: filtered.length,
    nextOffset: end < filtered.length ? end : null,
    categories: [...new Set(catalog.map(voiceToolCategory))].sort(),
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(min, Math.trunc(value)));
}
