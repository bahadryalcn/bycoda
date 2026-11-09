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

export type DecisionConfigLoad = {
  config: DecisionConfig;
  /** True when the file exists but cannot be read as this version; saves must then refuse. */
  damaged: boolean;
};

/** A damaged file is kept by readStateFile (evidence copy), and defaults are returned. */
export async function loadDecisionConfig(path: string): Promise<DecisionConfigLoad> {
  const result = await readStateFile(path, (text) => {
    const parsed: DecisionConfig = DecisionConfigFileSchema.parse(JSON.parse(text));
    return parsed;
  });
  if (result.status === "ok") return { config: result.value, damaged: false };
  return { config: defaultDecisionConfig(), damaged: result.status === "corrupt" };
}

export async function saveDecisionConfig(path: string, config: DecisionConfig): Promise<void> {
  const checked: DecisionConfig = DecisionConfigFileSchema.parse(config);
  await writeFileAtomic(path, `${JSON.stringify(checked, null, 2)}\n`);
}
