import type { SshEndpoint } from "./serverInventory";

export type AgentForwardingTarget =
  | { connectionId: string; endpoint?: never }
  | { endpoint: SshEndpoint; connectionId?: never };

/** Issued by the native, owner-bound, expiring review store. This fingerprint
 * binds canonical endpoint configuration; it is not a server host-key digest. */
export type AgentForwardingReview = Readonly<{
  reviewId: string;
  endpointFingerprint: string;
  expiresAt: number;
  agentAvailable: boolean;
  summary: Readonly<{
    host: string;
    user?: string;
    port: number;
    jumpHosts: readonly string[];
  }>;
}>;

export type ReviewedAgentLaunchPorts = {
  review: (target: AgentForwardingTarget) => Promise<AgentForwardingReview>;
  /** The native spawn must consume/revalidate its ticket before spawning. No
   * boolean from a client, restored tab or saved endpoint may enable forwarding. */
  launch: (approval: { reviewId: string }) => Promise<unknown>;
};

function targetKey(target: AgentForwardingTarget): string {
  if (!!target.connectionId === !!target.endpoint)
    throw new Error("Choose one SSH forwarding target.");
  // Snapshot only in this controller's memory; never persist endpoint approval.
  return JSON.stringify(target);
}
function checkedReview(review: AgentForwardingReview, now: number): AgentForwardingReview {
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(review.reviewId) ||
    !/^[a-f0-9]{64}$/.test(review.endpointFingerprint) ||
    !Number.isSafeInteger(review.expiresAt) ||
    review.expiresAt <= now ||
    typeof review.agentAvailable !== "boolean" ||
    !review.summary.host ||
    !Number.isInteger(review.summary.port) ||
    review.summary.port < 1 ||
    review.summary.port > 65535 ||
    !Array.isArray(review.summary.jumpHosts) ||
    review.summary.jumpHosts.length !== 0
  )
    throw new Error("Invalid or expired agent forwarding review.");
  return Object.freeze({
    ...review,
    summary: Object.freeze({ ...review.summary, jumpHosts: Object.freeze([] as string[]) }),
  });
}

/** An ephemeral, explicit review-to-launch interaction. Native ticket validation
 * remains authoritative, including saved-record changes invisible to this UI. */
export function createReviewedAgentLaunch(ports: ReviewedAgentLaunchPorts, now = Date.now) {
  let generation = 0;
  let pending: { target: string; review: AgentForwardingReview } | undefined;
  return {
    async review(target: AgentForwardingTarget): Promise<AgentForwardingReview> {
      const key = targetKey(target);
      const current = ++generation;
      pending = undefined;
      const review = checkedReview(
        await ports.review(JSON.parse(key) as AgentForwardingTarget),
        now(),
      );
      if (current !== generation) throw new Error("Agent forwarding review was cancelled.");
      pending = { target: key, review };
      return review;
    },
    invalidate() {
      ++generation;
      pending = undefined;
    },
    async approveAndLaunch(target: AgentForwardingTarget, reviewId: string): Promise<void> {
      const approval = pending;
      // Consume before awaiting IPC: duplicate clicks and failed spawns must
      // request a new native review, never replay a previously approved launch.
      pending = undefined;
      ++generation;
      if (
        !approval ||
        approval.target !== targetKey(target) ||
        approval.review.reviewId !== reviewId ||
        approval.review.expiresAt <= now() ||
        !approval.review.agentAvailable
      )
        throw new Error("Review this SSH target with an available agent before forwarding.");
      await ports.launch({ reviewId });
    },
  };
}
