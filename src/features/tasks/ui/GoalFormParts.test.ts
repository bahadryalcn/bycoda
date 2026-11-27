import { expect, it } from "vitest";
import { goalWorkspacesValid } from "./GoalFormParts";
import { taskWorkspaceScope } from "./TaskWorkspacePicker";

it("requires every epic project to have its own attached integration checkout", () => {
  const app = "/app";
  const api = "/api";
  const appScope = taskWorkspaceScope(undefined, app);
  const apiScope = taskWorkspaceScope(undefined, api);
  const draft = {
    cwds: [app, api],
    workspaces: {
      [app]: { baseBranch: "release", checkoutCwd: "/app-release" },
      [api]: { baseBranch: "release", checkoutCwd: "/api-release" },
    },
  };
  const appCheck = {
    pendingBranch: false,
    scope: appScope,
    trees: [{ branch: "release", path: "/app-release" }],
  };
  const apiCheck = {
    pendingBranch: false,
    scope: apiScope,
    trees: [{ branch: "release", path: "/api-release" }],
  };
  const checks = { [appScope]: appCheck, [apiScope]: apiCheck };
  expect(goalWorkspacesValid(draft, undefined, { [appScope]: appCheck })).toBe(false);
  expect(goalWorkspacesValid(draft, undefined, checks)).toBe(true);
  expect(
    goalWorkspacesValid(draft, undefined, {
      ...checks,
      [apiScope]: { ...apiCheck, scope: appScope },
    }),
  ).toBe(false);
  expect(
    goalWorkspacesValid(draft, undefined, {
      ...checks,
      [apiScope]: { ...apiCheck, pendingBranch: true },
    }),
  ).toBe(false);
});
