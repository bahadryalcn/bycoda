import { t } from "../../../../shared/i18n";
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

/** Step one: the text model that will interview the owner, chosen like the Appearance generator's. */
export function BuilderModelStep({
  choice,
  onChange,
}: {
  choice: TranslationChoice;
  onChange: (choice: TranslationChoice) => void;
}) {
  return (
    <div className={styles.stage}>
      <p className={styles.muted}>
        {t(
          "A model asks you a few questions about how you want your assistant to look, sound and behave, then proposes a full profile. Nothing changes until you review it and save.",
        )}
      </p>
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
    </div>
  );
}
