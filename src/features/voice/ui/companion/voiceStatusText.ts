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
        return waitingOwner === "question"
          ? t("Waiting for your answer")
          : t("Waiting for your approval");
      if (tool)
        return tool.target
          ? t("Working: {p0} · {p1}", { p0: tool.name, p1: tool.target })
          : t("Working: {p0}", { p0: tool.name });
      return t("Preparing a reply…");
    }
    if (muted) return t("Connected · Microphone off");
    if (phase === "speaking") return t("Receiving speech…");
    return hearingInput ? t("Microphone is receiving sound") : t("Listening");
  }
  if (status === "reconnecting") return t("Reconnecting…");
  if (status === "sleeping") return t("Asleep");
  if (status === "ready") return t("Ready. Microphone is off.");
  if (status === "connecting")
    return realtime ? t("Connecting voice…") : t("Preparing local voice…");
  return t("Ready to connect");
}
