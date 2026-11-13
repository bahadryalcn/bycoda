import { Text } from "../../../../shared/ui/Text";
import { canRunHarnessTextPrompt } from "../../../../integrations/harness";
import { HARNESSES } from "../../../../shared/model/harnessIdentity";
import { defaultModelSettings, resolveModel } from "../../../sessions/public/models";
import type { TranslationChoice } from "../../../sessions/public/translationPreferences";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../../providers/public/providerAccounts";
import styles from "./AssistantBuilder.module.css";

/** Optional model selection in the interview answer toolbar. */
export function BuilderModelStep({
  choice,
  onChange,
}: {
  choice: TranslationChoice;
  onChange: (choice: TranslationChoice) => void;
}) {
  return (
    <Text as="div" size="inherit" tone="inherit" leading="normal" className={styles.stage}>
      <ModelPicker
        harness={choice.harness}
        model={choice.model}
        values={choice.modelSettings ?? {}}
        accountId={choice.providerAccountId}
        accountChoices
        allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
        onChange={(harness, model, accountId) =>
          onChange({
            ...choice,
            harness,
            model,
            modelSettings: defaultModelSettings(resolveModel(harness, model)),
            // The Host runs the prompt under this bycoda account; without one it would use the
            // provider's own default login, which may be signed out.
            providerAccountId: supportsProviderAccounts(harness)
              ? (accountId ?? defaultProviderAccountId(harness))
              : undefined,
          })
        }
        onSettingsChange={(modelSettings) => onChange({ ...choice, modelSettings })}
      />
    </Text>
  );
}
