import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
import type { VoiceSettings } from "../model/voiceSettings";
import { useVoiceWake } from "./useVoiceWake";
import { VoiceWakeIndicator } from "./VoiceWakeIndicator";

/** Mounts the wake listener and its indicator while the owner has the phrase enabled. */
export function VoiceWake({
  settings,
  profile,
  manualPresence,
  onSetup,
}: {
  settings: VoiceSettings;
  profile: Pick<AssistantProfile, "name" | "language">;
  manualPresence?: string;
  onSetup: () => void;
}) {
  const wake = useVoiceWake({ settings, profile, manualPresence });
  return wake.indicator ? (
    <VoiceWakeIndicator state={wake.indicator} onOff={wake.turnOff} onSetup={onSetup} />
  ) : null;
}
