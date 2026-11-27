import { describe, expect, it } from "vitest";
import { setWorktreeFocus, worktreeFocus } from "./worktreeFocus";

describe("worktree focus", () => {
  it("stores focus per project", () => {
    setWorktreeFocus("/repo", { path: "/trees/a", branch: "feat/a" });
    expect(worktreeFocus("/repo")?.path).toBe("/trees/a");
    expect(worktreeFocus("/other")).toBeUndefined();
    setWorktreeFocus("/repo", undefined);
    expect(worktreeFocus("/repo")).toBeUndefined();
  });

  it("treats the project folder as a real focus, not as All repositories", () => {
    const main = { path: "/repo", branch: "main" };
    setWorktreeFocus("/repo", main);
    expect(worktreeFocus("/repo")).toEqual(main);
    setWorktreeFocus("/repo", undefined);
    expect(worktreeFocus("/repo")).toBeUndefined();
  });
});
