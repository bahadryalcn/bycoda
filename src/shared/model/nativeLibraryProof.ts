import { z } from "zod";
const identity = z.string().min(1).max(200);
export const NativeLibraryProofSchema = z.strictObject({ environmentId: identity, threadId: identity, installationId: identity, issuer: identity, registryRevision: identity, visibilityEpoch: z.number().int().nonnegative().safe(), policyGeneration: identity });
export type NativeLibraryProof = z.infer<typeof NativeLibraryProofSchema>;
export function mergeNativeLibraryProofs(...sets: readonly NativeLibraryProof[][]): NativeLibraryProof[] {
  const result = new Map<string, NativeLibraryProof>();
  for (const input of sets.flat()) {
    const proof = NativeLibraryProofSchema.parse(input);
    const key = JSON.stringify([proof.environmentId, proof.threadId, proof.installationId]);
    const previous = result.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(proof)) throw new Error("Native library source changed.");
    result.set(key, proof);
    if (result.size > 100) throw new Error("Native library source scope is too large.");
  }
  return [...result.values()];
}
