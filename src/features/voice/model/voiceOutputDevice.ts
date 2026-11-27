import { loadVoiceSettings, subscribeVoiceSettings } from "./voiceSettings";

type SinkContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

/**
 * Plays an output context on the saved audio output device and follows later changes until the
 * context closes. Without `setSinkId` support, or when the device is gone, playback stays on the
 * system default instead of failing the conversation.
 */
export function routeVoiceOutput(context: AudioContext): void {
  const sink = context as SinkContext;
  if (typeof sink.setSinkId !== "function") return;
  let applied: string | undefined;
  const apply = () => {
    if (context.state === "closed") return;
    const next = loadVoiceSettings().speakerOutputId ?? "";
    if (next === applied) return;
    applied = next;
    sink.setSinkId!(next).catch(() => {
      // A removed or blocked device falls back to the default; a later change retries.
      applied = undefined;
      if (next && context.state !== "closed") sink.setSinkId!("").catch(() => undefined);
    });
  };
  apply();
  const unsubscribe = subscribeVoiceSettings(apply);
  context.addEventListener("statechange", () => {
    if (context.state === "closed") unsubscribe();
  });
}
