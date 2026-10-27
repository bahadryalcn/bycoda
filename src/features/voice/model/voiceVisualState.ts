export type VoiceVisualState =
  | "off"
  | "connecting"
  | "listening"
  | "user"
  | "thinking"
  | "assistant"
  | "muted"
  | "error";

/** Error and microphone pause remain visible even during reply playback. */
export function voiceVisualState(value: {
  status: "idle" | "connecting" | "live";
  phase: "listening" | "speaking" | "transcribing" | "replying";
  muted: boolean;
  playback: boolean;
  error: string;
}): VoiceVisualState {
  if (value.error) return "error";
  if (value.status === "idle") return "off";
  if (value.status === "connecting") return "connecting";
  if (value.muted) return "muted";
  if (value.playback) return "assistant";
  if (value.phase === "speaking") return "user";
  if (value.phase === "transcribing" || value.phase === "replying") return "thinking";
  return "listening";
}
