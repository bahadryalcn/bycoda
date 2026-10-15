/**
 * Slows down guessing. Every wrong password costs a short pause; after
 * `FREE_ATTEMPTS` in a row each further one doubles a cool-down during which
 * no password is even checked. State is stored, so reopening the dialog or the
 * app does not reset it. A correct password does.
 */
export const WRONG_PASSWORD_DELAY_MS = 800;
export const FREE_ATTEMPTS = 5;
const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 15 * 60_000;

export type AttemptState = {
  /** Wrong passwords since the last correct one. */
  failures: number;
  /** Epoch ms before which no attempt is accepted. */
  blockedUntil: number;
};

export const NO_ATTEMPTS: AttemptState = { failures: 0, blockedUntil: 0 };

/** Cool-down after the n-th wrong password in a row. */
export function cooldownMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS;
  // Past the cap the exponent only risks overflowing to Infinity.
  if (doublings >= 10) return COOLDOWN_MAX_MS;
  return Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** doublings);
}

export function recordFailure(state: AttemptState, now: number): AttemptState {
  const failures = state.failures + 1;
  const cooldown = cooldownMs(failures);
  return {
    failures,
    blockedUntil: cooldown > 0 ? now + cooldown : state.blockedUntil,
  };
}

/** Milliseconds until the next attempt is accepted; 0 when one is. */
export function blockedForMs(state: AttemptState, now: number): number {
  return Math.max(0, state.blockedUntil - now);
}

export function parseAttemptState(value: unknown): AttemptState {
  if (!value || typeof value !== "object") return NO_ATTEMPTS;
  const raw = value as Partial<AttemptState>;
  const failures =
    typeof raw.failures === "number" && Number.isInteger(raw.failures) && raw.failures > 0
      ? Math.min(raw.failures, 1000)
      : 0;
  const blockedUntil =
    typeof raw.blockedUntil === "number" && Number.isFinite(raw.blockedUntil)
      ? raw.blockedUntil
      : 0;
  return { failures, blockedUntil };
}

export function formatCooldown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
