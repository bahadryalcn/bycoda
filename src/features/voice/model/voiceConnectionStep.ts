import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

/** Budgets for the connecting phase. Host round trips were observed answering 15-30 s late in bursts. */
export const VOICE_HOST_STEP_MS = 25_000;
/** Longer than the OS microphone permission prompt a person may still be reading. */
export const VOICE_MICROPHONE_STEP_MS = 60_000;
export const VOICE_AUDIO_STEP_MS = 12_000;

/**
 * Bounds one step of the connecting phase. On expiry it logs the step, provider and elapsed
 * milliseconds at WARN level (the persisted app log; never any private text) and rejects with
 * the already translated `message`, so the status never stays on "connecting" silently.
 * The stalled work keeps running; its late result is ignored.
 */
export async function voiceConnectionStep<T>(
  step: string,
  provider: string,
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  const startedAt = monotonicNow();
  try {
    return await withTimeout(work, ms, step);
  } catch (cause) {
    if (cause instanceof TimeoutError)
      console.warn("[voice.connection]", provider, {
        kind: "step-timeout",
        step,
        elapsedMs: elapsedSince(startedAt),
      });
    throw cause instanceof TimeoutError ? new Error(message) : cause;
  }
}
