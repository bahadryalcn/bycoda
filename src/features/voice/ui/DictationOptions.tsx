import { useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { useT } from "../../../shared/i18n";
import { DICTATION_LANGUAGES } from "../model/dictationModels";
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../model/voiceSettings";
import styles from "./DictationButton.module.css";

/**
 * Composer shortcut next to the microphone: the language of the next dictation, the one choice
 * that changes mid-work. Recognizer and model live in Settings → Voice assistant.
 */
export function DictationOptions({
  settings,
  disabled,
}: {
  settings: VoiceSettings;
  disabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const radio = (code: string, label: string) => ({
    kind: "item" as const,
    id: code,
    label,
    checked: settings.dictationLanguage === code,
    selectionRole: "radio" as const,
  });

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        motion="none"
        iconOnly
        stretch
        touchTarget="control"
        className={styles.options}
        label={t("Dictation language")}
        aria-haspopup="menu"
        expanded={open}
        opens="up"
        disabled={disabled}
        disabledReason={t("Dictation language is locked while dictation is running.")}
        // Keep the caret in the message box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Dictation language")}
          side="top"
          size="sm"
          onClose={() => setOpen(false)}
          onPick={(id) =>
            saveVoiceSettings({
              ...loadVoiceSettings(),
              dictationLanguage: id as VoiceSettings["dictationLanguage"],
            })
          }
          items={[
            radio("auto", t("Automatic")),
            ...DICTATION_LANGUAGES.map(([code, label]) => radio(code, label)),
          ]}
        />
      ) : null}
    </>
  );
}
