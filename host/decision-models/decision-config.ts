import { z } from "zod";
import {
  DecisionRoutingSchema,
  DecisionSourceSchema,
} from "../../src/shared/model/host-contracts/decision-models";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import type { DecisionConfig } from "./decision-types";

export const DECISION_CONFIG_VERSION = 1;
export const MAX_DECISION_SOURCES = 64;

export function defaultDecisionConfig(): DecisionConfig {
  return {
    version: DECISION_CONFIG_VERSION,
    sources: [],
    routing: {},
    localOnlyPersonalData: false,
    discovery: { extraPorts: [], extraFolders: [] },
    firstRunDismissed: false,
  };
}

// Strict: an unknown field means a newer or damaged file, which must not be overwritten.
const DecisionConfigFileSchema = z.strictObject({
  version: z.literal(DECISION_CONFIG_VERSION),
  sources: z.array(DecisionSourceSchema).max(MAX_DECISION_SOURCES),
  routing: DecisionRoutingSchema,
  localOnlyPersonalData: z.boolean(),
  discovery: z.strictObject({
    extraPorts: z.array(z.number().int().min(1).max(65535)).max(16),
    extraFolders: z.array(z.string().min(1).max(4096)).max(32),
  }),
  firstRunDismissed: z.boolean(),
});

/**
 * What is safe to tell the owner about a damaged file. It never carries file text, parser
 * messages, values or unknown key names (any of which could hold a pasted key); only a coarse
 * reason, the schema path of the first invalid field and whether an evidence copy was kept.
 */
export type DecisionConfigDamage = {
  reason: "empty" | "invalid_encoding" | "invalid_json" | "invalid_shape" | "unreadable";
  /** Schema path of the first invalid field, for example `sources.2.endpoint`. */
  field?: string;
  evidenceKept: boolean;
};

export type DecisionConfigLoad =
  | { config: DecisionConfig; damaged: false }
  | {
      /** The defaults, only so callers that ignore damage keep compiling; never treat as the owner's settings. */
      config: DecisionConfig;
      /** The file exists but cannot be read as this version; saves must refuse and reads must report it. */
      damaged: true;
      damage: DecisionConfigDamage;
    };

const MAX_FIELD_PATH_LENGTH = 120;
const MAX_FIELD_PATH_SEGMENTS = 6;
const SAFE_SEGMENT = /^(?:\d{1,4}|[A-Za-z][A-Za-z0-9_]{0,31})$/;

function fieldPath(path: readonly PropertyKey[]): string | undefined {
  if (path.length === 0) return undefined;
  const segments = path
    .slice(0, MAX_FIELD_PATH_SEGMENTS)
    .map((segment) => (SAFE_SEGMENT.test(String(segment)) ? String(segment) : "?"));
  return segments.join(".").slice(0, MAX_FIELD_PATH_LENGTH);
}

function describeDamage(error: unknown, evidenceKept: boolean): DecisionConfigDamage {
  if (error instanceof z.ZodError) {
    const field = fieldPath(error.issues[0]?.path ?? []);
    return { reason: "invalid_shape", ...(field ? { field } : {}), evidenceKept };
  }
  if (error instanceof SyntaxError) return { reason: "invalid_json", evidenceKept };
  if (error instanceof TypeError) return { reason: "invalid_encoding", evidenceKept };
  if (error instanceof Error && error.message === "State file is empty")
    return { reason: "empty", evidenceKept };
  return { reason: "unreadable", evidenceKept };
}

/** A damaged file is kept by readStateFile (evidence copy); callers must surface `damage`, not the defaults. */
export async function loadDecisionConfig(path: string): Promise<DecisionConfigLoad> {
  const result = await readStateFile(path, (text) => {
    const parsed: DecisionConfig = DecisionConfigFileSchema.parse(JSON.parse(text));
    return parsed;
  });
  if (result.status === "ok") return { config: result.value, damaged: false };
  if (result.status === "corrupt")
    return {
      config: defaultDecisionConfig(),
      damaged: true,
      damage: describeDamage(result.error, result.quarantined !== undefined),
    };
  return { config: defaultDecisionConfig(), damaged: false };
}

/** Thrown instead of serving defaults when the saved file is damaged. The message is safe to show. */
export class DecisionConfigDamagedError extends Error {
  readonly code = "config_damaged";

  constructor(readonly damage: DecisionConfigDamage) {
    const where = damage.field ? ` at ${damage.field}` : "";
    const kept = damage.evidenceKept ? "; the original file was kept" : "";
    super(`Decision model settings are damaged (${damage.reason}${where})${kept}.`);
    this.name = "DecisionConfigDamagedError";
  }
}

/** The owner's config, or a DecisionConfigDamagedError: damaged settings never read as an empty config. */
export async function requireDecisionConfig(path: string): Promise<DecisionConfig> {
  const loaded = await loadDecisionConfig(path);
  if (loaded.damaged) throw new DecisionConfigDamagedError(loaded.damage);
  return loaded.config;
}

export async function saveDecisionConfig(path: string, config: DecisionConfig): Promise<void> {
  const checked: DecisionConfig = DecisionConfigFileSchema.parse(config);
  await writeFileAtomic(path, `${JSON.stringify(checked, null, 2)}\n`);
}
