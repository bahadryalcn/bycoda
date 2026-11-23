import { useSyncExternalStore, type ComponentProps } from "react";
import { t } from "../../../shared/i18n";
import { Row, SettingsFeedback } from "../../../shared/ui/settings";
import { voiceSaveFailures } from "../model/voiceSettingsSave";

/** Voice persistence feedback belongs to the initiating settings row, including after navigation. */
export function VoicePreferenceRow({ id, feedback, ...props }: ComponentProps<typeof Row>) {
  const failures = useSyncExternalStore(voiceSaveFailures.subscribe, voiceSaveFailures.get);
  const failure = id && failures[id];
  return (
    <Row
      {...props}
      id={id}
      feedback={
        failure ? (
          <>
            {feedback}
            <SettingsFeedback state="error" action={{ label: t("Retry"), onClick: failure.retry }}>
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
