import type { SocialJob } from "../src/features/social/model/social";

export type WhatsAppReceipt = {
  platformId: string;
  recipient: string;
  delivery: NonNullable<SocialJob["delivery"]>;
};

/** Called only after the raw webhook signature and connected phone identity have been verified. */
export function whatsappReceipt(input: unknown, now: number): WhatsAppReceipt | undefined {
  if (!input || typeof input !== "object") return;
  const value = input as Record<string, any>;
  const at = Number(value.timestamp) * 1000;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 300 ||
    typeof value.recipient_id !== "string" ||
    !/^\d{5,20}$/.test(value.recipient_id) ||
    !["sent", "delivered", "read", "failed"].includes(value.status) ||
    !Number.isSafeInteger(at) ||
    at <= 0 ||
    at > now + 60_000
  )
    return;
  const code =
    value.status === "failed" && Number.isSafeInteger(value.errors?.[0]?.code)
      ? value.errors[0].code
      : undefined;
  return {
    platformId: value.id,
    recipient: value.recipient_id,
    delivery: { status: value.status, at, ...(code !== undefined ? { code } : {}) },
  };
}

export function mergeDelivery(
  previous: SocialJob["delivery"],
  next: NonNullable<SocialJob["delivery"]>,
): NonNullable<SocialJob["delivery"]> {
  if (!previous) return next;
  const rank = { accepted: 0, sent: 1, failed: 1, delivered: 2, read: 3 };
  if (
    rank[next.status] < rank[previous.status] ||
    (rank[next.status] === rank[previous.status] && next.at <= previous.at)
  )
    return previous;
  return { ...next, at: Math.max(previous.at, next.at) };
}
