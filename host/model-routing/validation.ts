import {
  MODEL_ROUTING_DELEGATION_KEYS,
  ModelRoutingDraftSchema,
  type ModelRoutingDraft,
  type ModelRoutingTarget,
} from "../../src/shared/model/host-contracts/model-routing";
import {
  modelRoutingPoolCycle,
  modelRoutingProjectKey,
} from "../../src/shared/model/modelRoutingPools";
import type { HostProviderAccountCatalog } from "../providers/provider-accounts";

export type ModelRoutingCatalog = { models: Partial<Record<string, { id: string }[]>> };
export function validateModelRoutingDraft(
  raw: unknown,
  accounts: HostProviderAccountCatalog,
  catalog?: ModelRoutingCatalog,
): ModelRoutingDraft {
  const draft = ModelRoutingDraftSchema.parse(raw);
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`${label} must be unique.`);
  };
  unique(
    draft.entries.map((entry) => entry.id),
    "Model routing entry ids",
  );
  unique(
    draft.pools.map((pool) => pool.id),
    "Model routing pool ids",
  );
  const entries = new Set(draft.entries.map((entry) => entry.id));
  const pools = new Set(draft.pools.map((pool) => pool.id));
  for (const pool of draft.pools) {
    unique(pool.entryIds, "Pool entry ids");
    if (pool.entryIds.some((id) => !entries.has(id)))
      throw new Error(`Unknown entry in pool ${pool.id}.`);
    if (!pool.entryIds.length && !pool.poolIds?.length)
      throw new Error(`Pool ${pool.id} needs at least one model or pool.`);
    unique(pool.poolIds ?? [], "Included pool ids");
    if ((pool.poolIds ?? []).some((id) => !pools.has(id)))
      throw new Error(`Unknown included pool in pool ${pool.id}.`);
    if (pool.poolIds?.includes(pool.id)) throw new Error(`Pool ${pool.id} includes itself.`);
  }
  if (modelRoutingPoolCycle(draft.pools)) throw new Error("Pools must not include each other in a cycle.");
  for (const key of Object.keys(draft.projectKinds ?? {}))
    if (modelRoutingProjectKey(key) !== key)
      throw new Error("Project scope keys must be normalized project keys.");
  const targets: ModelRoutingTarget[] = [...draft.entries];
  for (const choice of Object.values(draft.roles)) {
    if (choice.kind === "pool" && !pools.has(choice.poolId))
      throw new Error(`Unknown role pool ${choice.poolId}.`);
    if (choice.kind === "fixed") targets.push(choice.target);
  }
  for (const target of targets) {
    if (MODEL_ROUTING_DELEGATION_KEYS.some((key) => key in target.modelSettings))
      throw new Error("Delegation keys belong in model routing delegation settings.");
    if (target.harness === "codex" || target.harness === "claude") {
      const account = target.providerAccountId ?? "default";
      if (account !== "default" && !accounts[target.harness]?.some((entry) => entry.id === account))
        throw new Error(`Unknown ${target.harness} account "${account}".`);
    } else if (target.providerAccountId !== undefined)
      throw new Error(`${target.harness} has no provider accounts.`);
    const models = catalog?.models[target.harness];
    if (models?.length && !models.some((model) => model.id === target.model))
      throw new Error(`Model "${target.model}" is not available for ${target.harness}.`);
  }
  for (const settings of [
    draft.delegation.global,
    ...Object.values(draft.delegation.providers),
    ...Object.values(draft.delegation.accounts),
  ]) {
    if (
      Object.keys(settings).some(
        (key) => !(MODEL_ROUTING_DELEGATION_KEYS as readonly string[]).includes(key),
      )
    )
      throw new Error("Only model routing delegation keys are allowed in delegation settings.");
  }
  return draft;
}
