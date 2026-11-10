import { useEffect, useState, useSyncExternalStore } from "react";
import { getLocale } from "../../../shared/i18n";
import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
import { localVoiceBackend } from "../model/localVoiceClient";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../model/voiceActivity";
import { voiceLanguageCode } from "../model/voiceLanguage";
import { useVoicePresence } from "../model/voicePresence";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  voiceRuntimeSettings,
  type VoiceSettings,
} from "../model/voiceSettings";
import { localWakeDeps } from "../model/voiceWakeAdapters";
import { WakeListener } from "../model/voiceWakeListener";
import { resolveWakePhrases } from "../model/voiceWakePhrase";
import type { WakeIndicatorState } from "./VoiceWakeIndicator";
import { VOICE_WAKE_EVENT } from "./useVoiceTalkEvent";

/** Missing pieces that stop local recognition; natural speech is not needed to listen. */
export const wakeRecognitionMissing = (missing: string[]) =>
  missing.some((item) => item.startsWith("Python") || /whisper/i.test(item));

/** After a match, Talk gets this long to take over before listening may resume. */
const HANDOFF_MS = 15_000;

type Input = {
  settings: VoiceSettings;
  profile: Pick<AssistantProfile, "name" | "language">;
  /** Owner's manual presence (Away or Do not disturb) from the Assistant snapshot. */
  manualPresence?: string;
};

/**
 * Opt-in wake phrase. Listens (local recognition, nothing sent off this computer) only while no
 * conversation is live, the desktop is unlocked and the owner is not away or on Do not disturb.
 * A match asks Talk to start exactly like its button; the listener has released the microphone first.
 */
export function useVoiceWake({ settings, profile, manualPresence }: Input) {
  const conversationActive = useSyncExternalStore(
    subscribeVoiceConversationActivity,
    isVoiceConversationActive,
  );
  const presence = useVoicePresence(settings.wakeEnabled === true, settings.idleSleepMinutes);
  const [handoff, setHandoff] = useState(false);
  const [indicator, setIndicator] = useState<WakeIndicatorState | null>(null);
  const locale = getLocale();
  const { wake } = resolveWakePhrases(settings, profile.language, locale, profile.name);
  const present =
    (presence === "active" || presence === "idle") &&
    manualPresence !== "away" &&
    manualPresence !== "dnd";
  const armed = settings.wakeEnabled === true && present && !conversationActive && !handoff;
  const language = voiceLanguageCode(profile.language) ?? locale.split("-")[0];
  const configValue = voiceRuntimeSettings({ ...settings, natural: false });
  const configKey = JSON.stringify(configValue);
  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => setHandoff(false), HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [handoff]);
  useEffect(() => {
    if (!armed) return;
    const config: typeof configValue = JSON.parse(configKey);
    let cancelled = false;
    let listener: WakeListener | undefined;
    const fail = () => !cancelled && setIndicator({ kind: "error" });
    void localVoiceBackend
      .inspect(config)
      .then(async (status) => {
        if (cancelled) return;
        if (wakeRecognitionMissing(status.missing)) return setIndicator({ kind: "pack" });
        listener = new WakeListener(
          localWakeDeps({ config, language, microphoneId: settings.microphoneId }),
          {
            phrase: wake,
            onMatch: () => {
              setHandoff(true);
              window.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT));
            },
            onState: (state) => {
              if (cancelled) return;
              if (state === "listening") setIndicator({ kind: "listening", phrase: wake });
              else setIndicator(state === "paused" ? { kind: "paused" } : null);
            },
            onError: fail,
          },
        );
        await listener.start();
      })
      .catch(fail);
    return () => {
      cancelled = true;
      listener?.stop();
      setIndicator(null);
    };
  }, [armed, wake, language, configKey, settings.microphoneId]);
  return {
    indicator: armed ? indicator : null,
    turnOff: () => saveVoiceSettings({ ...loadVoiceSettings(), wakeEnabled: false }),
  };
}
