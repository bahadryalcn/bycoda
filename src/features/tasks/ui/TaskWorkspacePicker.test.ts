import { describe, expect, it } from "vitest";
import { isWorkspaceValid, type WorkspaceChecks } from "./TaskWorkspacePicker";

describe("task workspace checks", () => {
  it("allows an implicit checkout without inventory but blocks pending branch text", () => {
    expect(isWorkspaceValid(undefined, { pendingBranch: false }, "host")).toBe(true);
    expect(isWorkspaceValid(undefined, { pendingBranch: true }, "host")).toBe(false);
  });

  it("requires an attached matching checkout from the current Host and project", () => {
    const checks: WorkspaceChecks = {
      pendingBranch: false,
      scope: "host-one",
      trees: [
        { path: "/main", branch: "main" },
        { path: "/feature", branch: "feature" },
        { path: "/detached", branch: null },
      ],
    };
    expect(
      isWorkspaceValid({ checkoutCwd: "/feature", baseBranch: "feature" }, checks, "host-one"),
    ).toBe(true);
    expect(
      isWorkspaceValid({ checkoutCwd: "/feature", baseBranch: "feature" }, checks, "host-two"),
    ).toBe(false);
    expect(
      isWorkspaceValid({ checkoutCwd: "/feature", baseBranch: "main" }, checks, "host-one"),
    ).toBe(false);
    expect(isWorkspaceValid({ checkoutCwd: "/detached" }, checks, "host-one")).toBe(false);
    expect(
      isWorkspaceValid({ checkoutCwd: "/feature" }, { pendingBranch: false }, "host-one"),
    ).toBe(false);
  });
});
