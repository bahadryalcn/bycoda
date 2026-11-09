/** Expo's push service relays to APNs and FCM; it needs no account key for sending. */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;
const DEADLINE_MS = 15_000;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  channelId: "bycoda";
  priority: "high";
};

export type ExpoPushResult = {
  /** Tokens Expo reports as no longer registered: the app was removed or the token rotated. */
  unregistered: string[];
  /** Messages Expo did not accept for another reason. */
  failed: number;
};

type Ticket = { status?: unknown; details?: { error?: unknown } };

/** Sends in batches of 100 with a deadline per request. Throws when a batch is not accepted. */
export async function sendExpoPush(
  messages: readonly ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoPushResult> {
  const result: ExpoPushResult = { unregistered: [], failed: 0 };
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    const response = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (!response.ok) throw new Error(`Expo push rejected the request (${response.status})`);
    const payload = (await response.json()) as { data?: unknown };
    const tickets = Array.isArray(payload.data) ? (payload.data as Ticket[]) : [];
    batch.forEach((message, index) => {
      const ticket = tickets[index];
      if (ticket?.status === "ok") return;
      if (ticket?.details?.error === "DeviceNotRegistered") result.unregistered.push(message.to);
      else result.failed++;
    });
  }
  return result;
}
