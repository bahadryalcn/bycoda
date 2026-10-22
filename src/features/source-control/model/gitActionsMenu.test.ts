import { describe, expect, it } from "vitest";
import type { ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { commitMenuOptions, gitActionsMenuItems, type GitMenuState } from "./gitActionsMenu";

function state(overrides: Partial<GitMenuState> = {}): GitMenuState {
  return {
    actions: true,
    busy: false,
    branch: "main",
    hasCommits: true,
    hasRemote: true,
    hasUpstream: true,
    ahead: 0,
    stagedCount: 0,
    unstagedCount: 0,
    changedCount: 0,
    operation: null,
    otherBranchCount: 2,
    otherLocalBranchCount: 1,
    stashCount: 0,
    tagCount: 0,
    remoteCount: 1,
    autoFetch: false,
    ...overrides,
  };
}

type Flat = { id: string; label: string; disabled: boolean; path: string };

/** Every selectable item, submenus flattened as `parent/id`. */
function flatten(items: ExplorerMenuItem[], prefix = ""): Flat[] {
  return items.flatMap((item) => {
    if (item.kind === "sep") return [];
    const path = `${prefix}${item.id}`;
    const self = { id: item.id, label: item.label, disabled: !!item.disabled, path };
    return item.submenu ? [self, ...flatten(item.submenu, `${path}/`)] : [self];
  });
}

function disabled(overrides: Partial<GitMenuState> = {}): string[] {
  return flatten(gitActionsMenuItems(state(overrides)))
    .filter((item) => item.disabled)
    .map((item) => item.path);
}

function enabled(overrides: Partial<GitMenuState>, id: string): boolean {
  const found = flatten(gitActionsMenuItems(state(overrides))).find(
    (item) => item.path === id || item.id === id,
  );
  if (!found) throw new Error(`no menu item ${id}`);
  return !found.disabled;
}

describe("gitActionsMenuItems layout", () => {
  it("lists the top level in order, then the groups, then Auto Fetch", () => {
    const items = gitActionsMenuItems(state());
    expect(items.map((item) => (item.kind === "sep" ? "-" : item.id))).toEqual([
      "pull",
      "push",
      "checkout",
      "fetch",
      "-",
      "commit-menu",
      "changes-menu",
      "sync-menu",
      "branch-menu",
      "remote-menu",
      "stash-menu",
      "tags-menu",
      "-",
      "auto-fetch",
    ]);
  });

  it("gives Commit the grouped amend and signed-off variants", () => {
    const commit = gitActionsMenuItems(state()).find(
      (item) => item.kind === "item" && item.id === "commit-menu",
    );
    const labels = (commit?.kind === "item" ? (commit.submenu ?? []) : []).map((item) =>
      item.kind === "sep" ? "-" : item.label,
    );
    expect(labels).toEqual([
      "Commit",
      "Commit Staged",
      "Commit All",
      "Undo Last Commit",
      "Abort Operation",
      "-",
      "Commit (Amend)",
      "Commit Staged (Amend)",
      "Commit All (Amend)",
      "-",
      "Commit (Signed Off)",
      "Commit Staged (Signed Off)",
      "Commit All (Signed Off)",
    ]);
  });

  it("offers no force push anywhere", () => {
    const labels = flatten(gitActionsMenuItems(state())).map((item) => item.label);
    expect(labels.some((label) => /force/i.test(label))).toBe(false);
  });
});

describe("gitActionsMenuItems enabled state", () => {
  it("disables everything that needs changes in a clean repository", () => {
    expect(disabled()).toEqual([
      "push",
      "commit-menu/commit",
      "commit-menu/commit-staged",
      "commit-menu/commit-all",
      "commit-menu/abort-operation",
      "commit-menu/signoff",
      "commit-menu/signoff-staged",
      "commit-menu/signoff-all",
      "changes-menu/stage-all",
      "changes-menu/unstage-all",
      "changes-menu/discard-all",
      "sync-menu/push",
      "branch-menu/branch-publish",
      "stash-menu/stash",
      "stash-menu/stash-untracked",
      "stash-menu/stash-staged",
      "stash-menu/stash-apply-latest",
      "stash-menu/stash-apply",
      "stash-menu/stash-pop-latest",
      "stash-menu/stash-pop",
      "stash-menu/stash-drop",
      "stash-menu/stash-drop-all",
      "stash-menu/stash-view",
      "tags-menu/tag-delete",
    ]);
  });

  it("commits staged files only when something is staged", () => {
    const unstagedOnly = { changedCount: 1, unstagedCount: 1 };
    expect(enabled(unstagedOnly, "commit-menu/commit")).toBe(true);
    expect(enabled(unstagedOnly, "commit-menu/commit-all")).toBe(true);
    expect(enabled(unstagedOnly, "commit-menu/commit-staged")).toBe(false);
    expect(enabled(unstagedOnly, "stash-menu/stash-staged")).toBe(false);
    expect(enabled(unstagedOnly, "changes-menu/unstage-all")).toBe(false);

    const staged = { changedCount: 1, stagedCount: 1 };
    expect(enabled(staged, "commit-menu/commit-staged")).toBe(true);
    expect(enabled(staged, "commit-menu/signoff-staged")).toBe(true);
    expect(enabled(staged, "stash-menu/stash-staged")).toBe(true);
    expect(enabled(staged, "changes-menu/unstage-all")).toBe(true);
    expect(enabled(staged, "changes-menu/stage-all")).toBe(false);
    expect(enabled(staged, "changes-menu/discard-all")).toBe(false);
  });

  it("allows amending without changes but not before the first commit", () => {
    expect(enabled({}, "commit-menu/amend")).toBe(true);
    expect(enabled({}, "commit-menu/amend-staged")).toBe(true);
    expect(enabled({ hasCommits: false }, "commit-menu/amend")).toBe(false);
    expect(enabled({ hasCommits: false }, "commit-menu/undo-commit")).toBe(false);
    expect(enabled({ hasCommits: false }, "tags-menu/tag-create")).toBe(false);
    expect(enabled({ hasCommits: false }, "branch-menu/branch-create-from")).toBe(false);
  });

  it("enables Abort only for an operation in progress, and names it", () => {
    expect(enabled({}, "commit-menu/abort-operation")).toBe(false);
    const items = flatten(gitActionsMenuItems(state({ operation: "rebase" })));
    const abort = items.find((item) => item.id === "abort-operation");
    expect(abort).toMatchObject({ label: "Abort Rebase", disabled: false });
  });

  it("needs an upstream to pull and something to push", () => {
    expect(enabled({ hasUpstream: false }, "pull")).toBe(false);
    expect(enabled({ hasUpstream: false }, "sync-menu/pull-rebase")).toBe(false);
    expect(enabled({ hasRemote: false, hasUpstream: false }, "pull")).toBe(false);
    expect(enabled({ ahead: 0 }, "push")).toBe(false);
    expect(enabled({ ahead: 2 }, "push")).toBe(true);
    expect(enabled({ hasUpstream: false }, "push")).toBe(true);
    expect(enabled({ hasRemote: false, hasUpstream: false }, "push")).toBe(false);
    expect(enabled({ branch: null, hasUpstream: false }, "push")).toBe(false);
  });

  it("fetches and auto-fetches only with a remote", () => {
    for (const id of ["fetch", "sync-menu/fetch", "sync-menu/fetch-prune", "auto-fetch"]) {
      expect(enabled({}, id)).toBe(true);
      expect(enabled({ hasRemote: false, hasUpstream: false }, id)).toBe(false);
    }
    const raw = gitActionsMenuItems(state({ autoFetch: true })).at(-1);
    expect(raw).toMatchObject({ id: "auto-fetch", checked: true });
  });

  it("syncs from a branch with a remote, publishing a first push", () => {
    expect(enabled({}, "sync-menu/sync")).toBe(true);
    expect(enabled({ hasUpstream: false }, "sync-menu/sync")).toBe(true);
    expect(enabled({ branch: null }, "sync-menu/sync")).toBe(false);
    expect(enabled({ hasRemote: false, hasUpstream: false }, "sync-menu/sync")).toBe(false);
  });

  it("publishes only a branch that has no upstream", () => {
    expect(enabled({ hasUpstream: false }, "branch-menu/branch-publish")).toBe(true);
    expect(enabled({}, "branch-menu/branch-publish")).toBe(false);
    expect(enabled({ branch: null, hasUpstream: false }, "branch-menu/branch-publish")).toBe(false);
    expect(enabled({ hasRemote: false, hasUpstream: false }, "branch-menu/branch-publish")).toBe(
      false,
    );
  });

  it("handles a detached HEAD", () => {
    const detached = { branch: null, hasUpstream: false };
    expect(enabled(detached, "branch-menu/branch-merge")).toBe(false);
    expect(enabled(detached, "branch-menu/branch-rebase")).toBe(false);
    expect(enabled(detached, "branch-menu/branch-rename")).toBe(false);
    expect(enabled(detached, "branch-menu/branch-create")).toBe(true);
    expect(enabled(detached, "branch-menu/branch-create-from")).toBe(true);
    expect(enabled(detached, "checkout")).toBe(true);
    expect(enabled(detached, "commit-menu/amend")).toBe(true);
  });

  it("needs other branches to merge, rebase, or delete", () => {
    expect(enabled({ otherBranchCount: 0 }, "branch-menu/branch-merge")).toBe(false);
    expect(enabled({ otherBranchCount: 0 }, "branch-menu/branch-rebase")).toBe(false);
    expect(enabled({ otherLocalBranchCount: 0 }, "branch-menu/branch-delete")).toBe(false);
    expect(
      enabled({ otherBranchCount: 1, otherLocalBranchCount: 0 }, "branch-menu/branch-merge"),
    ).toBe(true);
  });

  it("needs a remote to remove and a tag to delete", () => {
    expect(enabled({ remoteCount: 0 }, "remote-menu/remote-remove")).toBe(false);
    expect(enabled({ remoteCount: 0 }, "remote-menu/remote-add")).toBe(true);
    expect(enabled({ tagCount: 1 }, "tags-menu/tag-delete")).toBe(true);
    expect(enabled({}, "tags-menu/tag-create")).toBe(true);
  });

  it("enables the stash actions once there is a stash", () => {
    for (const id of [
      "stash-apply-latest",
      "stash-apply",
      "stash-pop-latest",
      "stash-pop",
      "stash-drop",
      "stash-drop-all",
      "stash-view",
    ]) {
      expect(enabled({ stashCount: 1 }, `stash-menu/${id}`)).toBe(true);
    }
    expect(enabled({ changedCount: 1 }, "stash-menu/stash")).toBe(true);
    expect(enabled({ changedCount: 1 }, "stash-menu/stash-untracked")).toBe(true);
    expect(enabled({ changedCount: 1 }, "stash-menu/stash-apply")).toBe(false);
  });

  it("marks only the destructive entries dangerous", () => {
    const danger = flatten(gitActionsMenuItems(state()));
    const raw = gitActionsMenuItems(state()).flatMap((item) =>
      item.kind === "item" ? [item, ...(item.submenu ?? [])] : [],
    );
    expect(danger.length).toBeGreaterThan(0);
    expect(raw.flatMap((item) => (item.kind === "item" && item.danger ? [item.id] : []))).toEqual([
      "discard-all",
      "stash-drop-all",
    ]);
  });
});

describe("gitActionsMenuItems while busy", () => {
  it("disables every action but keeps the Auto Fetch setting reachable", () => {
    const everything = {
      changedCount: 2,
      stagedCount: 1,
      unstagedCount: 1,
      stashCount: 1,
      ahead: 1,
    };
    const items = flatten(gitActionsMenuItems(state({ ...everything, busy: true })));
    expect(items.filter((item) => !item.disabled).map((item) => item.id)).toEqual(["auto-fetch"]);
    // The same state is mostly enabled when idle, so the lock is doing the work.
    expect(
      flatten(gitActionsMenuItems(state(everything))).filter((item) => !item.disabled).length,
    ).toBeGreaterThan(20);
  });
});

describe("gitActionsMenuItems on a machine whose host lacks the actions", () => {
  it("explains why only Pull is offered", () => {
    const items = gitActionsMenuItems(state({ actions: false, updateNotice: "Update the host" }));
    expect(items.map((item) => (item.kind === "item" ? item.id : "-"))).toEqual([
      "pull",
      "-",
      "host-update",
    ]);
    expect(items[2]).toMatchObject({ disabled: true, description: "Update the host" });
    expect(
      gitActionsMenuItems(state({ actions: false, updateNotice: "x", busy: true })).every(
        (item) => item.kind === "sep" || item.disabled,
      ),
    ).toBe(true);
  });

  it("offers Pull alone", () => {
    const items = gitActionsMenuItems(state({ actions: false }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "pull", disabled: false });
    expect(gitActionsMenuItems(state({ actions: false, hasUpstream: false }))[0]).toMatchObject({
      disabled: true,
    });
    expect(gitActionsMenuItems(state({ actions: false, busy: true }))[0]).toMatchObject({
      disabled: true,
    });
  });
});

describe("commitMenuOptions", () => {
  it("maps each commit entry to scope, amend, and sign-off", () => {
    expect(commitMenuOptions("commit")).toEqual({ scope: "smart", amend: false, signoff: false });
    expect(commitMenuOptions("commit-staged")).toEqual({
      scope: "staged",
      amend: false,
      signoff: false,
    });
    expect(commitMenuOptions("commit-all")?.scope).toBe("all");
    expect(commitMenuOptions("amend-all")).toEqual({ scope: "all", amend: true, signoff: false });
    expect(commitMenuOptions("signoff-staged")).toEqual({
      scope: "staged",
      amend: false,
      signoff: true,
    });
  });

  it("ignores everything else", () => {
    expect(commitMenuOptions("pull")).toBeNull();
    expect(commitMenuOptions("undo-commit")).toBeNull();
    expect(commitMenuOptions("constructor")).toBeNull();
  });
});
