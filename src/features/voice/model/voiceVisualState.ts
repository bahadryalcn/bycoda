export type VoiceVisualState =
  | "off"
  | "connecting"
  | "listening"
  | "user"
  | "thinking"
  | "assistant"
  | "connected"
  | "muted"
  | "error";

/** Live output and pending replies take priority over the microphone state. */
export function voiceVisualState(value: {
  status: "idle" | "connecting" | "live" | "reconnecting" | "sleeping" | "ready";
  phase: "listening" | "speaking" | "transcribing" | "replying";
  muted: boolean;
  playback: boolean;
  error: string;
}): VoiceVisualState {
  if (value.error) return "error";
  if (value.status === "idle") return "off";
  if (value.status === "connecting" || value.status === "reconnecting") return "connecting";
  if (value.status === "sleeping" || value.status === "ready") return "muted";
  if (value.playback) return "assistant";
  if (value.phase === "transcribing" || value.phase === "replying") return "thinking";
  if (value.muted) return "connected";
  if (value.phase === "speaking") return "user";
  return "listening";
}
