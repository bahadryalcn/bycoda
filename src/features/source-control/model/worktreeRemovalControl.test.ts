import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
vi.mock("./worktrees", () => ({ reviewWorktreeRemoval: vi.fn() }));
import { createWorktreeRemovalControl, type RemovalContext, type RemovalOwner, type RemovalReview, type RemovalStatus } from "./worktreeRemovalControl";
import type { WorktreeRemovalReview } from "./worktrees";

function fixture() {
  const context: RemovalContext = { environmentId: "host", sourceSessionId: "base-session", projectCwd: "/repo", workingCwd: "/repo", valid: () => true };
  const native: WorktreeRemovalReview = { projectCwd: "/repo", commonDir: "/repo/.git", path: "/trees/task", branch: "task", head: "abc", status: "", unpushed: 0, sessionIds: ["idle"], hasTerminals: false, hasAgents: false };
  let ui = { signature: "one", sessionIds: ["idle"], activeSessionIds: [] as string[], hasOpenFiles: false, changing: false };
  const owner: RemovalOwner = { capture: () => ui, remove: vi.fn(async () => {}) };
  const confirm = vi.fn(async () => true);
  const read = vi.fn(async () => structuredClone(native));
  let now = 10, id = 0;
  const handle = createWorktreeRemovalControl({ owner: () => owner, native: read, confirm, now: () => now, id: () => `review-${++id}` });
  const review = () => handle(context, "worktrees.removal.review", { path: native.path }) as Promise<RemovalReview>;
  const approve = (reviewId: string, requestId = "request") => handle(context, "worktrees.removal.approve", { reviewId, requestId }) as Promise<RemovalStatus>;
  return { context, native, owner, confirm, read, handle, review, approve, setUi: (value: typeof ui) => { ui = value; }, ui: () => ui, expire: () => { now += 120_001; } };
}
it("requires native owner approval and uses canonical retained-session lifecycle exactly once", async () => {
  const f = fixture(), review = await f.review();
  expect(review).toMatchObject({ canRemove: true, atomic: false, effects: { detachSessionIds: ["idle"] } });
  expect(JSON.stringify(review)).not.toContain("commonDir");
  expect(await f.approve(review.reviewId)).toMatchObject({ state: "applied" });
  expect(await f.approve(review.reviewId)).toMatchObject({ state: "applied" });
  expect(f.confirm).toHaveBeenCalledTimes(1);
  expect(f.owner.remove).toHaveBeenCalledTimes(1);
  expect(f.owner.remove).toHaveBeenCalledWith("/repo", "/trees/task", f.native, expect.any(Function));
});
it("rejects source worktree, unsupported force, wrong receipt scope and invalid source", async () => {
  const f = fixture();
  await expect(f.handle(f.context, "worktrees.removal.review", { path: "/repo" })).rejects.toThrow("base working copy");
  await expect(f.handle(f.context, "worktrees.removal.review", { path: "/trees/task", force: true })).rejects.toThrow("Unsupported");
  const r = await f.review(); await f.approve(r.reviewId);
  await expect(f.handle({ ...f.context, sourceSessionId: "foreign" }, "worktrees.removal.status", { requestId: "request" })).rejects.toThrow("scope");
  await expect(f.handle({ ...f.context, valid: () => false }, "worktrees.removal.status", { requestId: "request" })).rejects.toThrow("private");
});
it("blocks dirty, unpublished, live process, open file and changing lifecycle reviews", async () => {
  for (const kind of ["dirty", "unpushed", "process", "file", "busy", "changing"]) {
    const f = fixture();
    if (kind === "dirty") f.native.status = "?? private-file";
    if (kind === "unpushed") f.native.unpushed = 1;
    if (kind === "process") f.native.hasAgents = true;
    if (kind === "file") f.setUi({ ...f.ui(), hasOpenFiles: true });
    if (kind === "busy") f.setUi({ ...f.ui(), activeSessionIds: ["idle"] });
    if (kind === "changing") f.setUi({ ...f.ui(), changing: true });
    const r = await f.review(); expect(r.canRemove).toBe(false);
    expect(JSON.stringify(r)).not.toContain("private-file");
    await expect(f.approve(r.reviewId)).rejects.toThrow("unavailable");
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.owner.remove).not.toHaveBeenCalled();
  }
});
it("consumes a review before the approval await and reconciles concurrent requests without replay", async () => {
  const f = fixture(); let resolve!: (value: boolean) => void;
  f.confirm.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
  const r = await f.review(), first = f.approve(r.reviewId);
  expect(await f.approve(r.reviewId)).toMatchObject({ state: "pending" });
  await expect(f.approve(r.reviewId, "another-request")).rejects.toThrow("unavailable");
  resolve(true); await first; expect(f.owner.remove).toHaveBeenCalledTimes(1);
});
it("decline, stale UI, native HEAD drift, expiry and consent loss prevent mutation", async () => {
  for (const kind of ["decline", "ui", "head", "expiry", "privacy"]) {
    const f = fixture(), r = await f.review();
    f.confirm.mockImplementation(async () => {
      if (kind === "ui") f.setUi({ ...f.ui(), signature: "changed" });
      if (kind === "head") f.native.head = "new-head";
      if (kind === "expiry") f.expire();
      if (kind === "privacy") f.context.valid = () => false;
      return kind !== "decline";
    });
    expect(await f.approve(r.reviewId)).toMatchObject({ state: "failed" });
    expect(f.owner.remove).not.toHaveBeenCalled();
  }
});
it("unknown canonical mutation failure remains unknown on repeated requests", async () => {
  const f = fixture(); vi.mocked(f.owner.remove).mockRejectedValue(new Error("lost acknowledgement"));
  const r = await f.review();
  expect(await f.approve(r.reviewId)).toMatchObject({ state: "unknown" });
  expect(await f.approve(r.reviewId)).toMatchObject({ state: "unknown" });
  expect(f.owner.remove).toHaveBeenCalledTimes(1);
  expect(await f.handle(f.context, "worktrees.removal.status", { requestId: "missing" })).toEqual({ state: "unknown" });
});
