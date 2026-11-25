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
  if (status === "live") {
    if (playback) return t("Assistant speaking");
    if (phase === "transcribing") return t("Transcribing locally…");
    if (phase === "replying") return t("Preparing a reply…");
    if (muted) return t("Connected · Microphone off");
    if (phase === "speaking") return t("Receiving speech…");
    return t(hearingInput ? "Microphone is receiving sound" : "Listening");
  }
  return t(
    status === "reconnecting"
      ? "Reconnecting…"
      : status === "sleeping"
        ? "Asleep"
        : status === "ready"
          ? "Ready. Microphone is off."
          : status === "connecting"
            ? realtime
              ? "Connecting voice…"
              : "Preparing local voice…"
            : "Ready to connect",
  );
}
