import {
  MODEL_ROUTING_DELEGATION_KEYS,
  ModelRoutingDelegationSchema,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import { DELEGATION_LIMITS } from "../../../shared/model/host-contracts/delegation";

export const HOST_DELEGATION_SYNCED = "bycoda.hostDelegationSynced.v1";
type Settings = Record<string, string>;
export type DelegationChanges = {
  providers: Partial<Record<string, { extras?: Record<string, string | null> }>>;
  accounts: Record<string, { extras?: Record<string, string | null> }>;
  /** The "All providers" layer; `null` removes a key. */
  delegation?: Record<string, string | null>;
};

/**
 * Drops provider and account keys that repeat what they inherit (provider: All providers;
 * account: its provider, else All providers). Such a copy changes nothing today but keeps a
 * later change to All providers from reaching that provider or account.
 */
export function withoutRedundantDelegation(
  delegation: ModelRoutingState["delegation"],
): ModelRoutingState["delegation"] {
  const next = structuredClone(delegation);
  for (const [harness, layer] of Object.entries(next.providers)) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer))
      if (next.global[key] === value) delete layer[key];
    if (!Object.keys(layer).length) delete next.providers[harness as keyof typeof next.providers];
  }
  for (const [id, layer] of Object.entries(next.accounts)) {
    const provider = delegation.providers[id.split("\n")[0] as keyof typeof next.providers] ?? {};
    for (const [key, value] of Object.entries(layer))
      if ((provider[key] ?? next.global[key]) === value) delete layer[key];
    if (!Object.keys(layer).length) delete next.accounts[id];
  }
  return next;
}

/** Copy only the four portable routing keys, with command admission bounds. */
export function delegationKeys(settings: Settings = {}): Settings {
  const next: Settings = {};
  for (const key of MODEL_ROUTING_DELEGATION_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      value.length > DELEGATION_LIMITS.valueBytes ||
      value.includes("\0")
    )
      throw new Error(`Invalid delegation setting: ${key}`);
    next[key] = value;
  }
  return next;
}

/** Apply explicit edits only; resets remove a layer's override, preserving inheritance. */
export function delegationSaveInput(state: ModelRoutingState, changes: DelegationChanges) {
  // Copies are dropped before the edit, so a new All providers value reaches every provider
  // that only repeated the old one.
  const delegation = withoutRedundantDelegation(state.delegation);
  if (changes.delegation) {
    const next = { ...delegation.global };
    for (const key of MODEL_ROUTING_DELEGATION_KEYS) {
      const value = changes.delegation[key];
      if (value === undefined) continue;
      if (value === null) delete next[key];
      else next[key] = value;
    }
    delegation.global = delegationKeys(next);
  }
  for (const bucket of ["providers", "accounts"] as const) {
    const values: Record<string, Settings> = delegation[bucket];
    for (const [id, change] of Object.entries(changes[bucket])) {
      const next = { ...values[id] };
      for (const key of MODEL_ROUTING_DELEGATION_KEYS) {
        const value = change?.extras?.[key];
        if (value === undefined) continue;
        if (value === null) delete next[key];
        else next[key] = value;
      }
      if (Object.keys(next).length) values[id] = delegationKeys(next);
      else delete values[id];
    }
  }
  const { version, updatedAt: _updatedAt, ...draft } = state;
  return {
    expectedVersion: version,
    draft: { ...draft, delegation: ModelRoutingDelegationSchema.parse(delegation) },
  };
}

/** Replace delegation without disturbing model, effort, permissions or other extras. */
export function replaceDelegation<T extends { extras?: Settings }>(own: T, settings: Settings): T {
  const extras = { ...own.extras };
  for (const key of MODEL_ROUTING_DELEGATION_KEYS) delete extras[key];
  const next = { ...own, extras: { ...extras, ...delegationKeys(settings) } };
  if (!Object.keys(next.extras).length) delete (next as { extras?: Settings }).extras;
  return next;
}
