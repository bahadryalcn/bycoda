import { useEffect, type KeyboardEvent } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { TextField } from "../../../../../shared/ui/TextField";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";
import { generatorSession, useGeneratorState } from "./themeGeneratorSession";
import { themeSuggestionFailureDetail } from "./themeSuggestionRequest";
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
  const [prompt, setPrompt] = useGeneratorState("gradientPrompt", "");
  const [busy, setBusy] = useGeneratorState("gradientBusy", false);
  const [failure, setFailure] = useGeneratorState<string | null>("gradientFailure", null);
  const [choice] = useThemeGeneratorModel();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Bind the mounted gradient editor as the session's destination for in-flight generation.
  useEffect(() => generatorSession.bindGradient(onGenerated), [onGenerated]);
  const available = canRunHarnessTextPrompt(choice.harness);
  const trimmed = prompt.trim();

  const generate = async () => {
    if (!trimmed || !available || busy) return;
    const intent = generatorSession.imageIntent();
    setBusy(true);
    setFailure(null);
    try {
      const next = await requestBackgroundSuggestion({
        prompt: trimmed,
        harness: choice.harness,
        model: choice.model,
        modelSettings: choice.modelSettings,
        providerAccountId: choice.providerAccountId,
      });
      if (intent === generatorSession.imageIntent()) generatorSession.applyGradient(next);
    } catch (error) {
      setFailure(themeSuggestionFailureDetail(error));
    } finally {
      setBusy(false);
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
        <span>
          {t("Model: {p1}", {
            p1: `${choice.harness} / ${choice.model}${choice.providerAccountId ? ` / ${choice.providerAccountId}` : ""}`,
          })}
        </span>
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
          {t("Generate gradient")}
        </Button>
      </div>
      <span>{t("Applies when ready")}</span>
      {failure !== null ? (
        <SettingsFeedback state="error">
          {t("Gradient generation failed. Try again.")} {failure}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
