import { z } from "zod";
import { SessionProviderSchema } from "./session-commands";
import { IMAGE_MODELS_KEY, decodeImageModels, encodeImageModels } from "./image-models";

/**
 * Cross-provider advisor and subagents. The owner picks models from any connected
 * provider; bycoda runs them as child sessions through the `agents.*` tools.
 * The values ride in `Session.modelSettings` under reserved keys and are stripped
 * before any provider sees the settings.
 */
export const CROSS_SUBAGENTS_KEY = "crossSubagents";
export const CROSS_ADVISOR_KEY = "crossAdvisor";
/** Set by the Host on a child session; display linkage only, never authority. */
export const DELEGATION_PARENT_KEY = "delegationParent";
export const CROSS_DELEGATION_KEYS = [CROSS_SUBAGENTS_KEY, CROSS_ADVISOR_KEY] as const;
const RESERVED_KEYS = new Set<string>([
  ...CROSS_DELEGATION_KEYS,
  DELEGATION_PARENT_KEY,
  IMAGE_MODELS_KEY,
]);

export const DELEGATION_LIMITS = {
  /** Room for every model of several accounts per provider; refs stay far below valueBytes. */
  subagentModels: 24,
  runningSubagents: 8,
  runningAdvisors: 1,
  promptChars: 16_000,
  titleChars: 120,
  resultGraphemes: 12_000,
  waitSeconds: 50,
  /** Encoded setting values above this size are ignored, not parsed. */
  valueBytes: 8_192,
} as const;

export const DelegateModelRefSchema = z.strictObject({
  harness: SessionProviderSchema,
  model: z.string().min(1).max(200),
  providerAccountId: z.string().min(1).max(64).optional(),
});
export type DelegateModelRef = z.infer<typeof DelegateModelRefSchema>;

export const DelegationKindSchema = z.enum(["subagent", "advisor"]);
export type DelegationKind = z.infer<typeof DelegationKindSchema>;

// shortcut: the parent link lives in modelSettings because the native session store
// has no free field; move it to a session column when that schema next changes.
export const DelegationParentSchema = z.strictObject({
  parentSessionId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  kind: DelegationKindSchema,
  model: z.string().min(1).max(200),
  startedAt: z.number().int().nonnegative(),
});
export type DelegationParent = z.infer<typeof DelegationParentSchema>;
export type DelegationCollectionMetadata = { delegationParent?: DelegationParent | null };

/** Full settings take precedence over a potentially stale collection projection. */
export function sessionDelegationParent(value: unknown): DelegationParent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.modelSettings && typeof record.modelSettings === "object") {
    return decodeDelegationParent(
      (record.modelSettings as Record<string, unknown>)[DELEGATION_PARENT_KEY],
    );
  }
  const parsed = DelegationParentSchema.safeParse(record.delegationParent);
  return parsed.success ? parsed.data : undefined;
}

export function isUserConversation(value: unknown): boolean {
  return sessionDelegationParent(value) === undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value || value.length > DELEGATION_LIMITS.valueBytes)
    return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Readable, stable id a model passes back to `agents.delegate`, e.g. `codex:gpt-6.1-sol`. */
export function delegateRefKey(ref: DelegateModelRef): string {
  const base = ref.model.startsWith(`${ref.harness}:`) ? ref.model : `${ref.harness}:${ref.model}`;
  return ref.providerAccountId ? `${base}@${ref.providerAccountId}` : base;
}

/** Never throws: drops invalid entries, dedupes and caps the list. */
export function decodeSubagents(value: unknown): DelegateModelRef[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const refs: DelegateModelRef[] = [];
  for (const entry of parsed) {
    const result = DelegateModelRefSchema.safeParse(entry);
    if (!result.success) continue;
    const key = delegateRefKey(result.data);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(result.data);
    if (refs.length >= DELEGATION_LIMITS.subagentModels) break;
  }
  return refs;
}

export function encodeSubagents(refs: readonly DelegateModelRef[]): string | undefined {
  const valid = decodeSubagents(JSON.stringify(refs));
  return valid.length ? JSON.stringify(valid) : undefined;
}

export function decodeAdvisor(value: unknown): DelegateModelRef | undefined {
  const result = DelegateModelRefSchema.safeParse(parseJson(value));
  return result.success ? result.data : undefined;
}

export function encodeAdvisor(ref: DelegateModelRef | undefined): string | undefined {
  const result = DelegateModelRefSchema.safeParse(ref);
  return result.success ? JSON.stringify(result.data) : undefined;
}

export function decodeDelegationParent(value: unknown): DelegationParent | undefined {
  const result = DelegationParentSchema.safeParse(parseJson(value));
  return result.success ? result.data : undefined;
}

/** Copies the valid reserved keys of `from` into `into`, dropping invalid values. */
export function carryCrossDelegation(
  from: Readonly<Record<string, string>> | undefined,
  into: Record<string, string>,
): Record<string, string> {
  if (!from) return into;
  const subagents = encodeSubagents(decodeSubagents(from[CROSS_SUBAGENTS_KEY]));
  const advisor = encodeAdvisor(decodeAdvisor(from[CROSS_ADVISOR_KEY]));
  const parent = decodeDelegationParent(from[DELEGATION_PARENT_KEY]);
  if (subagents) into[CROSS_SUBAGENTS_KEY] = subagents;
  else if (from[CROSS_SUBAGENTS_KEY] === "[]") into[CROSS_SUBAGENTS_KEY] = "[]";
  if (advisor) into[CROSS_ADVISOR_KEY] = advisor;
  else if (from[CROSS_ADVISOR_KEY] === "null") into[CROSS_ADVISOR_KEY] = "null";
  if (parent) into[DELEGATION_PARENT_KEY] = JSON.stringify(parent);
  const images = encodeImageModels(decodeImageModels(from[IMAGE_MODELS_KEY]));
  if (images) into[IMAGE_MODELS_KEY] = images;
  return into;
}

/** Removes bycoda-owned keys; providers never receive them. */
export function providerModelSettings<T extends Readonly<Record<string, string>> | undefined>(
  settings: T,
): T {
  if (!settings || !Object.keys(settings).some((key) => RESERVED_KEYS.has(key))) return settings;
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !RESERVED_KEYS.has(key)),
  ) as T;
}

export function isReservedDelegationKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}
