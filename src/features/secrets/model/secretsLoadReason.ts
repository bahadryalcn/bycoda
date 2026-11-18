import { classifyRemoteError, presentRemoteError } from "../../connections/public/remoteFailure";

/** Matches the Host's refusal text, e.g. `Host rejected request [RPC_AUTHORIZATION]`. */
const HOST_REFUSAL = /Host rejected request \[RPC_[A-Z_]+\]/;

/**
 * Why a secrets read failed, safe to show: only the connection or access reason, never a Host
 * payload. `undefined` when the failure carries nothing that is safe to quote.
 */
export function secretsLoadReason(error: unknown): string | undefined {
  const failure = classifyRemoteError(error);
  const refusal = HOST_REFUSAL.exec(failure.message)?.[0];
  if (refusal) return refusal;
  return failure.kind === "other" ? undefined : presentRemoteError(error, { explicit: true });
}
