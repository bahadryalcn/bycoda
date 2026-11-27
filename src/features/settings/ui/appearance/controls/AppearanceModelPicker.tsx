import { lazy, Suspense } from "react";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { HARNESSES } from "../../../../sessions";
import { defaultModelSettings, resolveModel } from "../../../../sessions/public/models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../../../providers/public/providerAccounts";
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";

const ModelPicker = lazy(() =>
  import("../../../../sessions")
    .then((entry) => entry.loadModelPicker())
    .then((module) => ({ default: module.ModelPicker })),
);

/** Shared Appearance model/account choice for theme, scene and motion creation. */
export function AppearanceModelPicker() {
  const [choice, setChoice] = useThemeGeneratorModel();
  return (
    <Suspense fallback={<LoadingText />}>
      <ModelPicker
        harness={choice.harness}
        model={choice.model}
        values={choice.modelSettings ?? {}}
        accountId={choice.providerAccountId}
        accountChoices
        allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
        onChange={(harness, model, accountId) =>
          setChoice({
            ...choice,
            harness,
            model,
            modelSettings: defaultModelSettings(resolveModel(harness, model)),
            providerAccountId: supportsProviderAccounts(harness)
              ? (accountId ?? defaultProviderAccountId(harness))
              : undefined,
          })
        }
        onSettingsChange={(modelSettings) => setChoice({ ...choice, modelSettings })}
      />
    </Suspense>
  );
}
