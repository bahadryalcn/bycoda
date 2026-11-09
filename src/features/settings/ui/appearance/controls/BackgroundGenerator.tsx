import { useRef, useState, type KeyboardEvent } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { TextField } from "../../../../../shared/ui/TextField";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { defaultTextActionChoice } from "../../../../sessions/public/translationPreferences";
import type { BackgroundGradientSuggestion } from "../../../model/backgroundGradient";
import { SettingsFeedback } from "../../settingsControls";
import { requestBackgroundSuggestion } from "./backgroundSuggestionRequest";
import styles from "./GradientStrip.module.css";

/** Describe a gradient in words; the Host writes one and the result is applied at once. */
export function BackgroundGenerator({
  onGenerated,
}: {
  onGenerated: (suggestion: BackgroundGradientSuggestion) => void;
}) {
  useLocale();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const epoch = useRef(0);
  const [choice] = useState(defaultTextActionChoice);
  const available = canRunHarnessTextPrompt(choice.harness);
  const trimmed = prompt.trim();

  const generate = async () => {
    if (!trimmed || !available || busy) return;
    const version = ++epoch.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = await requestBackgroundSuggestion({
        prompt: trimmed,
        harness: choice.harness,
        model: choice.model,
        modelSettings: choice.modelSettings,
        providerAccountId: choice.providerAccountId,
      });
      if (version === epoch.current) onGenerated(next);
    } catch {
      if (version === epoch.current) setFailed(true);
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void generate().catch(console.error);
  };

  return (
    <div className={styles.generator}>
      <div className={styles.generateRow}>
        <TextField
          className={styles.generatorPrompt}
          label={t("Describe a gradient")}
          hideLabel
          value={prompt}
          placeholder={t("Describe a gradient…")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          tone="accent"
          size="sm"
          className="shrink-0"
          loading={busy}
          loadingLabel={t("Generating…")}
          disabled={!trimmed || !available}
          disabledReason={
            available
              ? undefined
              : t("Choose a model that supports text actions to generate a gradient.")
          }
          onClick={() => void generate().catch(console.error)}
        >
          {t("Generate")}
        </Button>
      </div>
      {failed ? (
        <SettingsFeedback state="error">
          {t("Gradient generation failed. Try again.")}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
