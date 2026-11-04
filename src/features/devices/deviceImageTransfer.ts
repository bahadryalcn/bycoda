/** Serializable operation binding; screenshot bytes stay in the source draft. */
export type DeviceImageTransferOperation = Readonly<{
  id: string;
  sourceWindow: string;
  destinationWindow: string;
  cwd: string;
  sessionId: string;
  fingerprint: string;
}>;

export type DeviceImageTransferResult = "accepted" | "rejected" | "unknown" | "conflict";

export class DeviceImageDraftDeliveryUncertainError extends Error {
  constructor(readonly operation: DeviceImageTransferOperation) {
    super(
      "The screenshot draft was not acknowledged. Check the originating conversation before adding it again.",
    );
    this.name = "DeviceImageDraftDeliveryUncertainError";
  }
}

export class DeviceImageDraftRejectedError extends Error {
  constructor() {
    super("The conversation cannot accept this screenshot right now.");
    this.name = "DeviceImageDraftRejectedError";
  }
}

export class DeviceImageDraftChangedError extends Error {
  constructor(readonly operation: DeviceImageTransferOperation) {
    super(
      "The screenshot changed after an uncertain attachment. Check the original attachment and keep the edited draft.",
    );
    this.name = "DeviceImageDraftChangedError";
  }
}

export const validTransferText = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max && !value.includes("\0");

export function validDeviceImageTransfer(value: DeviceImageTransferOperation): boolean {
  return (
    !!value &&
    validTransferText(value.id, 128) &&
    validTransferText(value.sourceWindow, 128) &&
    validTransferText(value.destinationWindow, 128) &&
    validTransferText(value.cwd, 16_384) &&
    validTransferText(value.sessionId, 512) &&
    typeof value.fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(value.fingerprint)
  );
}

export function deviceImageTransferBinding(operation: DeviceImageTransferOperation): string {
  return JSON.stringify([
    operation.id,
    operation.sourceWindow,
    operation.destinationWindow,
    operation.cwd,
    operation.sessionId,
    operation.fingerprint,
  ]);
}

export async function deviceImageTransferFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Never evict receipts: eviction would let an old request apply twice. At capacity,
 * refuse new operations while continuing to reconcile existing ones. No image bytes. */
export class DeviceImageTransferReceipts {
  private readonly receipts = new Map<
    string,
    { binding: string; result: DeviceImageTransferResult }
  >();
  constructor(private readonly capacity = 1024) {}

  find(operation: DeviceImageTransferOperation): DeviceImageTransferResult | undefined {
    const receipt = this.receipts.get(operation.id);
    if (!receipt) return undefined;
    return receipt.binding === deviceImageTransferBinding(operation) ? receipt.result : "conflict";
  }

  apply(
    operation: DeviceImageTransferOperation,
    receive: () => boolean,
  ): DeviceImageTransferResult {
    const previous = this.find(operation);
    if (previous !== undefined) return previous;
    if (this.receipts.size >= this.capacity) return "rejected";
    const receipt = {
      binding: deviceImageTransferBinding(operation),
      result: "unknown" as DeviceImageTransferResult,
    };
    this.receipts.set(operation.id, receipt);
    try {
      receipt.result = receive() === true ? "accepted" : "rejected";
    } catch {
      // A receiver can throw after changing its draft. Never treat that as rejection.
    }
    return receipt.result;
  }
}
