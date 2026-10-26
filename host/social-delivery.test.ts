import { expect, it } from "vitest";
import { mergeDelivery, whatsappReceipt } from "./social-delivery";
const now = 1_792_962_000_000;
it("accepts only bounded receipts with exact message and recipient identities, without provider error text", () => {
  expect(
    whatsappReceipt(
      {
        id: "wamid.1",
        recipient_id: "905551234567",
        status: "failed",
        timestamp: String(now / 1000),
        errors: [{ code: 131026, title: "Private provider detail", message: "Never store this" }],
      },
      now,
    ),
  ).toEqual({
    platformId: "wamid.1",
    recipient: "905551234567",
    delivery: { status: "failed", at: now, code: 131026 },
  });
  expect(
    whatsappReceipt(
      { id: "wamid.1", recipient_id: "invalid", status: "delivered", timestamp: now / 1000 },
      now,
    ),
  ).toBeUndefined();
  expect(
    whatsappReceipt(
      {
        id: "wamid.1",
        recipient_id: "905551234567",
        status: "delivered",
        timestamp: now / 1000 + 1000,
      },
      now,
    ),
  ).toBeUndefined();
});
it("keeps delivery/read evidence monotonic despite duplicates and out-of-order failures", () => {
  const read = { status: "read" as const, at: now };
  expect(mergeDelivery(read, { status: "delivered", at: now + 1000 })).toBe(read);
  expect(mergeDelivery(read, { status: "failed", at: now + 1000, code: 1 })).toBe(read);
  expect(
    mergeDelivery({ status: "failed", at: now }, { status: "delivered", at: now - 1000 }),
  ).toEqual({ status: "delivered", at: now });
  expect(mergeDelivery(undefined, { status: "sent", at: now })).toEqual({
    status: "sent",
    at: now,
  });
});
