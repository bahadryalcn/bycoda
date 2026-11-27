/** Expo's push service relays to APNs and FCM; it needs no account key for sending. */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;
const DEADLINE_MS = 15_000;

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data: Record<string, string>;
  sound?: "default";
  channelId?: "bycoda";
  /** "normal" lets Android Doze batch a data-only message and maps to apns-priority 5 on iOS. */
  priority: "high" | "normal";
  _contentAvailable?: boolean;
  collapseId?: string;
  ttl?: number;
};

export type ExpoPushResult = {
  /** Tokens Expo reports as no longer registered: the app was removed or the token rotated. */
  unregistered: string[];
  /** Messages Expo did not accept for another reason. */
  failed: number;
  /**
   * Messages Expo explicitly refused before processing (request or message throttled) and batches that
   * were never sent. Messages with an unknown outcome (network error, deadline, 5xx, unreadable reply)
   * are never listed: Expo may have accepted them, so a retry could repeat a delivered push.
   * Absent means nothing to retry.
   */
  retry?: ExpoPushMessage[];
};

/**
 * A batch was not accepted. `partial` keeps what earlier batches already reported. `unreachable` marks a
 * transport outage (network, deadline, 5xx, throttle, unreadable reply) rather than a request Expo called
 * invalid, so the push service backs off before it sends again.
 */
export class ExpoPushError extends Error {
  constructor(
    message: string,
    readonly partial: ExpoPushResult,
    readonly unreachable = false,
  ) {
    super(message);
    this.name = "ExpoPushError";
  }
}

type Ticket = { status?: unknown; details?: { error?: unknown } };

/**
 * Only an explicit throttle proves Expo refused the request before processing it. A 5xx does not:
 * Expo documents no guarantee that a failing request delivered nothing, so it stays unknown.
 */
const definitelyRefusedStatus = (status: number): boolean => status === 429;

/**
 * Sends in batches of 100 with a deadline per request. Throws an ExpoPushError when a batch is not
 * accepted: its `partial` result lists the batches already accepted and, in `retry`, only the messages
 * that are safe to send again (an explicitly throttled batch and the batches never sent). A batch with an
 * unknown outcome is not in `retry`.
 */
export async function sendExpoPush(
  messages: readonly ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoPushResult> {
  const result: ExpoPushResult = { unregistered: [], failed: 0 };
  const retry: ExpoPushMessage[] = [];
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    let reason: string | undefined;
    let refused = false;
    let unreachable = false;
    let tickets: Ticket[] = [];
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      if (!response.ok) {
        reason = `Expo push rejected the request (${response.status})`;
        refused = definitelyRefusedStatus(response.status);
        // A throttle or server error means Expo cannot take traffic now; other 4xx mean our request is invalid.
        unreachable = response.status === 429 || response.status >= 500;
      } else {
        try {
          const payload = (await response.json()) as { data?: unknown };
          if (Array.isArray(payload.data)) tickets = payload.data as Ticket[];
        } catch {
          // Accepted but unreadable: the outcome is unknown, so it is not retried.
          reason = "Expo push returned an unreadable response";
          unreachable = true;
        }
      }
    } catch (error) {
      // Network failure or deadline: the request may have reached Expo and been accepted, so unknown.
      reason = error instanceof Error ? error.message : String(error);
      unreachable = true;
    }
    if (reason !== undefined) {
      // Later batches were never sent; they are still owed. This batch only if Expo refused it outright.
      retry.push(...(refused ? batch : []), ...messages.slice(start + BATCH));
      throw new ExpoPushError(reason, { ...result, retry }, unreachable);
    }
    batch.forEach((message, index) => {
      const ticket = tickets[index];
      if (ticket?.status === "ok") return;
      const error = ticket?.details?.error;
      if (error === "DeviceNotRegistered") result.unregistered.push(message.to);
      else {
        result.failed++;
        if (error === "MessageRateExceeded") retry.push(message);
      }
    });
  }
  if (retry.length > 0) result.retry = retry;
  return result;
}
