import { hostToolRequest } from "../../connections/model/hostFeatureClient";

/** `xai`: Grok Voice through the Grok Build login; `openai`: OpenAI Realtime through the Codex login. */
export type RealtimeProvider = "xai" | "openai";
/** A 60-second credential for the provider's realtime WebSocket at `url`. */
export type RealtimeSecret = { value: string; expires_at: number; model: string; url: string };

/** Minted on this computer's Host; the long-lived login never reaches the app. */
export function realtimeSecret(provider: RealtimeProvider) {
  return hostToolRequest<RealtimeSecret>(
    "",
    "voice.realtime.v2",
    "voice.realtime.secret",
    { provider },
    { kind: "local" },
  );
}
