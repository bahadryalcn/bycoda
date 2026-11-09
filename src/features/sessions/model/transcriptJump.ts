import { createStore } from "../../../shared/lib/store";

export type TranscriptJump = { blockId: string; query?: string; token: number };

const pending = new Map<string, TranscriptJump>();
const store = createStore();
let nextToken = 0;

export function requestTranscriptJump(sessionId: string, blockId: string, query?: string): void {
  pending.set(sessionId, { blockId, query, token: ++nextToken });
  store.notify();
}

export function peekTranscriptJump(sessionId: string): TranscriptJump | null {
  return pending.get(sessionId) ?? null;
}

export function clearTranscriptJump(sessionId: string, token: number): void {
  if (pending.get(sessionId)?.token !== token) return;
  pending.delete(sessionId);
  store.notify();
}

export function subscribeTranscriptJump(listener: () => void): () => void {
  return store.subscribe(listener);
}
