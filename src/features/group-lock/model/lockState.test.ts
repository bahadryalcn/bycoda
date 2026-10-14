// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import type { ProjectGroup } from "../../projects/model/projectGroups";
import {
  computeLockSnapshot,
  initialUnlocked,
  isProjectLockedIn,
  lockReducer,
  visibleProjects,
} from "./lockState";

const groups: ProjectGroup[] = [
  { id: "a", name: "A", collapsed: false, lockable: true },
  { id: "b", name: "B", collapsed: false, lockable: true },
  { id: "c", name: "C", collapsed: false },
];
const assignments = {
  [pathKey("/work/one")]: "a",
  [pathKey("/work/two")]: "b",
  [pathKey("/work/three")]: "c",
};

function snapshotWith(hasPassword: boolean, unlocked: string[]) {
  return computeLockSnapshot({
    groups,
    assignments,
    hasPassword,
    unlocked: new Set(unlocked),
  });
}

describe("lock state reducer", () => {
  it("unlocks and locks groups independently", () => {
    let state = lockReducer(new Set(), {
      type: "unlock",
      groupIds: ["a", "b"],
    });
    expect([...state]).toEqual(["a", "b"]);
    state = lockReducer(state, { type: "lock", groupIds: ["a"] });
    expect([...state]).toEqual(["b"]);
    expect(lockReducer(state, { type: "lockAll" }).size).toBe(0);
    expect([...lockReducer(state, { type: "replace", groupIds: ["x"] })]).toEqual(["x"]);
  });

  it("starts everything locked when locking again at launch", () => {
    expect(initialUnlocked(true, ["a"]).size).toBe(0);
    expect([...initialUnlocked(false, ["a"])]).toEqual(["a"]);
  });
});

describe("lock snapshot", () => {
  it("protects a workspace root without requiring a persisted member assignment", () => {
    const inputs = {
      groups: [
        {
          id: "wallet",
          name: "Wallet",
          collapsed: false,
          lockable: true,
          workspaceFile: "G:/wallet/wallet.code-workspace",
        },
      ],
      assignments: {},
      hasPassword: true,
      unlocked: new Set<string>(),
    };
    expect(isProjectLockedIn(computeLockSnapshot(inputs), "g:\\WALLET")).toBe(true);
    expect(
      isProjectLockedIn(
        computeLockSnapshot({ ...inputs, unlocked: new Set(["wallet"]) }),
        "G:/wallet",
      ),
    ).toBe(false);
    expect(
      isProjectLockedIn(
        computeLockSnapshot({ ...inputs, hasPassword: false, hiddenGroupIds: new Set(["wallet"]) }),
        "G:/wallet",
      ),
    ).toBe(true);
  });
  it("locks lockable groups that are not unlocked", () => {
    const snapshot = snapshotWith(true, ["b"]);
    expect([...snapshot.lockedGroupIds]).toEqual(["a"]);
    expect(isProjectLockedIn(snapshot, "/work/one")).toBe(true);
    expect(isProjectLockedIn(snapshot, "/work/two")).toBe(false);
    // A group that is not lockable never hides anything.
    expect(isProjectLockedIn(snapshot, "/work/three")).toBe(false);
    expect(isProjectLockedIn(snapshot, "/elsewhere")).toBe(false);
  });

  it("locks nothing without a password", () => {
    expect(snapshotWith(false, []).lockedProjectKeys.size).toBe(0);
  });

  it("matches paths the way the rail does", () => {
    expect(isProjectLockedIn(snapshotWith(true, []), "/work/one/")).toBe(true);
  });

  it("filters lists down to what is visible", () => {
    const items = [
      { path: "/work/one" },
      { path: "/work/two" },
      { path: "/work/three" },
      { path: "/other" },
    ];
    expect(
      visibleProjects(snapshotWith(true, []), items, (item) => item.path).map((item) => item.path),
    ).toEqual(["/work/three", "/other"]);
  });
});
