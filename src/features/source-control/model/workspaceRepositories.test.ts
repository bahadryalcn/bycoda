import { expect, it } from "vitest";
import { workspaceRepositoryPaths, workspaceSourceControlRoot } from "./workspaceRepositories";
import { NOTHING_LOCKED, computeLockSnapshot } from "../../group-lock/model/lockState";

const groups = [
  {
    id: "wallet",
    name: "Wallet",
    collapsed: false,
    workspaceFile: "G:/wallet/wallet.code-workspace",
    workspaceFolders: ["G:/wallet/api", "G:/wallet/mobile", "g:/WALLET/api/"],
  },
];

it("keeps the root selected after child diff navigation while preserving genuine worktree selection", () => {
  const paths = ["G:/wallet/api", "G:/wallet/mobile"];
  expect(workspaceSourceControlRoot("G:/wallet", "g:\\WALLET\\api", paths)).toBe("G:/wallet");
  expect(workspaceSourceControlRoot("G:/wallet", "G:/wallet/worktrees/task", paths)).toBe(
    "G:/wallet/worktrees/task",
  );
  expect(workspaceSourceControlRoot("G:/wallet", "G:/wallet/api")).toBe("G:/wallet/api");
});
it("uses workspace folders even before they enter recents, deduplicates and includes manually assigned folders", () => {
  expect(
    workspaceRepositoryPaths(
      "g:\\WALLET",
      groups,
      { "g:/tools": "wallet" },
      ["G:/tools"],
      NOTHING_LOCKED,
    ),
  ).toEqual(["G:/wallet/api", "G:/wallet/mobile", "G:/tools"]);
});
it("does not aggregate ordinary projects, groups or a workspace's other worktree", () => {
  expect(workspaceRepositoryPaths("G:/wallet/api", groups, {}, [], NOTHING_LOCKED)).toBeUndefined();
  expect(
    workspaceRepositoryPaths("G:/wallet-worktree", groups, {}, [], NOTHING_LOCKED),
  ).toBeUndefined();
  expect(
    workspaceRepositoryPaths(
      "G:/wallet",
      [{ id: "team", name: "Team", collapsed: false }],
      {},
      [],
      NOTHING_LOCKED,
    ),
  ).toBeUndefined();
});
it("omits a workspace root from its own repository rows", () => {
  expect(
    workspaceRepositoryPaths(
      "G:/wallet",
      [{ ...groups[0], workspaceFolders: ["G:/wallet", "G:/wallet/api"] }],
      {},
      [],
      NOTHING_LOCKED,
    ),
  ).toEqual(["G:/wallet/api"]);
});
it("does not reveal a locked folder or a hidden workspace root", () => {
  const lock = {
    lockedGroupIds: new Set(["private"]),
    lockedProjectKeys: new Set(["g:/wallet/mobile"]),
  };
  expect(workspaceRepositoryPaths("G:/wallet", groups, {}, [], lock)).toEqual(["G:/wallet/api"]);
  const hidden = computeLockSnapshot({
    groups,
    assignments: {},
    hasPassword: false,
    unlocked: new Set(),
    hiddenGroupIds: new Set(["wallet"]),
  });
  expect(workspaceRepositoryPaths("G:/wallet", groups, {}, [], hidden)).toBeUndefined();
});
