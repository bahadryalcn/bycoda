import type {
  ModelRoutingDraft,
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
  ModelRoutingResolution,
  ModelRoutingScope,
  ModelRoutingTarget,
} from "../../src/shared/model/host-contracts/model-routing";
import {
  modelRoutingPoolEntryIds,
  modelRoutingProjectKey,
} from "../../src/shared/model/modelRoutingPools";

export type ModelRoutingQuota = { leftPercent: number; resetsAt?: number } | { unknown: true };
export interface ModelRoutingSignals {
  available(entry: ModelRoutingEntry): boolean;
  signedIn(entry: ModelRoutingEntry): boolean;
  quota(entry: ModelRoutingEntry): ModelRoutingQuota;
  /** The entry account's scope; undefined means a shared account. */
  accountKind(entry: ModelRoutingEntry): ModelRoutingScope | undefined;
}
import type { ModelRoutingResolveInput } from "../domains/model-routing/ports";
export type { ModelRoutingResolveInput } from "../domains/model-routing/ports";

/** One status computation keeps settings and run admission in agreement. */
export function modelRoutingEntryStatus(
  entry: ModelRoutingEntry,
  signals: ModelRoutingSignals,
  /** The run's project scope; settings status has no project and passes none. */
  scope?: ModelRoutingScope,
): ModelRoutingEntryStatus {
  const quota = signals.quota(entry);
  const kind = scope ? signals.accountKind(entry) : undefined;
  const skip = !signals.available(entry)
    ? "unavailable"
    : !signals.signedIn(entry)
      ? "signedOut"
      : kind && kind !== scope
        ? "otherScope"
        : "unknown" in quota
        ? entry.unknownLimit === "skip"
          ? "unknownLimit"
          : undefined
        : quota.leftPercent < (entry.minRemainingPercent ?? 0)
          ? "belowLimit"
          : undefined;
  return {
    entryId: entry.id,
    ...(skip ? { skip } : {}),
    ...("unknown" in quota
      ? {}
      : {
          leftPercent: quota.leftPercent,
          ...(quota.resetsAt === undefined ? {} : { resetsAt: quota.resetsAt }),
        }),
  };
}

function targetWithDelegation(
  state: ModelRoutingDraft,
  target: ModelRoutingTarget,
  fixed: boolean,
): ModelRoutingTarget {
  const layers = {
    ...state.delegation.global,
    ...state.delegation.providers[target.harness],
    ...state.delegation.accounts[`${target.harness}\n${target.providerAccountId ?? "default"}`],
  };
  return {
    ...target,
    modelSettings: fixed
      ? { ...layers, ...target.modelSettings }
      : { ...target.modelSettings, ...layers },
  };
}

/** Pure run-start selection. An omitted choice follows the role; explicit-model callers pass fixed explicitly. */
export function selectModelRouting(
  state: ModelRoutingDraft,
  input: ModelRoutingResolveInput,
  signals: ModelRoutingSignals,
): ModelRoutingResolution {
  const choice =
    !input.choice || input.choice.kind === "default"
      ? (state.roles[input.role] ?? { kind: "order" as const })
      : input.choice;
  if (choice.kind === "fixed") {
    const roleChoice = state.roles[input.role];
    const target =
      input.choice?.kind === "fixed"
        ? input.fixed
        : roleChoice?.kind === "fixed"
          ? roleChoice.target
          : undefined;
    if (!target) throw new Error("A fixed model choice requires a target.");
    return {
      ok: true,
      target: targetWithDelegation(state, target, true),
      source: { kind: "fixed" },
      skipped: [],
    };
  }
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const entries =
    choice.kind === "order"
      ? state.entries
      : modelRoutingPoolEntryIds(state.pools, choice.poolId).flatMap((id) => {
          const entry = byId.get(id);
          return entry ? [entry] : [];
        });
  if (!entries.length) return { ok: false, reason: "notConfigured", skipped: [] };
  const scope = input.cwd ? state.projectKinds?.[modelRoutingProjectKey(input.cwd)] : undefined;
  const skipped: ModelRoutingResolution["skipped"] = [];
  let nextResetAt: number | undefined;
  for (const entry of entries) {
    const status = modelRoutingEntryStatus(entry, signals, scope);
    if (
      !status.skip &&
      input.eligible &&
      !input.eligible(targetWithDelegation(state, entry, false))
    )
      status.skip = "missingCapability";
    if (!status.skip) {
      const { harness, model, providerAccountId, modelSettings } = entry;
      return {
        ok: true,
        target: targetWithDelegation(
          state,
          { harness, model, providerAccountId, modelSettings },
          false,
        ),
        source:
          choice.kind === "order"
            ? { kind: "order", entryId: entry.id }
            : { kind: "pool", poolId: choice.poolId, entryId: entry.id },
        skipped,
      };
    }
    skipped.push({ entryId: entry.id, reason: status.skip });
    if (status.resetsAt !== undefined)
      nextResetAt = Math.min(nextResetAt ?? Infinity, status.resetsAt);
  }
  return {
    ok: false,
    reason: "noEligibleEntry",
    skipped,
    ...(nextResetAt === undefined ? {} : { nextResetAt }),
  };
}
