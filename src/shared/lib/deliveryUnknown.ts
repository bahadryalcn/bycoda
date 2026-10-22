export type DeliverySettlement = "accepted" | "rejected" | "unknown";

/** A written request has no acknowledgement yet. It is unsafe to replay it. */
export class DeliveryUnknownError extends Error {
  constructor(message: string, readonly settlement: Promise<DeliverySettlement>) {
    super(message);
    this.name = "DeliveryUnknownError";
  }
}
