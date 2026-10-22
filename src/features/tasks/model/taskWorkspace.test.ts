import { describe, expect, it } from "vitest";
import { parseTaskWorkspace } from "./taskWorkspace";
import { parseHostGoal } from "./hostGoals";

describe("workspace contracts", () => {
  it("keeps explicit host paths and omits empty selections", () => {
    expect(parseTaskWorkspace(undefined)).toBeUndefined();
    expect(parseTaskWorkspace({ baseBranch: "", checkoutCwd: "" })).toBeUndefined();
    expect(
      parseTaskWorkspace({
        checkoutCwd: "G:\\work\\selected",
        baseBranch: "goal/settings",
        branchName: "mc/controls",
      }),
    ).toEqual({
      checkoutCwd: "G:\\work\\selected",
      baseBranch: "goal/settings",
      branchName: "mc/controls",
    });
  });
  it.each([null, [], { baseBranch: "-main" }, { checkoutCwd: "a\0b" }, { branchName: "a\nb" }])(
    "rejects malformed workspace data %j",
    (value) => expect(() => parseTaskWorkspace(value)).toThrow(),
  );
  const goal = {
    id: "goal",
    title: "Goal",
    prompt: "Do work",
    projectIds: ["project"],
    leadProjectId: "project",
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
  };
  it("validates concurrency, start mode and project-scoped workspace inheritance", () => {
    expect(parseHostGoal({ ...goal, isolate: false }).isolate).toBe(false);
    expect(parseHostGoal(goal).isolate).toBeUndefined();
    expect(() => parseHostGoal({ ...goal, isolate: "false" })).toThrow("Invalid goal options");
    expect(
      parseHostGoal({
        ...goal,
        maxRunningTasks: 3,
        manualStart: true,
        workspaces: { project: { baseBranch: "integration" } },
      }),
    ).toMatchObject({ maxRunningTasks: 3, manualStart: true });
    for (const maxRunningTasks of [0, 9, 1.5, "2"])
      expect(() => parseHostGoal({ ...goal, maxRunningTasks })).toThrow("concurrency");
    expect(() => parseHostGoal({ ...goal, manualStart: "yes" })).toThrow("start mode");
    expect(() => parseHostGoal({ ...goal, workspaces: { other: { baseBranch: "main" } } })).toThrow(
      "outside",
    );
    expect(() =>
      parseHostGoal({ ...goal, workspaces: { project: { branchName: "shared" } } }),
    ).toThrow("base branch");
  });
});
