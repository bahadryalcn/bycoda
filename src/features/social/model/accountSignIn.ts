import type { SocialAccount } from "./social";

/**
 * API accounts are renewed by the Host's due-refresh sweep (it renews when `expiresAt <= now + 60s`);
 * only an expiry this old means the renewal had its chance and failed.
 */
export const API_SIGN_IN_GRACE_MS = 15 * 60_000;

/**
 * The Host sets `expiresAt = now` when a poll or send fails with an expired session. A connected,
 * unpaused account whose expiry has passed needs the owner to sign in again. Browser accounts have
 * no refresh sweep, so the expiry counts at once.
 */
export function accountNeedsSignIn(
  account: Pick<SocialAccount, "connected" | "paused" | "expiresAt" | "connection">,
  now: number,
): boolean {
  if (!account.connected || account.paused || account.expiresAt === undefined) return false;
  const grace = account.connection === "browser" ? 0 : API_SIGN_IN_GRACE_MS;
  return account.expiresAt <= now - grace;
}
