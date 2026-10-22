import { confirm } from "@tauri-apps/plugin-dialog";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { reviewWorktreeRemoval, type WorktreeRemovalReview } from "./worktrees";

export type RemovalContext = {
  environmentId: string; sourceSessionId: string; projectCwd: string;
  workingCwd: string; valid: () => boolean;
};
export type RemovalUiReview = {
  signature: string; sessionIds: string[]; activeSessionIds: string[];
  hasOpenFiles: boolean; changing: boolean;
};
export type RemovalOwner = {
  capture: (path: string) => RemovalUiReview;
  remove: (cwd: string, path: string, expected: WorktreeRemovalReview, valid: () => boolean) => Promise<void>;
};
export type RemovalReview = {
  reviewId: string; expiresAt: number; projectCwd: string; path: string;
  branch: string | null; head: string; dirty: boolean; unpushed: number;
  sessionIds: string[]; activeSessionIds: string[]; hasTerminals: boolean;
  hasAgents: boolean; hasOpenFiles: boolean; canRemove: boolean; reasons: string[];
  effects: { detachSessionIds: string[]; rebindProjectCwd: string }; atomic: false;
};
export type RemovalStatus = {
  state: "unknown" | "pending" | "applied" | "failed";
  path?: string; message?: string;
};
let owner: RemovalOwner | undefined;
export function registerWorktreeRemovalOwner(value: RemovalOwner) {
  owner = value;
  return () => { if (owner === value) owner = undefined; };
}
type Deps = {
  owner: () => RemovalOwner | undefined;
  native: typeof reviewWorktreeRemoval;
  confirm: (review: RemovalReview) => Promise<boolean>;
  now: () => number; id: () => string;
};
const defaults: Deps = {
  owner: () => owner, native: reviewWorktreeRemoval, now: Date.now,
  id: () => crypto.randomUUID(),
  confirm: (review) => confirm(
    `A paired mobile device requests removal of this worktree:\n${review.path}\nBranch: ${review.branch}\nHEAD: ${review.head}\n${review.sessionIds.length} linked conversations will be detached and retained. The branch is retained.\nExternal Git or filesystem changes cannot be locked by this review.`,
    { title: "Review mobile worktree removal", kind: "warning", okLabel: "Remove worktree", cancelLabel: "Cancel" },
  ),
};
const exact = (input: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Unsupported removal field");
};
const text = (value: unknown, max = 4096): string => {
  if (typeof value !== "string" || !value || value.length > max || /[\0\r\n]/.test(value)) throw new Error("Invalid removal identity");
  return value;
};
const scope = (context: RemovalContext) => JSON.stringify([context.environmentId, context.sourceSessionId, context.projectCwd, context.workingCwd]);
const assert = (context: RemovalContext) => {
  if (!context.valid() || context.projectCwd.startsWith("remote://") || context.workingCwd.startsWith("remote://")) throw new Error("Removal source is unavailable or private");
};

/** Window-local receipts: unknown results are reconciled, never automatically retried. */
export function createWorktreeRemovalControl(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const reviews = new Map<string, { scope: string; native: WorktreeRemovalReview; ui: RemovalUiReview; owner: RemovalOwner; public: RemovalReview }>();
  const receipts = new Map<string, { scope: string; reviewId: string; status: RemovalStatus }>();
  return async (context: RemovalContext, action: string, input: Record<string, unknown>): Promise<RemovalReview | RemovalStatus> => {
    assert(context);
    if (action === "worktrees.removal.status") {
      exact(input, ["requestId"]);
      const requestId = text(input.requestId, 200);
      const receipt = receipts.get(requestId);
      if (receipt && receipt.scope !== scope(context)) throw new Error("Removal receipt scope mismatch");
      return receipt?.status ?? { state: "unknown" };
    }
    if (action === "worktrees.removal.review") {
      exact(input, ["path"]);
      const path = text(input.path);
      if (isEqualOrInside(context.workingCwd, path) || isEqualOrInside(context.projectCwd, path)) throw new Error("Open a conversation in the base working copy before removing this worktree");
      const currentOwner = deps.owner();
      if (!currentOwner) throw new Error("Desktop worktree lifecycle owner is unavailable");
      const ui = currentOwner.capture(path);
      const native = await deps.native(context.projectCwd, path);
      assert(context);
      if (deps.owner() !== currentOwner || currentOwner.capture(path).signature !== ui.signature) throw new Error("Worktree activity changed during review");
      if (pathKey(native.path) !== pathKey(path)) throw new Error("Native worktree identity mismatch");
      const sessionIds = [...new Set([...native.sessionIds, ...ui.sessionIds])].sort();
      const reasons = [
        ...(native.status ? ["The worktree has uncommitted or untracked changes."] : []),
        ...(native.unpushed ? ["The worktree has unpublished commits."] : []),
        ...(native.hasTerminals || native.hasAgents || ui.activeSessionIds.length ? ["Close active worktree processes and conversations first."] : []),
        ...(ui.hasOpenFiles ? ["Close worktree files and terminal file panes first."] : []),
        ...(ui.changing ? ["Wait for worktree lifecycle changes to finish."] : []),
      ];
      const review: RemovalReview = { reviewId: deps.id(), expiresAt: deps.now() + 120_000,
        projectCwd: native.projectCwd, path: native.path, branch: native.branch, head: native.head,
        dirty: !!native.status, unpushed: native.unpushed, sessionIds,
        activeSessionIds: ui.activeSessionIds, hasTerminals: native.hasTerminals, hasAgents: native.hasAgents,
        hasOpenFiles: ui.hasOpenFiles, canRemove: !reasons.length, reasons,
        effects: { detachSessionIds: sessionIds, rebindProjectCwd: native.projectCwd }, atomic: false };
      for (const [id, entry] of reviews) if (entry.public.expiresAt < deps.now()) reviews.delete(id);
      if (reviews.size >= 128) throw new Error("Too many removal reviews; wait for older reviews to expire");
      reviews.set(review.reviewId, { scope: scope(context), native, ui, owner: currentOwner, public: review });
      return review;
    }
    if (action !== "worktrees.removal.approve") throw new Error("Unsupported removal action");
    exact(input, ["reviewId", "requestId"]);
    const reviewId = text(input.reviewId, 200), requestId = text(input.requestId, 200);
    const previous = receipts.get(requestId);
    if (previous) {
      if (previous.scope !== scope(context) || previous.reviewId !== reviewId) throw new Error("Removal request ID was already used");
      return previous.status;
    }
    if (receipts.size >= 256) throw new Error("Removal receipt budget reached; use a new desktop window");
    const entry = reviews.get(reviewId);
    if (!entry || entry.scope !== scope(context) || entry.public.expiresAt <= deps.now() || !entry.public.canRemove) throw new Error("Removal review is unavailable; review again");
    // Consume before the first await. A second request cannot reuse this approval.
    reviews.delete(reviewId);
    const receipt = { scope: scope(context), reviewId, status: { state: "pending", path: entry.public.path } as RemovalStatus };
    receipts.set(requestId, receipt);
    let mutationStarted = false;
    try {
      if (!(await deps.confirm(entry.public))) throw new Error("Desktop owner declined removal");
      assert(context);
      if (entry.public.expiresAt <= deps.now() || deps.owner() !== entry.owner || entry.owner.capture(entry.public.path).signature !== entry.ui.signature) throw new Error("Worktree changed after review");
      const fresh = await deps.native(context.projectCwd, entry.public.path);
      assert(context);
      if (JSON.stringify(fresh) !== JSON.stringify(entry.native) || entry.owner.capture(entry.public.path).signature !== entry.ui.signature) throw new Error("Worktree changed after review");
      mutationStarted = true;
      await entry.owner.remove(context.projectCwd, entry.public.path, entry.native, () => context.valid() && deps.owner() === entry.owner);
      receipt.status = { state: "applied", path: entry.public.path };
    } catch {
      receipt.status = { state: mutationStarted ? "unknown" : "failed", path: entry.public.path, message: "Inspect the worktree on the computer before obtaining a fresh review. Do not repeat this request." };
    }
    return receipt.status;
  };
}
export const handleWorktreeRemoval = createWorktreeRemovalControl();
