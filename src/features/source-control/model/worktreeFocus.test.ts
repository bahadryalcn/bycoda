import { describe, expect, it } from "vitest";
import { inWorktreeFocus, setWorktreeFocus, worktreeFocus } from "./worktreeFocus";

describe("worktree focus", () => {
  it("keeps every session when nothing is focused", () => {
    expect(inWorktreeFocus({ cwd: "/repo" }, undefined)).toBe(true);
    expect(inWorktreeFocus({ cwd: "/repo", worktreeCwd: "/trees/a" }, undefined)).toBe(true);
  });

  it("matches sessions by their working copy", () => {
    const main = { path: "/repo", branch: "main" };
    const feature = { path: "/trees/a", branch: "feat/a" };
    const inMain = { cwd: "/repo" };
    const inFeature = { cwd: "/repo", worktreeCwd: "/trees/a" };
    expect(inWorktreeFocus(inMain, main)).toBe(true);
    expect(inWorktreeFocus(inFeature, main)).toBe(false);
    expect(inWorktreeFocus(inFeature, feature)).toBe(true);
    expect(inWorktreeFocus(inMain, feature)).toBe(false);
  });

  it("stores focus per project", () => {
    setWorktreeFocus("/repo", { path: "/trees/a", branch: "feat/a" });
    expect(worktreeFocus("/repo")?.path).toBe("/trees/a");
    expect(worktreeFocus("/other")).toBeUndefined();
    setWorktreeFocus("/repo", undefined);
    expect(worktreeFocus("/repo")).toBeUndefined();
  });

  it("treats the project folder as a real focus, not as All worktrees", () => {
    const main = { path: "/repo", branch: "main" };
    setWorktreeFocus("/repo", main);
    expect(worktreeFocus("/repo")).toEqual(main);
    expect(inWorktreeFocus({ cwd: "/repo", worktreeCwd: "/trees/a" }, worktreeFocus("/repo"))).toBe(
      false,
    );
    setWorktreeFocus("/repo", undefined);
    expect(inWorktreeFocus({ cwd: "/repo", worktreeCwd: "/trees/a" }, worktreeFocus("/repo"))).toBe(
      true,
    );
  });
});
