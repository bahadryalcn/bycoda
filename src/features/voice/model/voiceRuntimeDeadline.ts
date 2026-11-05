/** Bound the wait, not the effect. Expiry never proves cancellation or permits replay. */
export const VOICE_TOOL_TIMEOUT_MS = 35_000;
export type VoiceToolWait = { waitForOwner(): void };
export const voiceToolWaitsForOwner = (name: string) =>
  name === "present_choices" || name === "give_jobs";

export function voiceRuntimeDeadline<T>(
  operation: (wait: VoiceToolWait) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = VOICE_TOOL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      complete();
    };
    const abort = () =>
      finish(() => reject(signal.reason ?? new Error("Voice operation cancelled.")));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              "Voice operation timed out. Its outcome is unknown; read its status before retrying.",
            ),
          ),
        ),
      timeoutMs,
    );
    try {
      signal.throwIfAborted();
      Promise.resolve(
        operation({
          // Only trusted UI code calls this after showing its explicit owner prompt.
          // The prompt owns its timeout; connection close/cancellation still ends this wait.
          waitForOwner: () => {
            if (!settled && timer !== undefined) clearTimeout(timer);
            timer = undefined;
          },
        }),
      ).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
