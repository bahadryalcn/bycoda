import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { t } from "../../../shared/i18n";
import { Toggle } from "../../../shared/ui/settings";
import { saveVoicePreference } from "../model/voiceSettingsSave";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { loadVoiceMemory, saveVoiceMemory, useVoiceMemory } from "../model/voiceMemory";
import {
  VOICE_SETTINGS_DEFAULTS,
  type VoiceSettings as Preferences,
  type VoiceVisual,
} from "../model/voiceSettings";

/** Opens the Assistant Room on its settings or memory tab; the Room owns identity and memory notes. */
export function openAssistantRoom(tab: "settings" | "memory") {
  window.dispatchEvent(new CustomEvent("bycoda:open-assistant", { detail: { tab } }));
}

/** Whether the companion keeps notes between conversations, with a link to manage them. */
export function VoiceMemoryRow({ assistantMemoryCount }: { assistantMemoryCount?: number }) {
  const memory = useVoiceMemory();
  return (
    <Row
      id="voice-memory"
      label={t("Memory")}
      // The note count opens the Room's memory tab; the switch stays the row's only control.
      dependency={
        <Button variant="link" size="sm" onClick={() => openAssistantRoom("memory")}>
          {t("{p0} notes", { p0: assistantMemoryCount ?? memory.notes.length })}
        </Button>
      }
    >
      <Toggle
        label={t("Memory")}
        on={memory.enabled}
        onChange={(enabled) =>
          saveVoicePreference(
            "voice-memory",
            () => saveVoiceMemory({ ...loadVoiceMemory(), enabled }),
            () => loadVoiceMemory().enabled === enabled,
          )
        }
      />
    </Row>
  );
}

/** How the companion looks while it listens and speaks. */
export function VoiceVisualStyleRow({
  settings,
  change,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    // A deliberate full-width chooser: four previews need more room than the control column.
    <Row
      id="voice-visual-style"
      label={t("Visual style")}
      stacked
      modified={settings.visual !== VOICE_SETTINGS_DEFAULTS.visual}
      onReset={() => change({ visual: VOICE_SETTINGS_DEFAULTS.visual })}
    >
      <SegmentedControl
        label={t("Visual style")}
        value={settings.visual}
        optionIdPrefix="voice-visual"
        options={(
          [
            ["mark", t("bycoda mark")],
            ["wave", t("Wave")],
            ["dots", t("Dots")],
            ["orb", t("Orb")],
          ] as [VoiceVisual, string][]
        ).map(([value, label]) => ({
          value,
          label,
          accessory: <VoiceVisualizer visual={value} state="listening" small preview />,
        }))}
        onValueChange={(visual) => change({ visual: visual as VoiceVisual })}
      />
    </Row>
  );
}
