import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Sparkles } from "../../../shared/ui/icons";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { Text } from "../../../shared/ui/Text";
import { useDetectedDictationLanguage } from "../model/dictationActivity";
import { DICTATION_LANGUAGES } from "../model/dictationModels";
import { localVoiceBackend } from "../model/localVoiceClient";
import type { VoiceSettings } from "../model/voiceSettings";
import { useDictationSuggestion } from "../model/voiceSettingsDrafts";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";

/** Explicit Codex request with a review step before any settings are saved. */
export function DictationSettingsSuggestion({
  settings,
  apply,
}: {
  settings: VoiceSettings;
  apply: (patch: { instructions: string; correctionCue: string }) => boolean;
}) {
  const locale = useLocale();
  const detected = useDetectedDictationLanguage();
  const explicit = settings.dictationLanguage !== "auto";
  const detectedOption = DICTATION_LANGUAGES.find(([id]) => id === detected);
  const [language, label] = (explicit
    ? DICTATION_LANGUAGES.find(([id]) => id === settings.dictationLanguage)
    : detectedOption) ??
    DICTATION_LANGUAGES.find(([id]) => id === locale.split("-")[0]) ?? ["en", "English"];
  const [suggestion, setSuggestion] = useDictationSuggestion();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [applyError, setApplyError] = useState(false);
  const request = useRef<string | null>(null);
  const cleanup = settings.dictationCleanup;
  // Dismissed settings release pending Codex work. Completed suggestions survive navigation.
  useEffect(
    () => () => {
      const current = request.current;
      request.current = null;
      if (current) void localVoiceBackend.cancelDictationCleanup(current).catch(() => {});
    },
    [],
  );

  async function suggest() {
    if (request.current) return;
    const id = crypto.randomUUID();
    request.current = id;
    setPending(true);
    setError(false);
    setApplyError(false);
    try {
      const result = await localVoiceBackend.suggestDictationSettings(id, language, cleanup.model);
      if (request.current !== id) return;
      const { instructions, correctionCue } = JSON.parse(result.text) as {
        instructions: string;
        correctionCue: string;
      };
      setSuggestion({ language, label, instructions, correctionCue });
    } catch {
      if (request.current === id) setError(true);
    } finally {
      if (request.current === id) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function cancel() {
    const current = request.current;
    request.current = null;
    setPending(false);
    if (current) void localVoiceBackend.cancelDictationCleanup(current).catch(() => {});
  }

  return (
    <>
      <Row
        label={t("Draft settings with AI")}
        descriptionVisible
        description={t(
          "Codex uses {p0} to suggest instructions and a correction phrase. Only the language and model choice are sent.",
          { p0: label },
        )}
        feedback={
          error ? (
            <SettingsFeedback state="error">
              {t("Could not generate dictation settings. Try again.")}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Button
          startIcon={<Sparkles aria-hidden />}
          loading={pending}
          loadingLabel={t("Generating…")}
          onClick={() => void suggest()}
        >
          {t("Generate suggestion")}
        </Button>
        {pending ? (
          <Button variant="ghost" onClick={cancel}>
            {t("Cancel")}
          </Button>
        ) : null}
      </Row>
      {suggestion ? (
        <Row label={t("Suggested settings · {p0}", { p0: suggestion.label })} stacked>
          <div className="grid gap-2">
            {suggestion.language !== language ? (
              <SettingsFeedback state="warning">
                {t("The dictation language has changed since this suggestion was generated.")}
              </SettingsFeedback>
            ) : null}
            {cleanup.instructions || cleanup.correctionCue ? (
              <Text tone="secondary">
                {t(
                  "Applying this suggestion replaces your current instructions and correction phrase.",
                )}
              </Text>
            ) : null}
            <Text>{t("Cleanup instructions")}</Text>
            <Text tone="secondary" wrap="anywhere">
              {suggestion.instructions}
            </Text>
            <Text>{t("Correction phrase")}</Text>
            <Text tone="secondary" wrap="anywhere">
              {suggestion.correctionCue}
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() => {
                  const saved = apply({
                    instructions: suggestion.instructions,
                    correctionCue: suggestion.correctionCue,
                  });
                  setApplyError(!saved);
                  if (saved) setSuggestion(null);
                }}
              >
                {t("Apply suggestion")}
              </Button>
              <Button variant="ghost" onClick={() => setSuggestion(null)}>
                {t("Discard")}
              </Button>
            </div>
            {applyError ? (
              <SettingsFeedback state="error">
                {t("Could not save the suggested settings. Try again.")}
              </SettingsFeedback>
            ) : null}
          </div>
        </Row>
      ) : null}
    </>
  );
}
