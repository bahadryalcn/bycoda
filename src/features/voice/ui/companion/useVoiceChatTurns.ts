import { useEffect, useState } from "react";
import type { VoiceChatTurn } from "./voiceCompanionTypes";

/** Enough recent lines for a glance back; older turns stay in the transcript history. */
export const VOICE_CHAT_LIMIT = 16;
let sequence = 0;

/**
 * Adds one line to the chat. A reply that is still growing (streamed text) updates its own
 * bubble instead of adding a new one, and a repeat of the last line is ignored.
 */
export function appendVoiceChatTurn(
  turns: readonly VoiceChatTurn[],
  role: VoiceChatTurn["role"],
  text: string,
): VoiceChatTurn[] {
  const clean = text.trim();
  if (!clean) return [...turns];
  const last = turns[turns.length - 1];
  if (last?.role === role) {
    if (last.text === clean) return [...turns];
    if (clean.startsWith(last.text) || last.text.startsWith(clean))
      return [...turns.slice(0, -1), { ...last, text: clean }];
  }
  return [...turns, { id: ++sequence, role, text: clean }].slice(-VOICE_CHAT_LIMIT);
}

/**
 * Chat bubbles from the live owner transcript and assistant reply. Lines are kept only while
 * the body is visible: a lock, a scope change or a hidden history binding clears them.
 */
export function useVoiceChatTurns(
  transcript: string,
  message: string,
  visible: boolean,
): VoiceChatTurn[] {
  const [turns, setTurns] = useState<VoiceChatTurn[]>([]);
  useEffect(() => {
    if (!visible) setTurns([]);
  }, [visible]);
  useEffect(() => {
    if (visible) setTurns((current) => appendVoiceChatTurn(current, "owner", transcript));
  }, [transcript, visible]);
  useEffect(() => {
    if (visible) setTurns((current) => appendVoiceChatTurn(current, "assistant", message));
  }, [message, visible]);
  return turns;
}
