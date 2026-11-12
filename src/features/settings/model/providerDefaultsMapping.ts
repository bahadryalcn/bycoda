import type { HarnessId } from "../../../shared/model/harnessIdentity";
import type { ModelSetting } from "../../sessions/public/models";
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
) {
  const result: DefaultsDraft = { ...draft, providers: { ...draft.providers } };
  const skipped: DefaultsSkip[] = [];
  const own = draft.providers[source];
  if (!own) return { draft: result, skipped };
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
      // Delegate references and image/model lists carry provider/account identity.
      if (field === "crossSubagents" || field === "crossAdvisor") {
        if (value === null || value === "null" || value === "[]")
          change.extras = { ...change.extras, [field]: value };
        else skipped.push({ harness: support.harness, field, value });
        continue;
      }
      if (/advisor|subagentModel|imageModels/i.test(field)) {
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
