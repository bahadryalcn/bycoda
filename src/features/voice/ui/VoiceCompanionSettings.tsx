import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Badge } from "../../../shared/ui/Badge";
import { t } from "../../../shared/i18n";
import { Group, Row, Toggle } from "../../settings/public/settingsControls";
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
    <Group title={t("Companion")} layout="full">
      <Row
        id="voice-persona"
        label={t("Companion identity")}
        description={t("Name, how it addresses you, tone, tasks and ground rules.")}
      >
        <Badge tone="neutral">{assistantName ?? voicePersonaSummary(persona)}</Badge>
        <Button onClick={() => openAssistant("settings")}>{t("Customize")}</Button>
        <Button variant="ghost" onClick={() => setEditingStyle(true)}>
          {t("Voice style")}
        </Button>
      </Row>
      {editingStyle ? (
        <VoicePersonaDialog purpose="edit" styleOnly onClose={() => setEditingStyle(false)} />
      ) : null}
      <Row
        id="voice-memory"
        label={t("Memory")}
        description={t("Keeps short notes about you between conversations on this device.")}
      >
        <Button onClick={() => openAssistant("memory")}>
          {t("Manage ({p0})", {
            p0: assistantMemoryCount ?? memory.notes.length,
          })}
        </Button>
        <Toggle
          label={t("Memory")}
          on={memory.enabled}
          onChange={(enabled) => saveVoiceMemory({ ...loadVoiceMemory(), enabled })}
        />
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
