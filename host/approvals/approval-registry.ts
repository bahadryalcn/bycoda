import type {
  ApprovalMirrorEntry,
  ApprovalStatus,
  ApprovalView,
} from "../../src/shared/model/host-contracts/approvals";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";

/** The desktop reports in at least every few seconds; a silent principal is no longer the desktop. */
export const DESKTOP_PRINCIPAL_MS = 30_000;
/** Answered and expired approvals stay listed this long so the phone and the Assistant can see them. */
export const APPROVAL_KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 24;
const MAX_ENTRIES = 200;
const MAX_DETAILS_JSON = 65_536;

type Entry = ApprovalView & {
  /** A push was sent (or deliberately skipped) for this approval. */
  pushed: boolean;
  /** The desktop took the phone's answer and settled the native dialog with it. */
  applied: boolean;
  endedAt?: number;
};

export type ApprovalOutcome = {
  id: string;
  outcome: "answered" | "ended";
  approved?: boolean;
};

export class ApprovalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalsError";
  }
}

const expiredNotice = (title: string) =>
  `Approval expired: ${title}. Ask the assistant to try again.`;

/**
 * In-memory mirror of the desktop's pending owner approvals. The native dialog stays the only authority:
 * this registry stores a phone's answer and the desktop applies it, exactly like a click, after it checks
 * that the same approval is still pending and shows the same content (`signature`).
 */
export class ApprovalRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly desktops = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Called on every desktop heartbeat; only a principal that recently sent one may mirror. */
  noteDesktop(principal: string): void {
    this.desktops.set(principal, this.now());
    if (this.desktops.size > 16)
      for (const [key, at] of this.desktops)
        if (this.now() - at > DESKTOP_PRINCIPAL_MS) this.desktops.delete(key);
  }

  isDesktop(principal: string): boolean {
    const at = this.desktops.get(principal);
    return at !== undefined && this.now() - at <= DESKTOP_PRINCIPAL_MS;
  }

  private requireDesktop(principal: string): void {
    if (!this.isDesktop(principal))
      throw new ApprovalsError("Only the desktop app may report or read approvals for its window.");
  }

  /** Adds new approvals, ignores repeats, and settles the ones the desktop reports finished. */
  async mirror(
    principal: string,
    params: { upsert: ApprovalMirrorEntry[]; remove: ApprovalOutcome[] },
  ): Promise<{ accepted: number }> {
    this.requireDesktop(principal);
    this.sweep();
    let accepted = 0;
    for (const item of params.upsert) {
      const existing = this.entries.get(item.id);
      if (existing) {
        if (existing.signature === item.signature) accepted += 1;
        continue;
      }
      const pending = [...this.entries.values()].filter((e) => e.status === "pending").length;
      if (
        pending >= MAX_PENDING ||
        item.deadline <= this.now() ||
        JSON.stringify(item.details ?? null).length > MAX_DETAILS_JSON ||
        item.signature !== (await ownerApprovalSignature(item))
      )
        continue;
      this.entries.set(item.id, { ...item, status: "pending", pushed: false, applied: false });
      accepted += 1;
    }
    for (const outcome of params.remove) this.finish(outcome);
    this.prune();
    return { accepted };
  }

  private finish(outcome: ApprovalOutcome): void {
    const entry = this.entries.get(outcome.id);
    if (!entry) return;
    const at = this.now();
    if (entry.status === "pending") {
      if (outcome.outcome === "answered") {
        entry.status = outcome.approved === true ? "approved" : "denied";
        entry.decidedBy = "desktop";
        entry.decidedAt = at;
      } else this.expire(entry);
      entry.applied = true;
      entry.endedAt = at;
      return;
    }
    // A phone answer: the desktop settled it, or the dialog ended before it could.
    if (entry.decidedBy === "phone" && !entry.applied) {
      entry.applied = true;
      entry.endedAt ??= at;
      if (outcome.outcome === "ended") this.expire(entry);
    }
  }

  private expire(entry: Entry): void {
    entry.status = "expired";
    entry.notice = expiredNotice(entry.title);
    entry.endedAt ??= this.now();
  }

  /** Pending approvals past their deadline and phone answers nobody applied end as expired. */
  private sweep(): void {
    const at = this.now();
    for (const entry of this.entries.values()) {
      if (entry.deadline > at || entry.status === "expired") continue;
      if (entry.status === "pending" || (entry.decidedBy === "phone" && !entry.applied))
        this.expire(entry);
      entry.endedAt ??= at;
    }
  }

  private prune(): void {
    const at = this.now();
    for (const [id, entry] of this.entries)
      if (entry.endedAt !== undefined && at - entry.endedAt > APPROVAL_KEEP_MS)
        this.entries.delete(id);
    if (this.entries.size <= MAX_ENTRIES) return;
    const settled = [...this.entries.entries()]
      .filter(([, entry]) => entry.endedAt !== undefined)
      .sort((a, b) => (a[1].endedAt ?? 0) - (b[1].endedAt ?? 0));
    for (const [id] of settled) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(id);
    }
  }

  private view(entry: Entry): ApprovalView {
    // Internal flags stay on the Host.
    const { pushed: _pushed, applied: _applied, endedAt: _endedAt, ...view } = entry;
    return view;
  }

  list(): ApprovalView[] {
    this.sweep();
    this.prune();
    const rank = (status: ApprovalStatus) => (status === "pending" ? 0 : 1);
    return [...this.entries.values()]
      .sort(
        (a, b) =>
          rank(a.status) - rank(b.status) ||
          (a.status === "pending" ? a.deadline - b.deadline : (b.endedAt ?? 0) - (a.endedAt ?? 0)),
      )
      .map((entry) => this.view(entry));
  }

  /** First valid answer wins; a repeat reports the stored answer instead of changing it. */
  decide(params: { id: string; signature: string; approved: boolean }): {
    id: string;
    status: ApprovalStatus;
    approved: boolean;
    alreadyDecided: boolean;
  } {
    this.sweep();
    const entry = this.entries.get(params.id);
    if (!entry) throw new ApprovalsError("Approval not found.");
    if (!entry.remote)
      throw new ApprovalsError("This approval can only be answered on the computer.");
    if (entry.status === "expired") throw new ApprovalsError("Approval expired.");
    if (entry.signature !== params.signature)
      throw new ApprovalsError("The approval changed; review it again.");
    if (entry.status !== "pending")
      return {
        id: entry.id,
        status: entry.status,
        approved: entry.status === "approved",
        alreadyDecided: true,
      };
    entry.status = params.approved ? "approved" : "denied";
    entry.decidedBy = "phone";
    entry.decidedAt = this.now();
    return { id: entry.id, status: entry.status, approved: params.approved, alreadyDecided: false };
  }

  /** Phone answers the desktop has not applied yet; the desktop checks each against its own dialog. */
  decisions(principal: string): { id: string; signature: string; approved: boolean }[] {
    this.requireDesktop(principal);
    this.sweep();
    return [...this.entries.values()]
      .filter((e) => e.decidedBy === "phone" && !e.applied && e.status !== "expired")
      .map((e) => ({ id: e.id, signature: e.signature, approved: e.status === "approved" }));
  }

  /** Remote approvals still waiting that no push has covered yet. */
  unpushed(): ApprovalView[] {
    this.sweep();
    return [...this.entries.values()]
      .filter((e) => e.status === "pending" && e.remote && !e.pushed)
      .map((e) => this.view(e));
  }

  markPushed(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.pushed = true;
  }
}
