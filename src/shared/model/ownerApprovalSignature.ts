/** Fields of one owner approval that a phone sees and a decision commits to. */
export type OwnerApprovalSignatureInput = {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  deadline: number;
  remote: boolean;
  details?: unknown;
};

/**
 * Hash of everything the owner is shown. The desktop, the Host and the phone compute the same value,
 * so a phone answer applies only to the exact operation it displayed.
 */
export async function ownerApprovalSignature(input: OwnerApprovalSignatureInput): Promise<string> {
  const canonical = JSON.stringify([
    input.id,
    input.title,
    input.message,
    input.confirmLabel,
    input.cancelLabel,
    input.deadline,
    input.remote,
    input.details ?? null,
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
