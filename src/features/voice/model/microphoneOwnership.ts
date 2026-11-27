const CHANNEL = "bycoda-microphone";
const listeners = new Set<() => void>();
let fallbackHeld = false;

export class MicrophoneBusyError extends Error {}

/** A foreground request asks wake listeners in every window to release their capture. */
export function onForegroundMicrophone(listener: () => void): () => void {
  listeners.add(listener);
  const channel =
    typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL);
  if (channel) channel.onmessage = listener;
  return () => {
    listeners.delete(listener);
    channel?.close();
  };
}

export function claimMicrophone(
  wake: boolean,
  signal?: AbortSignal,
): (() => void) | Promise<() => void> {
  signal?.throwIfAborted();
  if (!wake) {
    for (const notify of listeners) notify();
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage("foreground");
      channel.close();
    }
  }
  if (!navigator.locks) {
    if (fallbackHeld) throw new MicrophoneBusyError();
    fallbackHeld = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      fallbackHeld = false;
    };
  }
  // Wake never queues ahead of explicit Talk or dictation. Foreground requests
  // give another window time to release wake capture, then fail if still busy.
  return new Promise((resolve, reject) => {
    const wait = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(2_000)])
      : AbortSignal.timeout(2_000);
    void navigator.locks
      .request(CHANNEL, wake ? { ifAvailable: true } : { signal: wait }, (lock) => {
        if (!lock) throw new MicrophoneBusyError();
        signal?.throwIfAborted();
        return new Promise<void>((release) => resolve(release));
      })
      .catch((error: unknown) =>
        reject(wait.aborted && !signal?.aborted ? new MicrophoneBusyError() : error),
      );
  });
}
