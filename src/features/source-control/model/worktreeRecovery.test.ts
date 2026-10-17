import { beforeEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  resolveProjectLocation: resolve,
}));
import { worktreeDeletedExternally } from "./worktrees";
beforeEach(() => {
  resolve.mockReset();
});
it("recovers only a missing tree with an accessible parent", async () => {
  resolve.mockImplementation(async (path: string) => (path === "/trees" ? { path } : null));
  expect(await worktreeDeletedExternally("/trees/fix")).toBe(true);
  resolve.mockResolvedValue(null);
  expect(await worktreeDeletedExternally("/trees/fix")).toBe(false);
  resolve.mockResolvedValue({ path: "/trees/fix" });
  expect(await worktreeDeletedExternally("/trees/fix")).toBe(false);
});
it("does not interpret an access failure as deletion", async () => {
  resolve.mockRejectedValue(new Error("offline"));
  await expect(worktreeDeletedExternally("/trees/fix")).rejects.toThrow("offline");
});
