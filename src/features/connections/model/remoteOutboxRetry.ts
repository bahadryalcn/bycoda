import { requestIssuedAt } from "../../../shared/lib/id/requestId";
import { t } from "../../../shared/i18n/core";
import { OutboxConflictError } from "./remoteOutboxDatabase";

/**
 * The Host refuses a request id older than its 30-day replay horizon, and deletes that
 * fence a day later. A request this old is never retried automatically: its outcome is
 * unknown until the Host confirms it, and only an explicit check may send it again.
 */
export const REMOTE_REQUEST_RETRY_LIMIT_MS = 29 * 24 * 60 * 60 * 1000;

/** Legacy UUIDv4 ids carry no issue time, so they keep their existing retry behaviour. */
export function remoteRequestPastRetryLimit(requestId: string, now = Date.now()): boolean {
  const issuedAt = requestIssuedAt(requestId);
  return issuedAt !== undefined && now - issuedAt > REMOTE_REQUEST_RETRY_LIMIT_MS;
}

export function remoteOutcomeUnknownMessage(): string {
  return t(
    "This request is older than 29 days, so it will not be sent automatically. Its outcome is unknown: check the conversation before sending it again.",
  );
}

/** Injected for tests, like `now` elsewhere in this file. Defaults use the real clock. */
export type OutboxRetry = {
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
};
const OUTBOX_RETRY_ATTEMPTS = 5;
const OUTBOX_RETRY_BASE_MS = 20;
const OUTBOX_RETRY_MAX_MS = 320;

/**
 * Re-run a whole read-then-write operation when another writer changed the outbox between
 * its reads and its compare-and-set. Each attempt re-derives every decision from fresh
 * state, so a real change to the same request still fails with its own plain error, and a
 * write is only committed by a compare-and-set that matched the bytes it was derived from.
 */
export async function retryOutboxConflict<T>(
  operation: () => Promise<T>,
  retry: OutboxRetry = {},
): Promise<T> {
  const wait =
    retry.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = retry.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof OutboxConflictError) || attempt >= OUTBOX_RETRY_ATTEMPTS) throw error;
      const cap = Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** (attempt - 1));
      await wait(cap / 2 + random() * (cap / 2));
    }
  }
}
