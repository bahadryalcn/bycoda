import { t } from "../../../../shared/i18n";

/** The live status line for the companion. */
export function voiceStatusText(state: {
  status: "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready";
  muted: boolean;
  playback: boolean;
  phase: "listening" | "speaking" | "transcribing" | "replying";
  hearingInput: boolean;
  realtime: boolean;
}) {
  const { status, muted, playback, phase, hearingInput, realtime } = state;
  return t(
    status === "live"
      ? muted
        ? "Microphone paused"
        : playback
          ? "Assistant speaking"
          : phase === "transcribing"
            ? "Transcribing locally..."
            : phase === "replying"
              ? "Preparing a reply..."
              : phase === "speaking"
                ? "Receiving speech..."
                : hearingInput
                  ? "Microphone is receiving sound"
                  : "Listening"
      : status === "reconnecting"
        ? "Reconnecting..."
        : status === "sleeping"
          ? "Asleep"
          : status === "ready"
            ? "Ready. Microphone is off."
            : status === "connecting"
              ? realtime
                ? "Connecting voice..."
                : "Preparing local voice..."
              : "Ready to connect",
  );
}
