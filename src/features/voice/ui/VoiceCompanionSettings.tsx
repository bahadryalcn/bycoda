import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Pencil, Settings } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { Group, Toggle } from "../../../shared/ui/settings";
import { saveVoicePreference } from "../model/voiceSettingsSave";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { useVoicePersona } from "../model/voicePersona";
import { VoicePersonaDialog, voicePersonaSummary } from "./VoicePersonaDialog";
import { loadVoiceMemory, saveVoiceMemory, useVoiceMemory } from "../model/voiceMemory";
import type { VoiceSettings as Preferences, VoiceVisual } from "../model/voiceSettings";

/** Who the companion is, what it remembers and how it looks. */
export function VoiceCompanionSettings({
  settings,
  change,
  assistantName,
  assistantMemoryCount,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
  /** The shared Assistant name, when the owner set one. */
  assistantName?: string;
  assistantMemoryCount?: number;
}) {
  const persona = useVoicePersona();
  const memory = useVoiceMemory();
  const [editingStyle, setEditingStyle] = useState(false);
  const openAssistant = (tab: "settings" | "memory") =>
    window.dispatchEvent(new CustomEvent("bycoda:open-assistant", { detail: { tab } }));
  return (
    <Group title={t("Assistant")} layout="full">
      <Row id="voice-persona" label={assistantName ?? voicePersonaSummary(persona)}>
        <Button
          startIcon={<Settings className="icon-sm" />}
          variant="ghost"
          onClick={() => openAssistant("settings")}
        >
          {t("Assistant settings")}
        </Button>
      </Row>
      {editingStyle ? (
        <VoicePersonaDialog purpose="edit" styleOnly onClose={() => setEditingStyle(false)} />
      ) : null}
      <Row
        id="voice-memory"
        label={t("Memory")}
        descriptionVisible
        description={t("Keeps short notes about you between conversations on this computer.")}
      >
        <Button onClick={() => openAssistant("memory")}>
          {t("Manage ({p0})", {
            p0: assistantMemoryCount ?? memory.notes.length,
          })}
        </Button>
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
      <Row id="voice-style" label={t("Voice style")}>
        <Button
          startIcon={<Pencil className="icon-sm" />}
          variant="ghost"
          onClick={() => setEditingStyle(true)}
        >
          {t("Customize")}
        </Button>
      </Row>
      {/* A deliberate full-width chooser: four previews need more room than the control column. */}
      <Row id="voice-visual-style" label={t("Visual style")} stacked>
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
    </Group>
  );
}
