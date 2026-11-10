import { useCallback, useState } from "react";
import type { VoiceChatTurn } from "./voiceCompanionTypes";

/** Enough recent lines for a glance back; older turns stay in the transcript history. */
export const VOICE_CHAT_LIMIT = 16;
let sequence = 0;

/**
 * Adds one line to the chat. A reply that is still growing (streamed text) updates its own
 * bubble instead of adding a new one, and a repeat of the last line is ignored. A `fresh`
 * line is a new utterance and always gets its own bubble, whatever its words.
 */
export function appendVoiceChatTurn(
  turns: readonly VoiceChatTurn[],
  role: VoiceChatTurn["role"],
  text: string,
  fresh = false,
): VoiceChatTurn[] {
  const clean = text.trim();
  if (!clean) return [...turns];
  const last = turns[turns.length - 1];
  if (!fresh && last?.role === role) {
    if (last.text === clean) return [...turns];
    if (clean.startsWith(last.text) || last.text.startsWith(clean))
      return [...turns.slice(0, -1), { ...last, text: clean }];
  }
  return [...turns, { id: ++sequence, role, text: clean }].slice(-VOICE_CHAT_LIMIT);
}

type ChatInput = { transcript: string; message: string; visible: boolean; ownerTurn: number };

/** The chat lines after one change of the live inputs. `ownerTurn` advances with every
 * accepted owner utterance, so the same words spoken again are a new line. */
export function nextVoiceChatTurns(
  turns: readonly VoiceChatTurn[],
  seen: Partial<ChatInput>,
  now: ChatInput,
): VoiceChatTurn[] {
  if (!now.visible) return [];
  const shown = seen.visible !== now.visible;
  const spoke = seen.ownerTurn !== now.ownerTurn;
  let next = [...turns];
  if (shown || spoke || seen.transcript !== now.transcript)
    next = appendVoiceChatTurn(next, "owner", now.transcript, spoke && !shown);
  if (shown || seen.message !== now.message)
    next = appendVoiceChatTurn(next, "assistant", now.message);
  return next;
}

/** The owner's latest line as state, with a counter that advances on every set: setting
 * the same text again must still reach the chat as a new utterance. */
export function useVoiceTranscript() {
  const [state, setState] = useState({ text: "", turn: 0 });
  const set = useCallback(
    (text: string) => setState((current) => ({ text, turn: current.turn + 1 })),
    [],
  );
  return [state.text, set, state.turn] as const;
}

/**
 * Chat bubbles from the live owner transcript and assistant reply. Lines are kept only while
 * the body is visible: a lock, a scope change or a hidden history binding clears them.
 */
export function useVoiceChatTurns(
  transcript: string,
  message: string,
  visible: boolean,
  ownerTurn: number,
): VoiceChatTurn[] {
  const [turns, setTurns] = useState<VoiceChatTurn[]>([]);
  // Adjusted during render: each input change maps to one update of the lines.
  const [seen, setSeen] = useState<Partial<ChatInput>>({});
  if (
    seen.transcript !== transcript ||
    seen.message !== message ||
    seen.visible !== visible ||
    seen.ownerTurn !== ownerTurn
  ) {
    const now = { transcript, message, visible, ownerTurn };
    setSeen(now);
    setTurns(nextVoiceChatTurns(turns, seen, now));
  }
  return turns;
}
