import { t } from "../../../../shared/i18n";

/** The live status line for the companion. */
export function voiceStatusText(state: {
  status: "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready";
  muted: boolean;
  playback: boolean;
  phase: "listening" | "speaking" | "transcribing" | "replying";
  hearingInput: boolean;
  realtime: boolean;
  /** The app is waiting for the owner, not preparing a reply. */
  waitingOwner?: "question" | "review";
  /** A tool is running; `target` is its short, owner-readable subject. */
  tool?: { name: string; target?: string };
}) {
  const { status, muted, playback, phase, hearingInput, realtime, waitingOwner, tool } = state;
  if (status === "live") {
    if (playback) return t("Assistant speaking");
    if (phase === "transcribing") return t("Transcribing locally…");
    if (phase === "replying") {
      if (waitingOwner)
        return t(
          waitingOwner === "question" ? "Waiting for your answer" : "Waiting for your approval",
        );
      if (tool)
        return tool.target
          ? t("Working: {p0} · {p1}", { p0: tool.name, p1: tool.target })
          : t("Working: {p0}", { p0: tool.name });
      return t("Preparing a reply…");
    }
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
