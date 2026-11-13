import { HARNESSES, type HarnessId } from "../../../shared/model/harnessIdentity";
import { type ModelRoutingDelegation } from "../../../shared/model/host-contracts/model-routing";
import {
  loadGlobalSessionDefaults,
  saveGlobalSessionDefaults,
  saveAccountSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import { providerSessionDefaultsSnapshot } from "../../sessions/public/providerSessionDefaults";
import { HOST_DELEGATION_SYNCED, replaceDelegation } from "./delegationProfile";

type StoredAccounts = Partial<
  Record<HarnessId, Record<string, { model?: string; extras?: Record<string, string> }>>
>;
function accounts(): StoredAccounts {
  // The public snapshot includes all stored accounts, including currently disconnected ones.
  const [, snapshot] = JSON.parse(providerSessionDefaultsSnapshot()) as [unknown, string];
  return JSON.parse(snapshot) as StoredAccounts;
}

export function refreshRendererDelegation(profile: ModelRoutingDelegation): void {
  const global = loadGlobalSessionDefaults();
  for (const harness of HARNESSES) {
    const own = global[harness] ?? {};
    const next = replaceDelegation(own, { ...profile.global, ...profile.providers[harness] });
    if (JSON.stringify(own) !== JSON.stringify(next)) saveGlobalSessionDefaults(harness, next);
    if (JSON.stringify(loadGlobalSessionDefaults()[harness] ?? {}) !== JSON.stringify(next))
      throw new Error("Renderer delegation defaults could not be saved.");
  }
  const stored = accounts();
  const keys = new Set(Object.keys(profile.accounts));
  for (const [harness, entries] of Object.entries(stored))
    for (const id of Object.keys(entries ?? {})) keys.add(`${harness}\n${id}`);
  for (const key of keys) {
    const [harness, id] = key.split("\n");
    if (!HARNESSES.includes(harness as HarnessId) || !id) continue;
    const own = stored[harness as HarnessId]?.[id] ?? {};
    const next = replaceDelegation(own, profile.accounts[key] ?? {});
    if (JSON.stringify(own) !== JSON.stringify(next))
      saveAccountSessionDefaults(harness as HarnessId, id, next);
    if (JSON.stringify(accounts()[harness as HarnessId]?.[id] ?? {}) !== JSON.stringify(next))
      throw new Error("Renderer account delegation defaults could not be saved.");
  }
  // Suppress the old recent-setting fallback after the Host has supplied authoritative layers.
  localStorage.setItem(HOST_DELEGATION_SYNCED, "true");
  window.dispatchEvent(new CustomEvent("bycoda:provider-session-defaults"));
}
