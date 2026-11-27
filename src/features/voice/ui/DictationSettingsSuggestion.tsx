import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Dismissed settings release pending Codex work; completed suggestions survive navigation.
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
        id="dictation-cleanup-suggest"
        label={t("Suggest instructions")}
        description={t("Codex gets only the language ({p0}) and your model choice.", { p0: label })}
        feedback={
          error ? (
            <SettingsFeedback state="error">
              {t("Could not generate dictation settings. Try again.")}
            </SettingsFeedback>
          ) : undefined
        }
      >
        {pending ? (
          <Button variant="secondary" size="sm" onClick={cancel}>
            {t("Cancel")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void suggest()}>
            {t("Suggest")}
          </Button>
        )}
      </Row>
      {suggestion ? (
        <Row label={t("Suggestion · {p0}", { p0: suggestion.label })} stacked>
          <div className="grid gap-2">
            {suggestion.language !== language ? (
              <SettingsFeedback state="warning">
                {t("The dictation language has changed since this suggestion was generated.")}
              </SettingsFeedback>
            ) : null}
            {cleanup.instructions || cleanup.correctionCue ? (
              <SettingsFeedback state="warning">
                {t(
                  "Applying this suggestion replaces your current instructions and correction phrase.",
                )}
              </SettingsFeedback>
            ) : null}
            <Text size="caption" tone="secondary">
              {t("Instructions")}
            </Text>
            <Text wrap="anywhere">{suggestion.instructions}</Text>
            <Text size="caption" tone="secondary">
              {t("Correction phrase")}
            </Text>
            <Text wrap="anywhere">{suggestion.correctionCue}</Text>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
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
              <Button variant="ghost" size="sm" onClick={() => setSuggestion(null)}>
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
