import { createHmac, timingSafeEqual } from "node:crypto";

/** Domain-separated proofs never disclose the stored SHA-256 key or bearer. */
export function hostProof(
  key: string,
  kind: "pairing" | "device",
  side: "request" | "response",
  nonce: string,
  environmentId: string,
  origin: string,
): string {
  return createHmac("sha256", key)
    .update(`bycoda-host-proof-v1\n${kind}\n${side}\n${nonce}\n${environmentId}\n${origin}`)
    .digest("hex");
}

export function matchesHostProof(expected: string, supplied: unknown): boolean {
  return (
    typeof supplied === "string" &&
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))
  );
}
