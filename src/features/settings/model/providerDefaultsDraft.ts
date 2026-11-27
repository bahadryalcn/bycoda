import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { t } from "../../../shared/i18n";
import { projectDisplayName } from "../../projects/public/projectNames";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";

/**
 * Providers > Defaults edits a change set, not a stored scope. Each field holds the value the
 * owner picked (`null` clears it back to inheritance); Save writes the set to the chosen target.
 * The same change set can be applied to Global or to one project, so the target is picked at
 * save time.
 */
export type DraftValue = string | null;

export type ProviderDefaultsChange = {
  model?: DraftValue;
  effort?: DraftValue;
  runtimeMode?: DraftValue;
  extras?: Record<string, DraftValue>;
  /** Project target: keep the provider out of the picker there. */
  hidden?: boolean;
  /** Project target: the account new conversations start on (`null` follows the provider's default). */
  account?: DraftValue;
};

export type DefaultsDraft = {
  providerScope?: "all";
  defaultProvider?: HarnessId;
  providers: Partial<Record<HarnessId, ProviderDefaultsChange>>;
  /** Account overrides are machine-wide whatever the target. Keyed by `accountDraftKey`. */
  accounts: Record<string, ProviderDefaultsChange>;
  /** Helpers for every provider (the Host's All providers delegation layer); `null` clears a key. */
  delegation?: Record<string, DraftValue>;
};

export type DefaultsTarget = { kind: "global" } | { kind: "project"; path: string };

export const EMPTY_DRAFT: DefaultsDraft = { providers: {}, accounts: {} };

const PROJECT_PREFIX = "project:";

export function targetValue(target: DefaultsTarget): string {
  return target.kind === "project" ? `${PROJECT_PREFIX}${target.path}` : "global";
}

/** Window-local selection encoding: `global` or `project:<path>`; anything else is Global. */
export function parseTargetValue(value: string): DefaultsTarget {
  return value.startsWith(PROJECT_PREFIX) && value.length > PROJECT_PREFIX.length
    ? { kind: "project", path: value.slice(PROJECT_PREFIX.length) }
    : { kind: "global" };
}

/** What the page and save bar call a target. */
export function defaultsTargetLabel(target: DefaultsTarget): string {
  return target.kind === "project" ? projectDisplayName(target.path) : t("All projects");
}

export function accountDraftKey(harness: HarnessId, accountId: string): string {
  return `${harness}\n${accountId}`;
}

export function parseAccountDraftKey(key: string): {
  harness: HarnessId;
  accountId: string;
} {
  const split = key.indexOf("\n");
  return { harness: key.slice(0, split) as HarnessId, accountId: key.slice(split + 1) };
}

/** Stored values with the pending change applied on top. */
export function overlaySessionDefaults(
  base: ProviderSessionDefaults,
  change: ProviderDefaultsChange | undefined,
): ProviderSessionDefaults {
  if (!change) return base;
  const next: ProviderSessionDefaults = { ...base };
  if (change.effort !== undefined) next.effort = change.effort ?? undefined;
  if (change.runtimeMode !== undefined) {
    next.runtimeMode = (change.runtimeMode ?? undefined) as ProviderSessionDefaults["runtimeMode"];
  }
  if (change.extras) {
    const extras = { ...base.extras };
    for (const [id, value] of Object.entries(change.extras)) {
      if (value == null) delete extras[id];
      else extras[id] = value;
    }
    next.extras = extras;
  }
  return next;
}

const same = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? null) === (right ?? null);

/**
 * Records what the form now shows (`next`) against the stored values (`base`). Fields that
 * match the stored value leave the change set, so undoing an edit by hand clears it.
 */
export function recordSessionDefaults(
  previous: ProviderDefaultsChange | undefined,
  base: ProviderSessionDefaults,
  next: ProviderSessionDefaults,
): ProviderDefaultsChange | undefined {
  const change: ProviderDefaultsChange = {};
  if (previous?.model !== undefined) change.model = previous.model;
  if (previous?.hidden !== undefined) change.hidden = previous.hidden;
  if (previous?.account !== undefined) change.account = previous.account;
  if (!same(base.effort, next.effort)) change.effort = next.effort ?? null;
  if (!same(base.runtimeMode, next.runtimeMode)) change.runtimeMode = next.runtimeMode ?? null;
  const extras: Record<string, DraftValue> = {};
  for (const id of new Set([
    ...Object.keys(base.extras ?? {}),
    ...Object.keys(next.extras ?? {}),
  ])) {
    if (!same(base.extras?.[id], next.extras?.[id])) extras[id] = next.extras?.[id] ?? null;
  }
  if (Object.keys(extras).length > 0) change.extras = extras;
  return changeSize(change) > 0 ? change : undefined;
}

/** Sets or clears one non-session field; a value equal to the stored one leaves the set. */
export function recordField<K extends "model" | "hidden" | "account">(
  previous: ProviderDefaultsChange | undefined,
  field: K,
  value: ProviderDefaultsChange[K],
  stored: ProviderDefaultsChange[K] | undefined,
): ProviderDefaultsChange | undefined {
  const change: ProviderDefaultsChange = { ...previous };
  if ((value ?? null) === (stored ?? null)) delete change[field];
  else change[field] = value;
  return changeSize(change) > 0 ? change : undefined;
}

export function changeSize(change: ProviderDefaultsChange | undefined): number {
  if (!change) return 0;
  return (
    Number(change.model !== undefined) +
    Number(change.effort !== undefined) +
    Number(change.runtimeMode !== undefined) +
    Number(change.hidden !== undefined) +
    Number(change.account !== undefined) +
    Object.keys(change.extras ?? {}).length
  );
}

export type DraftChangeField = "model" | "effort" | "runtimeMode" | "hidden" | "account";

/** One field of the draft, across every provider and account it touches. */
export type DraftChangeItem = {
  id: string;
  harness?: HarnessId;
  accountId?: string;
  /** `defaultProvider`, a top-level field, an extras key (`extra`) or an All providers helper (`delegation`). */
  field: DraftChangeField | "defaultProvider" | "extra" | "delegation";
  extraKey?: string;
  value: DraftValue | boolean | undefined;
};

/** Every unsaved field, in display order; `draftSize` counts the same items. */
export function draftChangeItems(draft: DefaultsDraft): DraftChangeItem[] {
  const items: DraftChangeItem[] = [];
  if (draft.defaultProvider !== undefined)
    items.push({ id: "defaultProvider", field: "defaultProvider", value: draft.defaultProvider });
  const add = (
    change: ProviderDefaultsChange,
    harness: HarnessId,
    accountId: string | undefined,
  ) => {
    const base = `${harness}\n${accountId ?? ""}`;
    for (const field of ["model", "effort", "runtimeMode", "hidden", "account"] as const)
      if (change[field] !== undefined)
        items.push({ id: `${base}\n${field}`, harness, accountId, field, value: change[field] });
    for (const [key, value] of Object.entries(change.extras ?? {}))
      items.push({
        id: `${base}\nextra:${key}`,
        harness,
        accountId,
        field: "extra",
        extraKey: key,
        value,
      });
  };
  for (const [harness, change] of Object.entries(draft.providers) as [
    HarnessId,
    ProviderDefaultsChange,
  ][])
    add(change, harness, undefined);
  for (const [key, change] of Object.entries(draft.accounts)) {
    const { harness, accountId } = parseAccountDraftKey(key);
    add(change, harness, accountId);
  }
  for (const [key, value] of Object.entries(draft.delegation ?? {}))
    items.push({
      id: `delegation
${key}`,
      field: "delegation",
      extraKey: key,
      value,
    });
  return items;
}

/** The draft without one item; empty provider and account entries are dropped. */
export function withoutDraftItem(draft: DefaultsDraft, item: DraftChangeItem): DefaultsDraft {
  if (item.field === "defaultProvider") {
    const { defaultProvider: _drop, ...rest } = draft;
    return rest;
  }
  if (item.field === "delegation" && item.extraKey) {
    const { [item.extraKey]: _drop, ...delegation } = draft.delegation ?? {};
    const { delegation: _old, ...rest } = draft;
    return Object.keys(delegation).length ? { ...rest, delegation } : rest;
  }
  if (!item.harness) return draft;
  const slot = { harness: item.harness, accountId: item.accountId };
  const current = item.accountId
    ? draft.accounts[accountDraftKey(item.harness, item.accountId)]
    : draft.providers[item.harness];
  if (!current) return draft;
  const next: ProviderDefaultsChange = { ...current };
  if (item.field === "extra" && item.extraKey) {
    const { [item.extraKey]: _drop, ...extras } = current.extras ?? {};
    if (Object.keys(extras).length) next.extras = extras;
    else delete next.extras;
  } else if (item.field !== "extra" && item.field !== "delegation") delete next[item.field];
  return withChange(draft, slot, changeSize(next) ? next : undefined);
}

export function draftSize(draft: DefaultsDraft): number {
  return (
    Number(draft.defaultProvider !== undefined) +
    Object.keys(draft.delegation ?? {}).length +
    Object.values(draft.providers).reduce((sum, change) => sum + changeSize(change), 0) +
    Object.values(draft.accounts).reduce((sum, change) => sum + changeSize(change), 0)
  );
}

/** Returns the draft with one provider's (or account's) change replaced, dropping empty entries. */
export function withChange(
  draft: DefaultsDraft,
  slot: { harness: HarnessId; accountId?: string },
  change: ProviderDefaultsChange | undefined,
): DefaultsDraft {
  const key = slot.accountId ? accountDraftKey(slot.harness, slot.accountId) : slot.harness;
  const bucket = { ...(slot.accountId ? draft.accounts : draft.providers) } as Record<
    string,
    ProviderDefaultsChange
  >;
  if (change) bucket[key] = change;
  else delete bucket[key];
  return slot.accountId ? { ...draft, accounts: bucket } : { ...draft, providers: bucket };
}
