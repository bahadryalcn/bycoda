import { t } from "../../../../shared/i18n";
import { usePointContextMenu } from "../../../../shared/ui/ContextMenu";
import type { DropdownMenuAction } from "../../../../shared/ui/DropdownMenu";
import { Mic, Volume2 } from "../../../../shared/ui/icons";
import { useVoiceSettings, type VoiceSettings } from "../../model/voiceSettings";
import { saveVoiceSettingsPatch } from "../../model/voiceSettingsSave";
import { audioDeviceChoices, useAudioDevices, type AudioDeviceKind } from "../useAudioDevices";

const DEVICES = {
  audioinput: { prefix: "microphone:", field: "microphoneId", label: () => t("Microphone") },
  audiooutput: { prefix: "output:", field: "speakerOutputId", label: () => t("Audio output") },
} as const satisfies Record<
  AudioDeviceKind,
  { prefix: string; field: keyof VoiceSettings; label: () => string }
>;

/** Device rows for one kind, checked on the saved choice. Ids carry the kind's prefix. */
function useDeviceRows(kind: AudioDeviceKind) {
  const settings = useVoiceSettings();
  const { devices, unidentified } = useAudioDevices(kind);
  const { prefix, field } = DEVICES[kind];
  const selected = settings[field];
  const choices = audioDeviceChoices(kind, devices, unidentified, selected);
  const rows = choices.map((choice) => ({
    kind: "item" as const,
    id: `${prefix}${choice.value}`,
    label: choice.label,
    disabled: choice.disabled,
    checked: choice.value === (selected ?? ""),
  }));
  const current = choices.find((choice) => choice.value === (selected ?? ""))?.label;
  return { rows, current };
}

/** Saves a picked device row; false when the id is not a device row. */
export function pickVoiceDevice(id: string): boolean {
  for (const { prefix, field } of Object.values(DEVICES)) {
    if (!id.startsWith(prefix)) continue;
    const value = id.slice(prefix.length);
    // An empty id means the system default, matching how the settings page saves it.
    saveVoiceSettingsPatch(
      field === "microphoneId" ? { microphoneId: value } : { speakerOutputId: value },
    );
    return true;
  }
  return false;
}

/** Microphone and audio output branches for the companion's options menu. */
export function useVoiceDeviceMenuItems(): DropdownMenuAction[] {
  const microphone = useDeviceRows("audioinput");
  const output = useDeviceRows("audiooutput");
  const branch = (
    kind: AudioDeviceKind,
    { rows, current }: ReturnType<typeof useDeviceRows>,
  ): DropdownMenuAction => ({
    kind: "item",
    id: kind,
    label: DEVICES[kind].label(),
    description: current,
    icon: kind === "audioinput" ? <Mic className="icon-sm" /> : <Volume2 className="icon-sm" />,
    submenu: rows.map((row) => ({ ...row, selectionRole: "radio" as const })),
  });
  return [branch("audioinput", microphone), branch("audiooutput", output)];
}

/**
 * Right-click (or the context-menu key) on the microphone or speaker button picks its device
 * in place. Spread `trigger` on the button and render `menu` next to it.
 */
export function useVoiceDeviceContextMenu(kind: AudioDeviceKind) {
  const { rows } = useDeviceRows(kind);
  return usePointContextMenu({
    ariaLabel: DEVICES[kind].label(),
    items: rows,
    onPick: (id) => void pickVoiceDevice(id),
  });
}
