/** Shared complete-utterance budget; startup waits have their own allowance. */
export function voicePlaybackTimeoutMs(text: string): number {
  return Math.min(600_000, Math.max(90_000, text.length * 180));
}
