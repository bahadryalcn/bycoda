/**
 * The run lease: which side may start a turn of one conversation right now.
 *
 * The home host arbitrates. A desktop takes the lease just before it starts a
 * turn and keeps it alive with its heartbeat; the host needs none for its own
 * turns (it runs one only while the conversation is running there). Whoever asks
 * while another side runs a turn is refused with `LEASE_HELD`. That refusal is a
 * wait, not a failure: nothing was sent, so callers queue the message and never
 * pause the queue or fork the conversation.
 */
export const RUN_LEASE_CAPABILITY = "sessions.runLease";
/**
 * A desktop lease ends this long after its last heartbeat. A busy window beats
 * every 1.5 s, but a hidden, throttled one only about once a minute; a lease
 * shorter than that gap would lapse while the window still writes, and the
 * other computer could start a second turn. So: the longest gap (60 s) plus a
 * margin. The price is that a crashed window holds its conversation for up to
 * this long, which callers see as a wait (`LEASE_HELD`), never as a failure.
 */
export const RUN_LEASE_TTL_MS = 90_000;

export const RUN_LEASE_HELD = "LEASE_HELD";
export const RUN_LEASE_LOST = "LEASE_LOST";

/** `holder` is `desktop:<instance>` (one per window) or `host`. `epoch` grows with every grant. */
export type RunLease = { holder: string; epoch: number; expiresAt: number };

/** Another side is running a turn of this conversation. Nothing was sent. */
export class LeaseHeldError extends Error {
  readonly code = RUN_LEASE_HELD;
  constructor(
    readonly holder: string,
    detail = "This session is running in bycoda on that computer. Wait for it to finish.",
  ) {
    super(`${RUN_LEASE_HELD}: ${detail}`);
    this.name = "LeaseHeldError";
  }
}

/** The lease moved on while its holder was away; the holder must re-read, not write. */
export class LeaseLostError extends Error {
  readonly code = RUN_LEASE_LOST;
  constructor(detail = "This conversation's run lease moved to another computer.") {
    super(`${RUN_LEASE_LOST}: ${detail}`);
    this.name = "LeaseLostError";
  }
}

const HELD = new RegExp(`(^|[^A-Z_])${RUN_LEASE_HELD}\\b`);

/** A refusal, however it arrived (an error object, or the host's text after the wire). */
export function isLeaseHeld(failure: unknown): boolean {
  const text =
    typeof failure === "string"
      ? failure
      : failure instanceof Error
        ? failure.message
        : failure === undefined || failure === null
          ? ""
          : String(failure);
  return HELD.test(text);
}

/** The refusal without its machine-readable prefix, for people. */
export function leaseHeldText(failure: unknown): string {
  const text = failure instanceof Error ? failure.message : String(failure ?? "");
  return text
    .replace(/^Error:\s*/, "")
    .replace(/^Host rejected request:\s*/i, "")
    .replace(new RegExp(`^${RUN_LEASE_HELD}:\\s*`), "")
    .trim();
}
