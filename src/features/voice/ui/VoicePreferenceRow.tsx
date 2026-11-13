import { useSyncExternalStore, type ComponentProps } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Row, SettingsFeedback } from "../../settings/public/settingsControls";
import { voiceSaveFailures } from "../model/voiceSettingsSave";

/** Voice persistence feedback belongs to the initiating settings row, including after navigation. */
export function VoicePreferenceRow({ id, feedback, ...props }: ComponentProps<typeof Row>) {
  const failures = useSyncExternalStore(voiceSaveFailures.subscribe, voiceSaveFailures.get);
  const failure =
    id && (failures[id] ?? (id === "dictation-device" ? failures["voice-device"] : undefined));
  return (
    <Row
      {...props}
      id={id}
      feedback={
        failure ? (
          <>
            {feedback}
            <SettingsFeedback
              state="error"
              action={<Button onClick={failure.retry}>{t("Retry")}</Button>}
            >
              {t("This change could not be saved. The saved value is still in use.")}
            </SettingsFeedback>
          </>
        ) : (
          feedback
        )
      }
    />
  );
}
