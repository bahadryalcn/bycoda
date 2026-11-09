import { sessionDelegationParent } from "../../../shared/model/host-contracts/delegation";
import { RUNTIME_MODES, type RuntimeMode, type Session } from "../model/session";
import type { SessionSummary } from "./sessionStore";

/** A stored runtime mode, or the safe default for an unknown value. */
export function asRuntimeMode(value: string): RuntimeMode {
  return (RUNTIME_MODES as string[]).includes(value) ? (value as RuntimeMode) : "supervised";
}

/**
 * The native summary carries no model settings, so a saved delegated child would
 * otherwise pass as a user conversation in recent and project lists.
 */
export function withSessionDelegation(summary: SessionSummary, saved: Session): SessionSummary {
  return { ...summary, delegationParent: sessionDelegationParent(saved) ?? null };
}
