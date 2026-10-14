// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { newWorkspaceSession } from "./newWorkspaceSession";
import { newDefaultSession } from "../../features/sessions/model/session";

afterEach(() => localStorage.clear());
describe("new visible-workspace sessions", () => {
  it("uses visible checkout defaults and preserves selected worktree/branch", () => {
    const base = newDefaultSession("/visible", "supervised");
    const session = newWorkspaceSession("/visible", "supervised", { path: "/visible-worktrees/feature", branch: "feature" });
    expect(session.cwd).toBe("/visible"); expect(session.harness).toBe(base.harness); expect(session.model).toBe(base.model);
    expect(session.runtimeMode).toBe(base.runtimeMode); expect(session.worktreeCwd).toBe("/visible-worktrees/feature"); expect(session.branch).toBe("feature");
  });
  it("does not turn an alias of the main checkout into a worktree", () => {
    expect(newWorkspaceSession("G:/visible", undefined, { path: "g:\\visible", branch: "main" }).worktreeCwd).toBeUndefined();
  });
});
