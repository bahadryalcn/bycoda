/** Company-only policy foundation. Not wired to RPC and not an identity verifier.
 * The embedding host must supply a trusted, server-side verifier: validate issuer,
 * signature, audience, device proof, authoritative membership/admission, grants,
 * revocation/recovery checkpoints and approval provenance before returning evidence.
 * Never implement that boundary by casting request JSON or trusting client booleans.
 * Personal pairing/roles/network reachability are deliberately not inputs here.
 */
export type TeamPermission =
  | "terminal.observe"
  | "terminal.input"
  | "sftp.read"
  | "sftp.write"
  | "forward.local"
  | "forward.remote"
  | "forward.dynamic";
export type TeamTarget = {
  organizationId: string;
  projectId: string;
  machineId: string;
  resourceId: string;
};
export type TeamAccessRequest = TeamTarget & {
  actorId: string;
  deviceId: string;
  permission: TeamPermission;
  requestId: string;
  /** Host-computed digest of the exact typed effect, not a client assertion. */
  operationDigest?: string;
};
export type TeamEvidence = {
  target: TeamTarget;
  actorId: string;
  deviceId: string;
  identity: "active" | "revoked";
  membership: "active" | "revoked";
  admission: "admitted" | "pending_identity" | "pending_seat" | "suspended" | "revoked";
  device: "trusted" | "revoked";
  grant: "active" | "revoked";
  recovery: "ready" | "quarantined" | "unverified";
  entitlement: "active" | "denied";
  permissions: readonly TeamPermission[];
  hostCapabilities: readonly TeamPermission[];
  policy: "allow" | "deny";
  epoch: number;
  checkpointEpoch: number;
  leaseId: string;
  membershipCheckedAt: number;
  issuedAt: number;
  expiresAt: number;
  writer?: { actorId: string; deviceId: string; leaseId: string; expiresAt: number };
  approval?: {
    requestId: string;
    operationDigest: string;
    permission: TeamPermission;
    expiresAt: number;
  };
};
export interface TeamEvidenceVerifier {
  /** Return undefined on unavailable/stale authority, invalid proof or unsupported issuer.
   * Evidence is a privileged adapter result, never an accepted wire schema.
   * Checkpoints must survive restart independently of restored company data.
   */
  verify(
    envelope: unknown,
    request: Readonly<TeamAccessRequest>,
  ): Promise<TeamEvidence | undefined>;
}
export type TeamDecision =
  | { allowed: true; remainingMs: number }
  | { allowed: false; reason: string };
type Clock = { wallMs(): number; monotonicMs(): number };
const targetKeys = ["organizationId", "projectId", "machineId", "resourceId"] as const;
const permissions: readonly TeamPermission[] = [
  "terminal.observe",
  "terminal.input",
  "sftp.read",
  "sftp.write",
  "forward.local",
  "forward.remote",
  "forward.dynamic",
];
const deny = (reason: string): TeamDecision => ({ allowed: false, reason });
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  [...value].every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127);
const time = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const needsApproval = (permission: TeamPermission) =>
  permission !== "terminal.observe" && permission !== "sftp.read";

/** No adapter means no company access. No grant issuance, process control or crypto.
 * authorize() is a read-only policy recheck, not approval consumption or an
 * idempotency ledger: repeated checks of the same request may return allowed.
 * Do not activate effect authority until the integration provides authoritative
 * one-time operation consumption/idempotency and exclusive single-writer lease
 * ownership. Matching writer evidence here does not establish global exclusivity.
 * Call again before each effect and at stream boundaries. The returned duration is
 * a ceiling, not permission to skip revocation checks. Restart safety depends on
 * the adapter's authoritative checkpoint; in-memory high-water marks are additional.
 */
export function createTeamAccessPolicy(
  verifier?: TeamEvidenceVerifier,
  clock: Clock = {
    wallMs: () => Date.now(),
    monotonicMs: () => performance.now(),
  },
) {
  const epochs = new Map<string, number>();
  const deadlines = new Map<string, { fingerprint: string; monotonic: number }>();
  let lastMonotonic = -Infinity;
  return {
    async authorize(envelope: unknown, input: TeamAccessRequest): Promise<TeamDecision> {
      if (!verifier) return deny("verifier-unavailable");
      // Snapshot before awaiting so an untrusted caller cannot change the target mid-check.
      const request = Object.freeze({ ...input });
      if (
        !targetKeys.every((key) => id(request[key])) ||
        !id(request.actorId) ||
        !id(request.deviceId) ||
        !id(request.requestId) ||
        !permissions.includes(request.permission)
      )
        return deny("invalid-request");
      let evidence: TeamEvidence | undefined;
      try {
        evidence = await verifier.verify(envelope, request);
      } catch {
        return deny("verification-failed");
      }
      if (!evidence) return deny("verification-unavailable");
      const now = clock.wallMs(),
        monotonic = clock.monotonicMs();
      if (!time(now) || !Number.isFinite(monotonic) || monotonic < lastMonotonic)
        return deny("invalid-clock");
      lastMonotonic = monotonic;
      const e = evidence;
      if (
        !e.target ||
        !targetKeys.every((key) => request[key] === e.target[key]) ||
        e.actorId !== request.actorId ||
        e.deviceId !== request.deviceId
      )
        return deny("binding-mismatch");
      if (
        e.identity !== "active" ||
        e.membership !== "active" ||
        e.admission !== "admitted" ||
        e.device !== "trusted" ||
        e.grant !== "active"
      )
        return deny("principal-not-admitted");
      if (e.recovery !== "ready") return deny("recovery-unverified");
      if (
        !time(e.epoch) ||
        !time(e.checkpointEpoch) ||
        e.epoch !== e.checkpointEpoch ||
        e.checkpointEpoch < (epochs.get(request.organizationId) ?? 0)
      )
        return deny("epoch-mismatch");
      if (!epochs.has(request.organizationId) && epochs.size >= 1024)
        return deny("policy-capacity");
      epochs.set(request.organizationId, e.checkpointEpoch);
      if (
        e.policy !== "allow" ||
        e.entitlement !== "active" ||
        !Array.isArray(e.permissions) ||
        !e.permissions.includes(request.permission) ||
        !Array.isArray(e.hostCapabilities) ||
        !e.hostCapabilities.includes(request.permission)
      )
        return deny("permission-denied");
      if (
        !id(e.leaseId) ||
        !time(e.membershipCheckedAt) ||
        !time(e.issuedAt) ||
        !time(e.expiresAt) ||
        e.membershipCheckedAt > e.issuedAt ||
        e.issuedAt > now ||
        e.expiresAt <= now ||
        e.expiresAt <= e.issuedAt ||
        e.expiresAt > e.membershipCheckedAt + 60_000
      )
        return deny("lease-expired-or-stale");
      let expiresAt = e.expiresAt;
      if (request.permission === "terminal.input") {
        const writer = e.writer;
        if (
          !writer ||
          writer.actorId !== request.actorId ||
          writer.deviceId !== request.deviceId ||
          writer.leaseId !== e.leaseId ||
          !time(writer.expiresAt) ||
          writer.expiresAt <= now
        )
          return deny("writer-required");
        expiresAt = Math.min(expiresAt, writer.expiresAt);
      }
      if (needsApproval(request.permission)) {
        const approval = e.approval;
        if (
          !approval ||
          !id(request.operationDigest) ||
          approval.operationDigest !== request.operationDigest ||
          approval.requestId !== request.requestId ||
          approval.permission !== request.permission ||
          !time(approval.expiresAt) ||
          approval.expiresAt <= now
        )
          return deny("approval-required");
        expiresAt = Math.min(expiresAt, approval.expiresAt);
      }
      const fingerprint = JSON.stringify([
        e.target,
        e.actorId,
        e.deviceId,
        e.epoch,
        e.membershipCheckedAt,
        e.issuedAt,
        e.expiresAt,
      ]);
      const key = JSON.stringify([request.organizationId, e.leaseId]);
      const previous = deadlines.get(key);
      // Do not evict lease deadlines: doing so could revive one after wall-clock rollback.
      if (!previous && deadlines.size >= 4096) return deny("policy-capacity");
      if (previous && previous.fingerprint !== fingerprint) return deny("lease-rebound");
      const deadline = Math.min(previous?.monotonic ?? Infinity, monotonic + expiresAt - now);
      deadlines.set(key, { fingerprint, monotonic: deadline });
      if (deadline <= monotonic) return deny("lease-monotonic-expired");
      return { allowed: true, remainingMs: deadline - monotonic };
    },
  };
}
