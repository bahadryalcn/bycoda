import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import { notifyAssistant } from "../../notifications";
import { previewBriefing } from "../model/voiceBriefingPlayback";
import type { VoicePresence } from "../model/voicePresence";
import {
  VoiceReturnCall,
  mayCallOnReturn,
  voiceReturnCallWindowMs,
} from "../model/voiceReturnCall";
import { loadVoiceSettings, type VoiceSettings } from "../model/voiceSettings";

type Input = {
  settings: VoiceSettings;
  snapshot: AssistantSnapshot | null;
  capturePresence: VoicePresence;
  status: string;
  muted: boolean;
  speakerMuted: boolean;
  /** Voice has a conversation target. */
  available: boolean;
  lastAdmittedSpeechAt: number | null;
  /** True while the pending return briefing is playing; it replaces the greeting. */
  briefingDelivering: () => boolean;
  start: () => Promise<void>;
  /** Close capture back to Ready with the microphone off. */
  stopToReady: () => void;
  setPlayback: (active: boolean) => void;
};

function waitFor(done: () => boolean, signal: AbortSignal, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (done() || signal.aborted || Date.now() - started > maxMs) {
        clearInterval(timer);
        resolve();
      }
    }, 150);
  });
}

/** Opt-in "Call me when I return": see `VoiceReturnCall`. Returns the missed-call notice. */
export function useVoiceReturnCall(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const previous = useRef(input.capturePresence);
  const ownOpen = useRef(false);
  const call = useRef<VoiceReturnCall | null>(null);
  if (!call.current)
    call.current = new VoiceReturnCall(
      {
        eligible: () => {
          const now = latest.current;
          return mayCallOnReturn({
            enabled: now.settings.returnCall === true,
            available: now.available,
            profile: now.snapshot?.profile ?? null,
            presence: now.capturePresence,
            manualPresence: now.snapshot?.presence?.state,
            status: now.status,
            muted: now.muted,
            speakerMuted: now.speakerMuted,
            hour: new Date().getHours(),
          });
        },
        greet: async (signal) => {
          const now = latest.current;
          if (now.briefingDelivering())
            return waitFor(() => !latest.current.briefingDelivering(), signal, 120_000);
          const profile = now.snapshot?.profile;
          if (!profile) return;
          await previewBriefing(
            loadVoiceSettings(),
            profile.language,
            profile.name,
            signal,
            () => undefined,
            t("Welcome back."),
            now.setPlayback,
            { complete: true, languageHint: now.snapshot?.lastSpokenLanguage ?? undefined },
          );
        },
        open: async (signal) => {
          ownOpen.current = true;
          await latest.current.start();
          // A render may lag the awaited start, so wait for a settled state, not for "not connecting".
          await waitFor(
            () => ["live", "idle", "sleeping"].includes(latest.current.status),
            signal,
            30_000,
          );
          return latest.current.status === "live" && !signal.aborted;
        },
        close: () => latest.current.stopToReady(),
        missed: () => {
          const text = t("I called you but you didn't answer.");
          setNotice(text);
          void notifyAssistant({
            title: latest.current.snapshot?.profile.name || t("Voice"),
            body: text,
            kind: "input",
            occurredAt: Date.now(),
          }).catch(() => undefined);
        },
      },
      () => voiceReturnCallWindowMs(latest.current.settings.returnCallSeconds),
    );
  useEffect(() => {
    const before = previous.current;
    previous.current = input.capturePresence;
    if ((before === "idle" || before === "away") && input.capturePresence === "active")
      setPending(true);
  }, [input.capturePresence]);
  useEffect(() => {
    if (!pending || input.status === "sleeping") return;
    setPending(false);
    if (input.status !== "ready") return;
    ownOpen.current = false;
    void call.current!.begin();
  }, [pending, input.status]);
  useEffect(() => {
    const busy = call.current!.busy;
    // Disconnect, or a manual Talk while the greeting plays, ends the call.
    if (busy && (input.status === "idle" || (input.status !== "ready" && !ownOpen.current)))
      call.current!.cancel();
    if (input.status === "connecting" || input.status === "live") setNotice("");
  }, [input.status]);
  useEffect(() => {
    if (input.lastAdmittedSpeechAt !== null) call.current!.answered();
  }, [input.lastAdmittedSpeechAt]);
  useEffect(() => {
    const active = call.current!;
    return () => active.cancel();
  }, []);
  return {
    notice,
    talkNow: () => {
      setNotice("");
      void latest.current.start();
    },
  };
}
