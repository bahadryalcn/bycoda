import { createHash } from "node:crypto";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

/** Fields read from `gh pr view --json`; the Host reuses the same set for every poll. */
export const PULL_REQUEST_VIEW_FIELDS =
  "state,reviewDecision,statusCheckRollup,mergeable,headRefOid,reviews,comments,url";

const FAILING_NAMES_LIMIT = 10;
const CHECK_NAME_LENGTH = 80;
const WAKE_TEXT_LIMIT = 800;
const PR_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]{0,8})(?:[/?#].*)?$/;

export type ChecksOverall = "none" | "pending" | "passing" | "failing";

export type PullRequestChecks = {
  overall: ChecksOverall;
  pending: number;
  success: number;
  failure: number;
  /** Names of failing checks, capped; the count is `failure`. */
  failing: string[];
};

/** The compact state the poller compares between polls. Field order is fixed for the digest. */
export type PullRequestSnapshot = {
  state: string;
  reviewDecision: string;
  checks: PullRequestChecks;
  headRefOid: string;
  reviewCount: number;
  commentCount: number;
  mergeable: string;
};

export type WakeReason =
  | { kind: "state"; state: "MERGED" | "CLOSED" }
  | { kind: "checks"; overall: "passing" | "failing" }
  | { kind: "review"; decision: string }
  | { kind: "reviews"; count: number }
  | { kind: "comments"; count: number }
  | { kind: "head"; sha: string };

export type PullRequestView = { url: string; snapshot: PullRequestSnapshot };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Accepts only a github.com pull request link and returns its canonical form. */
export function parsePullRequestUrl(raw: string): { url: string; number: number } | undefined {
  const match = PR_URL.exec(raw.trim());
  if (!match) return undefined;
  const number = Number(match[3]);
  return { url: `https://github.com/${match[1]}/${match[2]}/pull/${number}`, number };
}

export function isTerminalState(state: string): state is "MERGED" | "CLOSED" {
  return state === "MERGED" || state === "CLOSED";
}

function checkOutcome(item: Record<string, unknown>): "pending" | "success" | "failure" {
  // StatusContext rows carry `state`; CheckRun rows carry `status` and `conclusion`.
  if (typeof item.state === "string") {
    const state = item.state.toUpperCase();
    if (state === "SUCCESS") return "success";
    return state === "PENDING" || state === "EXPECTED" ? "pending" : "failure";
  }
  if (String(item.status ?? "").toUpperCase() !== "COMPLETED") return "pending";
  const conclusion = String(item.conclusion ?? "").toUpperCase();
  return conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED"
    ? "success"
    : "failure";
}

export function summarizeChecks(rollup: unknown): PullRequestChecks {
  const items = Array.isArray(rollup) ? rollup : [];
  let pending = 0;
  let success = 0;
  let failure = 0;
  const failing: string[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const outcome = checkOutcome(item);
    if (outcome === "pending") pending++;
    else if (outcome === "success") success++;
    else {
      failure++;
      const name =
        typeof item.name === "string"
          ? item.name
          : typeof item.context === "string"
            ? item.context
            : "check";
      if (failing.length < FAILING_NAMES_LIMIT)
        failing.push(truncateGraphemes(name, CHECK_NAME_LENGTH));
    }
  }
  // Failures outrank pending checks: a red check is news even while others still run.
  const overall: ChecksOverall =
    failure > 0 ? "failing" : pending > 0 ? "pending" : success > 0 ? "passing" : "none";
  return { overall, pending, success, failure, failing };
}

/** Parses one `gh pr view --json` response. Throws on a response that is not a pull request. */
export function parsePullRequestView(raw: string): PullRequestView {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error("Pull request response is not an object.");
  const parsed = parsePullRequestUrl(typeof value.url === "string" ? value.url : "");
  if (!parsed) throw new Error("Pull request response has no github.com pull request URL.");
  if (typeof value.state !== "string" || !value.state)
    throw new Error("Pull request response has no state.");
  return {
    url: parsed.url,
    snapshot: {
      state: value.state,
      reviewDecision: typeof value.reviewDecision === "string" ? value.reviewDecision : "",
      checks: summarizeChecks(value.statusCheckRollup),
      headRefOid: typeof value.headRefOid === "string" ? value.headRefOid : "",
      reviewCount: Array.isArray(value.reviews) ? value.reviews.length : 0,
      commentCount: Array.isArray(value.comments) ? value.comments.length : 0,
      mergeable: typeof value.mergeable === "string" ? value.mergeable : "UNKNOWN",
    },
  };
}

/**
 * The meaningful changes between two observations. The first observation has no
 * baseline, so it never wakes the session.
 */
export function diffPullRequest(
  previous: PullRequestSnapshot | undefined,
  next: PullRequestSnapshot,
): WakeReason[] {
  if (!previous) return [];
  const reasons: WakeReason[] = [];
  if (previous.state !== next.state && isTerminalState(next.state))
    reasons.push({ kind: "state", state: next.state });
  // A check that starts re-running (pending) is not news; its result is.
  const wasChecks = previous.checks.overall;
  const nowChecks = next.checks.overall;
  // From "none" too: fast CI can register and finish between two polls.
  if (wasChecks !== nowChecks && (nowChecks === "passing" || nowChecks === "failing"))
    reasons.push({ kind: "checks", overall: nowChecks });
  if (previous.reviewDecision !== next.reviewDecision)
    reasons.push({ kind: "review", decision: next.reviewDecision });
  const newReviews = next.reviewCount - previous.reviewCount;
  if (newReviews > 0) reasons.push({ kind: "reviews", count: newReviews });
  const newComments = next.commentCount - previous.commentCount;
  if (newComments > 0) reasons.push({ kind: "comments", count: newComments });
  // A new head matters once its checks have produced a result, not while they are queued.
  if (
    previous.headRefOid &&
    next.headRefOid &&
    previous.headRefOid !== next.headRefOid &&
    (nowChecks === "passing" || nowChecks === "failing")
  )
    reasons.push({ kind: "head", sha: next.headRefOid });
  return reasons;
}

/** Folds newly found reasons into a pending set: one entry per kind, counts summed. */
export function mergeWakeReasons(existing: WakeReason[], added: WakeReason[]): WakeReason[] {
  const merged = [...existing];
  for (const reason of added) {
    const index = merged.findIndex((item) => item.kind === reason.kind);
    if (index < 0) {
      merged.push(reason);
      continue;
    }
    const current = merged[index];
    if (reason.kind === "reviews" && current.kind === "reviews")
      merged[index] = { kind: "reviews", count: current.count + reason.count };
    else if (reason.kind === "comments" && current.kind === "comments")
      merged[index] = { kind: "comments", count: current.count + reason.count };
    else merged[index] = reason;
  }
  return merged;
}

/** Stable digest used for wake command IDs: a retry of the same pending wake repeats its ID. */
export function wakeDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/** The message sent into the watching session. Its text is frozen when the wake is queued. */
export function pullRequestWakeText(input: {
  number: number;
  url: string;
  snapshot: PullRequestSnapshot;
  reasons: WakeReason[];
}): string {
  const parts: string[] = [];
  for (const reason of input.reasons) {
    if (reason.kind === "state")
      parts.push(reason.state === "MERGED" ? "The PR was merged" : "The PR was closed");
    else if (reason.kind === "checks") {
      if (reason.overall === "passing") parts.push("checks passing");
      else {
        const { failure, failing } = input.snapshot.checks;
        const names = failing.length ? `: ${failing.join(", ")}` : "";
        parts.push(`checks failing (${failure} failed${names})`);
      }
    } else if (reason.kind === "review")
      parts.push(reason.decision ? `Review: ${reason.decision}` : "Review decision cleared");
    else if (reason.kind === "reviews")
      parts.push(`${reason.count} new review${reason.count === 1 ? "" : "s"}`);
    else if (reason.kind === "comments")
      parts.push(`${reason.count} new comment${reason.count === 1 ? "" : "s"}`);
    else parts.push(`new commit ${reason.sha.slice(0, 7)}`);
  }
  const head = truncateGraphemes(
    `PR #${input.number} (${input.url}): ${parts.join(". ")}.`,
    WAKE_TEXT_LIMIT,
  );
  const tail = isTerminalState(input.snapshot.state)
    ? "This PR is no longer open, so its watch has ended."
    : "You are watching this PR; call pullRequests.unwatch when done.";
  return `${head}\n${tail}`;
}
