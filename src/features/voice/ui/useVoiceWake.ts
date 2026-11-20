import { useEffect, useState, useSyncExternalStore } from "react";
import { getLocale } from "../../../shared/i18n";
import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
import { localVoiceBackend } from "../model/localVoiceClient";
import { useActiveDictations } from "../model/dictationActivity";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../model/voiceActivity";
import { voiceLanguageCode } from "../model/voiceLanguage";
import { useVoicePresence } from "../model/voicePresence";
import { voiceRuntimeSettings, type VoiceSettings } from "../model/voiceSettings";
import { saveVoiceSettingsPatch } from "../model/voiceSettingsSave";
import { localWakeDeps } from "../model/voiceWakeAdapters";
import { WakeListener } from "../model/voiceWakeListener";
import { resolveWakePhrases } from "../model/voiceWakePhrase";
import { VOICE_WAKE_EVENT } from "./useVoiceTalkEvent";
import { MicrophoneBusyError, onForegroundMicrophone } from "../model/microphoneOwnership";

type WakeIndicatorState =
  | { kind: "listening"; phrase: string }
  | { kind: "paused" }
  | { kind: "pack" }
  | { kind: "error" };

/** Missing pieces that stop local recognition; natural speech is not needed to listen. */
export const wakeRecognitionMissing = (missing: string[]) =>
  missing.some((item) => item.startsWith("Python") || /whisper/i.test(item));

/** After a match, Talk gets this long to take over before listening may resume. */
const HANDOFF_MS = 15_000;
const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000] as const;

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
  const dictations = useActiveDictations();
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
  const armed =
    settings.wakeEnabled === true &&
    present &&
    !conversationActive &&
    !dictations.length &&
    !handoff;
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
    let attempt = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: WakeListener | undefined;
    let needsOwner = false;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(start, delay);
    };
    function start() {
      const current = ++attempt;
      const valid = () => !cancelled && attempt === current;
      const fail = (cause: unknown) => {
        if (!valid()) return;
        const busy = cause instanceof MicrophoneBusyError;
        needsOwner =
          cause instanceof Error &&
          ["NotAllowedError", "NotSupportedError", "OverconstrainedError"].includes(cause.name);
        setIndicator({ kind: busy ? "paused" : "error" });
        if (!needsOwner) schedule(RETRY_DELAYS[Math.min(failures++, RETRY_DELAYS.length - 1)]);
      };
      void localVoiceBackend
        .inspect(config)
        .then(async (status) => {
          if (!valid()) return;
          if (wakeRecognitionMissing(status.missing)) {
            needsOwner = true;
            setIndicator({ kind: "pack" });
            return;
          }
          listener = new WakeListener(
            localWakeDeps({ config, language, microphoneId: settings.microphoneId }),
            {
              phrase: wake,
              onMatch: () => {
                if (!valid()) return;
                setHandoff(true);
                window.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT));
              },
              onState: (state) => {
                if (!valid()) return;
                if (state === "listening") setIndicator({ kind: "listening", phrase: wake });
                else setIndicator(state === "paused" ? { kind: "paused" } : null);
              },
              onError: fail,
            },
          );
          await listener.start();
        })
        .catch(fail);
    }
    const releaseForForeground = onForegroundMicrophone(() => {
      if (cancelled || needsOwner) return;
      ++attempt;
      listener?.stop();
      listener = undefined;
      failures = 0;
      setIndicator({ kind: "paused" });
      schedule(RETRY_DELAYS[0]);
    });
    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      releaseForForeground();
      listener?.stop();
      setIndicator(null);
    };
  }, [armed, wake, language, configKey, settings.microphoneId]);
  return {
    enabled: settings.wakeEnabled === true,
    indicator: armed ? indicator : null,
    setEnabled: (wakeEnabled: boolean) => saveVoiceSettingsPatch({ wakeEnabled }),
  };
}
