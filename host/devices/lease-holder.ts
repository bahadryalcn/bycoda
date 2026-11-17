import type { LeaseHolder } from "../../src/shared/model/host-contracts/native-devices";

/** Owner string an agent conversation claims device control with. The one place that builds it. */
export function conversationLeaseOwner(tokenHash: string, sessionId: string): string {
  return `conversation:${tokenHash}:${sessionId}`;
}

/**
 * Public holder of a lease owner: the session for a conversation owner, otherwise a person's
 * controller (desktop or phone panel). Never returns the token hash or lease id.
 */
export function leaseHolderFromOwner(owner: string): LeaseHolder {
  const match = /^conversation:[^:]+:(.+)$/s.exec(owner);
  return match ? { kind: "session", sessionId: match[1]! } : { kind: "controller" };
}
