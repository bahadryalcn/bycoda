/** Pictures queued in the decoder beyond which the stream is waiting on it (about 0.3 s of video). */
export const DECODE_QUEUE_LIMIT = 8;
/** How long a full decode queue may stay full before its backlog is discarded. */
export const DECODE_STALL_MS = 250;
export const DECODE_POLL_MS = 8;
/** Waits before each retry of a failed stream; its length is the retry cap. */
export const STREAM_RETRY_DELAYS_MS = [500, 1000, 2000] as const;
/** Video that ran this long without a failure earns the full retry budget back. */
export const STREAM_HEALTHY_MS = 10_000;

/**
 * Failures a retry cannot fix: the Host cannot stream this device, the device is not ready or
 * gone, the owner's or the Host's authorization changed, or the Host does not speak this
 * command. They end live view at once so the caller shows still captures. Everything else
 * (a dropped connection, a timeout, a busy Host, a decoder fault) is retried a few times.
 */
const FATAL =
  /DEVICE_(?:STREAM_UNSUPPORTED|AUTHORITY_REVOKED|NOT_FOUND|OFFLINE|SETUP_REQUIRED|SDK_MISSING)|Boot the device before viewing|Device host is disposed|\[RPC_AUTHORIZATION\]|Host identity changed|RPC_WS_(?:IDENTITY|UNSUPPORTED|DISABLED|SCHEMA|BLOCKED)|Unsupported (?:host method|remote operation)|Update bycoda Host|Machine connection is disabled/i;

export function isFatalStreamFailure(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const text = error instanceof Error ? error.message : String(error);
  return FATAL.test(`${code} ${text}`);
}
