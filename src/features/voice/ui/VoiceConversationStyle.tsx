import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import {
  saveProfessionalConversationPreset,
  VOICE_PRESET_FAILED,
} from "../model/voiceConversationPreset";
import { saveVoiceTurnEndChoice, VOICE_TURN_CHOICE_FAILED } from "../model/voiceTurnPolicy";
import {
  Group,
  Row,
  Select,
  SettingsFeedback,
  Toggle,
} from "../../settings/public/settingsControls";
import { VoiceWakeRows } from "./VoiceWakeSettings";
import type { VoiceSettings as Preferences } from "../model/voiceSettings";

/** How a spoken conversation takes turns: pauses, interruptions, progress updates and sleep. */
export function VoiceConversationStyle({
  settings,
  change,
  profile,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
  profile?: { name: string; language: string };
}) {
  const [presetError, setPresetError] = useState(false);
  const [turnChoiceError, setTurnChoiceError] = useState(false);
  const idleChoices = [0, 5, 10, 15, 30, 60];
  return (
    <Group
      title={t("Conversation style")}
      layout="full"
      action={
        <Button
          size="sm"
          onClick={() => {
            try {
              saveProfessionalConversationPreset();
              setPresetError(false);
              setTurnChoiceError(false);
            } catch {
              setPresetError(true);
            }
          }}
        >
          {t("Apply professional preset")}
        </Button>
      }
      description={t(
        "Uses a longer pause, allows interruptions, and holds spoken progress updates. You can change each setting afterward.",
      )}
      descriptionVisible={false}
      feedback={
        presetError ? (
          <SettingsFeedback state="error">{t(VOICE_PRESET_FAILED)}</SettingsFeedback>
        ) : undefined
      }
    >
      <Row
        id="voice-turn-silence"
        label={t("Wait before replying")}
        description={
          settings.manualTurnEnd
            ? t("Automatic pause detection is off. Choose Finish turn when you are ready.")
            : undefined
        }
      >
        <Select
          hideLabel
          label={t("Wait before replying")}
          disabled={settings.manualTurnEnd === true}
          value={String(settings.turnEndSilence ?? 1.2)}
          options={[
            { value: "1.2", label: t("Natural pause") },
            { value: "2.5", label: t("Longer pause") },
            { value: "4", label: t("Extra time") },
          ]}
          onChange={(value) => change({ turnEndSilence: Number(value) })}
        />
      </Row>
      <Row
        id="voice-manual-turn-end"
        label={t("I decide when my turn ends")}
        description={t(
          "Long pauses keep listening. Choose Finish turn to send your speech. You can switch back to automatic replies here.",
        )}
        feedback={
          turnChoiceError ? (
            <SettingsFeedback state="error">{t(VOICE_TURN_CHOICE_FAILED)}</SettingsFeedback>
          ) : undefined
        }
      >
        <Toggle
          label={t("I decide when my turn ends")}
          on={settings.manualTurnEnd === true}
          onChange={(manual) => {
            try {
              saveVoiceTurnEndChoice(manual);
              setTurnChoiceError(false);
            } catch {
              setTurnChoiceError(true);
            }
          }}
        />
      </Row>
      {settings.mode === "openai" && (
        <Row
          id="voice-semantic-vad"
          label={t("Experimental OpenAI turn detection")}
          description={t(
            "Sends live microphone audio to OpenAI continuously while listening. Automatic mode only; disconnect and reconnect voice to apply. Push to talk is unavailable in this mode.",
          )}
        >
          <Toggle
            label={t("Experimental OpenAI turn detection")}
            on={settings.experimentalSemanticVad === true}
            disabled={settings.manualTurnEnd === true}
            onChange={(experimentalSemanticVad) => change({ experimentalSemanticVad })}
          />
        </Row>
      )}
      <Row
        id="voice-barge-in"
        label={t("I may interrupt speech")}
        description={t("Lets your speech interrupt the assistant's reply.")}
      >
        <Toggle
          label={t("I may interrupt speech")}
          on={settings.allowBargeIn !== false}
          onChange={(allowBargeIn) => change({ allowBargeIn })}
        />
      </Row>
      <Row id="voice-hold-announcements" label={t("Hold spoken progress updates")}>
        <Toggle
          label={t("Hold spoken progress updates")}
          on={settings.holdAnnouncements === true}
          onChange={(holdAnnouncements) => change({ holdAnnouncements })}
        />
      </Row>
      <Row
        id="voice-idle-sleep"
        label={t("Sleep voice when I'm idle")}
        description={t(
          "Closes the microphone while idle. Returning leaves it off until you press Talk.",
        )}
      >
        <Select
          hideLabel
          label={t("Sleep voice when I'm idle")}
          value={String(settings.idleSleepMinutes)}
          options={[
            { value: "0", label: t("Never") },
            ...[...idleChoices.slice(1), settings.idleSleepMinutes]
              .filter((minutes, index, all) => minutes > 0 && all.indexOf(minutes) === index)
              .map((minutes) => ({
                value: String(minutes),
                label: t("{p0} min", { p0: minutes }),
              })),
          ]}
          onChange={(value) => change({ idleSleepMinutes: Number(value) })}
        />
      </Row>
      <Row
        id="voice-return-call"
        label={t("Call me when I return")}
        description={t(
          "When you come back, the assistant speaks first and the microphone opens briefly. If you don't answer, it closes and you are notified.",
        )}
      >
        <Toggle
          label={t("Call me when I return")}
          on={settings.returnCall === true}
          onChange={(returnCall) => change({ returnCall })}
        />
      </Row>
      {settings.returnCall === true && (
        <Row id="voice-return-call-seconds" label={t("Listen for after calling")}>
          <Select
            hideLabel
            label={t("Listen for after calling")}
            value={String(settings.returnCallSeconds ?? 20)}
            options={[...new Set([5, 10, 20, 30, 60, 120, settings.returnCallSeconds ?? 20])]
              .sort((a, b) => a - b)
              .map((seconds) => ({
                value: String(seconds),
                label: t("{p0} seconds", { p0: seconds }),
              }))}
            onChange={(value) => change({ returnCallSeconds: Number(value) })}
          />
        </Row>
      )}
      <VoiceWakeRows settings={settings} change={change} profile={profile} />
    </Group>
  );
}
