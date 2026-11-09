/** Live states the companion surfaces show; the model owns transitions. */
export type VoiceCompanionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "sleeping"
  | "ready";

/** One chat bubble: what the owner said, or what the assistant answered. */
export type VoiceChatTurn = { id: number; role: "owner" | "assistant"; text: string };
