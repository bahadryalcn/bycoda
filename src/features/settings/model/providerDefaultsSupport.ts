import type { HarnessId } from "../../../shared/model/harnessIdentity";
import {
  defaultModelId,
  modelEffortSetting,
  modelsFor,
  resolveModel,
} from "../../sessions/public/models";
import { menuSettings } from "../../sessions/public/modelPickerData";
import { RUNTIME_MODES, runtimeModeUnavailableReason } from "../../sessions/public/session";
import { mapDefaultsToProviders } from "./providerDefaultsMapping";
import type { DefaultsDraft } from "./providerDefaultsDraft";

export function prepareDefaultsDraft(
  draft: DefaultsDraft,
  source: HarnessId,
  providers: readonly HarnessId[],
) {
  if (draft.providerScope !== "all") return { draft, skipped: [] };
  return mapDefaultsToProviders(
    draft,
    source,
    providers.map((harness) => {
      const model = resolveModel(harness, defaultModelId(harness));
      return {
        harness,
        permissions: RUNTIME_MODES.filter((mode) => !runtimeModeUnavailableReason(harness, mode)),
        effort: modelEffortSetting(model)?.options.map((option) => option.value) ?? [],
        extras: menuSettings({
          current: model,
          harnesses: [...providers],
          source: { modelsFor },
          values: {},
          unavailable: (name) => name,
        }),
      };
    }),
  );
}
