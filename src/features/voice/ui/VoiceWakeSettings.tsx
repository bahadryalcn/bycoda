import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { usePhraseDraft } from "../model/voiceSettingsDrafts";
import { getLocale, t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { Toggle } from "../../settings/public/settingsControls";
import type { VoiceSettings as Preferences } from "../model/voiceSettings";
import { defaultWakePhrases, WAKE_PHRASE_LIMITS } from "../model/voiceWakePhrase";
import { isImeComposition } from "../../../shared/lib/keyboard";

function PhraseField({
  id,
  label,
  placeholder,
  value,
  save,
}: {
  id: string;
  label: string;
  placeholder: string;
  /** Owner-typed phrase; empty means the language default. */
  value: string;
  save: (text: string | undefined) => void;
}) {
  const [draft, setDraft] = usePhraseDraft(id, value);
  const text = draft.trim();
  const invalid =
    text !== "" && (text.length < WAKE_PHRASE_LIMITS.min || text.length > WAKE_PHRASE_LIMITS.max);
  const commit = () => {
    if (!invalid && text !== value) save(text || undefined);
  };
  return (
    <Row id={id} label={label}>
      <TextField
        label={label}
        hideLabel
        value={draft}
        placeholder={placeholder}
        maxLength={WAKE_PHRASE_LIMITS.max}
        error={
          invalid
            ? t("Use {p0} to {p1} characters.", {
                p0: WAKE_PHRASE_LIMITS.min,
                p1: WAKE_PHRASE_LIMITS.max,
              })
            : undefined
        }
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) commit();
        }}
      />
    </Row>
  );
}

/** Opt-in wake and sleep phrases; empty fields use the language default with the assistant's name. */
export function VoiceWakeRows({
  settings,
  change,
  profile,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
  /** The saved assistant name and spoken language, for the placeholder defaults. */
  profile?: { name: string; language: string };
}) {
  const defaults = defaultWakePhrases(profile?.language, getLocale(), profile?.name ?? "");
  return (
    <>
      <Row
        id="voice-wake"
        label={t("Wake and sleep phrases")}
        description={t(
          "Listens on this computer only for your wake phrase, while no conversation is open, and starts Talk when you say it. Your sleep phrase ends the conversation. Audio never leaves this computer before the phrase is heard.",
        )}
      >
        <Toggle
          label={t("Wake and sleep phrases")}
          on={settings.wakeEnabled === true}
          onChange={(wakeEnabled) => change({ wakeEnabled })}
        />
      </Row>
      {settings.wakeEnabled === true && (
        <>
          <PhraseField
            id="voice-wake-phrase"
            label={t("Wake phrase")}
            placeholder={defaults.wake}
            value={settings.wakePhrase ?? ""}
            save={(wakePhrase) => change({ wakePhrase })}
          />
          <PhraseField
            id="voice-sleep-phrase"
            label={t("Sleep phrase")}
            placeholder={defaults.sleep}
            value={settings.sleepPhrase ?? ""}
            save={(sleepPhrase) => change({ sleepPhrase })}
          />
        </>
      )}
    </>
  );
}
