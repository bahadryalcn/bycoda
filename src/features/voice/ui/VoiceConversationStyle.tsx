import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Settings } from "../../../shared/ui/icons";
import { t, useFormat } from "../../../shared/i18n";
import { saveVoiceTurnEndChoice, voiceTurnChoiceFailedText } from "../model/voiceTurnPolicy";
import { Group, Select, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import { openAssistantRoom, VoiceMemoryRow } from "./VoiceCompanionSettings";
import type { VoiceSettings as Preferences } from "../model/voiceSettings";

const MANUAL_TURN_END = "manual";

/** How a spoken conversation takes turns, what it remembers, and when it sleeps or calls back. */
export function VoiceConversationStyle({
  settings,
  change,
  assistantMemoryCount,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
  assistantMemoryCount?: number;
}) {
  const [turnChoiceError, setTurnChoiceError] = useState(false);
  const { formatNumber } = useFormat();
  const pause = settings.turnEndSilence ?? 1.2;
  const manual = settings.manualTurnEnd === true;
  const idleChoices = [0, 5, 10, 15, 30, 60];
  // One choice covers both ways a turn ends; leaving manual mode goes through the acknowledged opt-in save.
  const chooseTurnEnd = (value: string) => {
    try {
      if (value === MANUAL_TURN_END) {
        if (!manual) saveVoiceTurnEndChoice(true);
      } else {
        if (manual) saveVoiceTurnEndChoice(false);
        change({ turnEndSilence: Number(value) });
      }
      setTurnChoiceError(false);
    } catch {
      setTurnChoiceError(true);
    }
  };
  return (
    <Group
      title={t("Conversation")}
      layout="full"
      action={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Settings className="icon-sm" />}
          onClick={() => openAssistantRoom("settings")}
        >
          {t("Assistant settings")}
        </Button>
      }
    >
      <Row
        id="voice-turn-silence"
        label={t("Wait before replying")}
        description={
          manual
            ? t(
                "Long pauses keep listening. Choose Finish turn to send your speech. You can switch back to automatic replies here.",
              )
            : undefined
        }
        descriptionVisible={manual}
        feedback={
          turnChoiceError ? (
            <SettingsFeedback state="error">{voiceTurnChoiceFailedText()}</SettingsFeedback>
          ) : undefined
        }
      >
        <Select
          hideLabel
          label={t("Wait before replying")}
          value={manual ? MANUAL_TURN_END : String(pause)}
          options={[
            { value: "1.2", label: t("Natural pause") },
            { value: "2.5", label: t("Longer pause") },
            { value: "4", label: t("Extra time") },
            ...(![1.2, 2.5, 4].includes(pause)
              ? [{ value: String(pause), label: t("{p0} seconds", { p0: formatNumber(pause) }) }]
              : []),
            { value: MANUAL_TURN_END, label: t("I end my turn") },
          ]}
          onChange={chooseTurnEnd}
        />
      </Row>
      <VoiceMemoryRow assistantMemoryCount={assistantMemoryCount} />
      <Row id="voice-barge-in" label={t("I may interrupt speech")}>
        <Toggle
          label={t("I may interrupt speech")}
          on={settings.allowBargeIn !== false}
          onChange={(allowBargeIn) => change({ allowBargeIn })}
        />
      </Row>
      <Row id="voice-remove-fillers" label={t("Remove filler words in replies")}>
        <Toggle
          label={t("Remove filler words in replies")}
          on={settings.removeFillers === true}
          onChange={(removeFillers) => change({ removeFillers })}
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
        descriptionVisible
      >
        <Toggle
          label={t("Call me when I return")}
          on={settings.returnCall === true}
          onChange={(returnCall) => change({ returnCall })}
        />
      </Row>
      {settings.mode === "openai" && (
        <Row
          id="voice-semantic-vad"
          label={t("Experimental OpenAI turn detection")}
          description={t(
            "Sends live microphone audio to OpenAI continuously while listening. Automatic mode only; disconnect and reconnect voice to apply. Push to talk is unavailable in this mode.",
          )}
          descriptionVisible
        >
          <Toggle
            label={t("Experimental OpenAI turn detection")}
            on={settings.experimentalSemanticVad === true}
            disabled={manual}
            onChange={(experimentalSemanticVad) => change({ experimentalSemanticVad })}
          />
        </Row>
      )}
    </Group>
  );
}
