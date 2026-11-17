import {
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingDelegation,
  type ModelRoutingEntry,
} from "../../../shared/model/host-contracts/model-routing";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
} from "../../../shared/model/host-contracts/delegation";
import type { OrderDraft } from "./modelRoutingDraft";

type Harness = ModelRoutingEntry["harness"];
type Settings = Record<string, string>;

/** One delegation layer: the global defaults, one provider's override or one account's. */
export type DelegationLayer =
  | { kind: "global" }
  | { kind: "provider"; harness: Harness }
  | { kind: "account"; harness: Harness; accountId: string };

/** Accounts are keyed `"<harness>\n<accountId>"` in the document. */
export function accountLayerKey(harness: Harness, accountId: string): string {
  return `${harness}\n${accountId}`;
}

export function sameLayer(a: DelegationLayer, b: DelegationLayer): boolean {
  return layerId(a) === layerId(b);
}

/** Stable id for React keys and comparisons. */
export function layerId(layer: DelegationLayer): string {
  return layer.kind === "global"
    ? "global"
    : layer.kind === "provider"
      ? `provider:${layer.harness}`
      : `account:${accountLayerKey(layer.harness, layer.accountId)}`;
}

/** The stored keys of one layer; empty when the layer has none. */
export function readLayer(delegation: ModelRoutingDelegation, layer: DelegationLayer): Settings {
  if (layer.kind === "global") return delegation.global;
  if (layer.kind === "provider") return delegation.providers[layer.harness] ?? {};
  return delegation.accounts[accountLayerKey(layer.harness, layer.accountId)] ?? {};
}

/** Replace one layer with `values` (delegation keys only). A provider or account layer left empty is removed. */
export function writeLayer(
  delegation: ModelRoutingDelegation,
  layer: DelegationLayer,
  values: Settings,
): ModelRoutingDelegation {
  const next: Settings = {};
  for (const key of MODEL_ROUTING_DELEGATION_KEYS) if (values[key] !== undefined) next[key] = values[key];
  if (layer.kind === "global") return { ...delegation, global: next };
  const empty = Object.keys(next).length === 0;
  if (layer.kind === "provider") {
    const providers = { ...delegation.providers };
    if (empty) delete providers[layer.harness];
    else providers[layer.harness] = next;
    return { ...delegation, providers };
  }
  const accounts = { ...delegation.accounts };
  const key = accountLayerKey(layer.harness, layer.accountId);
  if (empty) delete accounts[key];
  else accounts[key] = next;
  return { ...delegation, accounts };
}

/**
 * Set or clear one key. An empty `next` clears it; with `explicitOff` an empty advisor or
 * subagent list is stored as the Off value instead, so an override can switch an inherited
 * value off rather than inherit it.
 */
export function setLayerKey(
  delegation: ModelRoutingDelegation,
  layer: DelegationLayer,
  key: string,
  next: string | undefined,
  explicitOff = layer.kind !== "global",
): ModelRoutingDelegation {
  const values = { ...readLayer(delegation, layer) };
  const off = key === CROSS_SUBAGENTS_KEY ? "[]" : key === CROSS_ADVISOR_KEY ? "null" : undefined;
  const stored = next || (explicitOff ? off : undefined);
  if (stored === undefined) delete values[key];
  else values[key] = stored;
  return writeLayer(delegation, layer, values);
}

/** What a layer inherits: global, then (for an account) its provider's override. */
export function inheritedValues(
  delegation: ModelRoutingDelegation,
  layer: DelegationLayer,
): Settings {
  if (layer.kind === "global") return {};
  const provider = delegation.providers[layer.harness] ?? {};
  return layer.kind === "provider"
    ? { ...delegation.global }
    : { ...delegation.global, ...provider };
}

/** Provider and account overrides that exist, providers first. */
export function storedOverrides(delegation: ModelRoutingDelegation): DelegationLayer[] {
  const providers = Object.keys(delegation.providers).map(
    (harness): DelegationLayer => ({ kind: "provider", harness: harness as Harness }),
  );
  const accounts = Object.keys(delegation.accounts).flatMap((key): DelegationLayer[] => {
    const split = key.indexOf("\n");
    return split > 0
      ? [
          {
            kind: "account",
            harness: key.slice(0, split) as Harness,
            accountId: key.slice(split + 1),
          },
        ]
      : [];
  });
  return [...providers, ...accounts];
}

/** Providers and accounts the order uses, each as a layer an override could target. */
export function overrideTargets(entries: readonly ModelRoutingEntry[]): DelegationLayer[] {
  const layers = new Map<string, DelegationLayer>();
  for (const entry of entries) {
    const provider: DelegationLayer = { kind: "provider", harness: entry.harness };
    layers.set(layerId(provider), provider);
    if (entry.providerAccountId) {
      const account: DelegationLayer = {
        kind: "account",
        harness: entry.harness,
        accountId: entry.providerAccountId,
      };
      layers.set(layerId(account), account);
    }
  }
  return [...layers.values()];
}

/** The draft with a new delegation document. */
export function withDelegation(draft: OrderDraft, delegation: ModelRoutingDelegation): OrderDraft {
  return { ...draft, routing: { ...draft.routing, delegation } };
}
