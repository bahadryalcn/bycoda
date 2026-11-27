import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { MODEL_ROUTING_DELEGATION_KEYS } from "../../../shared/model/host-contracts/model-routing";
import type { ModelSetting } from "../../sessions/public/models";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import type { DefaultsDraft, ProviderDefaultsChange } from "./providerDefaultsDraft";

export type DefaultsProviderSupport = {
  harness: HarnessId;
  permissions: readonly string[];
  effort: readonly string[];
  extras: readonly ModelSetting[];
};
export type DefaultsSkip = { harness: HarnessId; field: string; value: string | null };

/** Copies portable, explicit edits only. Model/account identities never cross providers. */
export function mapDefaultsToProviders(
  draft: DefaultsDraft,
  source: HarnessId,
  providers: readonly DefaultsProviderSupport[],
  /** The source's saved values in the target: "All providers" copies what the page shows, not only the edit. */
  stored: ProviderSessionDefaults = {},
) {
  const result: DefaultsDraft = { ...draft, providers: { ...draft.providers } };
  const skipped: DefaultsSkip[] = [];
  const edit = draft.providers[source];
  if (!edit) return { draft: result, skipped };
  const own: ProviderDefaultsChange = {
    effort: edit.effort !== undefined ? edit.effort : stored.effort,
    runtimeMode: edit.runtimeMode !== undefined ? edit.runtimeMode : stored.runtimeMode,
    extras: { ...stored.extras, ...edit.extras },
  };
  for (const support of providers) {
    if (support.harness === source) continue;
    const change: ProviderDefaultsChange = { ...result.providers[support.harness] };
    const copy = (field: "effort" | "runtimeMode", values: readonly string[]) => {
      const value = own[field];
      if (value === undefined) return;
      if (values.length && (value === null || values.includes(value))) change[field] = value;
      else skipped.push({ harness: support.harness, field, value });
    };
    copy("effort", support.effort);
    copy("runtimeMode", support.permissions);
    for (const [field, value] of Object.entries(own.extras ?? {})) {
      // Helpers have their own All providers choice in their section; copying them here would
      // leave a per-provider copy that hides later All providers changes.
      if ((MODEL_ROUTING_DELEGATION_KEYS as readonly string[]).includes(field)) continue;
      if (/advisor|subagentModel/i.test(field)) {
        skipped.push({ harness: support.harness, field, value });
        continue;
      }
      const fast = field === "fast" || field === "serviceTier";
      const setting = support.extras.find(
        (entry) =>
          entry.id === field || (fast && (entry.id === "fast" || entry.id === "serviceTier")),
      );
      const mapped =
        fast &&
        value !== null &&
        setting?.id !== field &&
        ["fast", "true", "false", "default", "standard"].includes(value)
          ? setting?.id === "fast"
            ? value === "fast" || value === "true"
              ? "true"
              : "false"
            : value === "true" || value === "fast"
              ? "fast"
              : "default"
          : value;
      if (
        setting &&
        (mapped === null || setting.options.some((option) => option.value === mapped))
      ) {
        change.extras = { ...change.extras, [setting.id]: mapped };
      } else skipped.push({ harness: support.harness, field, value });
    }
    if (Object.keys(change).length) result.providers[support.harness] = change;
  }
  return { draft: result, skipped };
}
