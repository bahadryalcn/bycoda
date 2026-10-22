import type { GitOperation } from "../../../platform/tauri/fs";
import type { ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { operationLabel } from "./commitActions";

/** What the Changes header menu needs to know to enable and label its items. */
export type GitMenuState = {
  /** The whole menu is available: this computer, or a machine whose host has
   * `git.actions`. Otherwise only Pull is. */
  actions: boolean;
  /** Why the rest is missing when the machine's host is too old to run it. */
  updateNotice?: string | null;
  /** Another git action is already running. */
  busy: boolean;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  /** HEAD points at a commit (false in a fresh repository). */
  hasCommits: boolean;
  hasRemote: boolean;
  hasUpstream: boolean;
  /** Commits not yet pushed to the upstream. */
  ahead: number;
  stagedCount: number;
  unstagedCount: number;
  /** Files with any change, staged or not. */
  changedCount: number;
  operation: GitOperation | null;
  /** Branches other than the current one, local and remote. */
  otherBranchCount: number;
  /** Local branches other than the current one. */
  otherLocalBranchCount: number;
  stashCount: number;
  tagCount: number;
  remoteCount: number;
  autoFetch: boolean;
};

export type CommitMenuOptions = {
  /**
   * `smart` commits what is staged, or stages everything first when nothing is.
   * `staged` commits the index only. `all` stages everything, then commits.
   */
  scope: "smart" | "staged" | "all";
  amend: boolean;
  signoff: boolean;
};

const COMMIT_OPTIONS: Record<string, CommitMenuOptions> = {
  commit: { scope: "smart", amend: false, signoff: false },
  "commit-staged": { scope: "staged", amend: false, signoff: false },
  "commit-all": { scope: "all", amend: false, signoff: false },
  amend: { scope: "smart", amend: true, signoff: false },
  "amend-staged": { scope: "staged", amend: true, signoff: false },
  "amend-all": { scope: "all", amend: true, signoff: false },
  signoff: { scope: "smart", amend: false, signoff: true },
  "signoff-staged": { scope: "staged", amend: false, signoff: true },
  "signoff-all": { scope: "all", amend: false, signoff: true },
};

/** How a Commit submenu item commits, or null for any other menu item. */
export function commitMenuOptions(id: string): CommitMenuOptions | null {
  return Object.prototype.hasOwnProperty.call(COMMIT_OPTIONS, id) ? COMMIT_OPTIONS[id]! : null;
}

type Entry = Extract<ExplorerMenuItem, { kind: "item" }>;
type SubEntry = NonNullable<Entry["submenu"]>[number];

const SEP = { kind: "sep" } as const;

function entry(id: string, label: string, enabled: boolean, extra: Partial<Entry> = {}): Entry {
  return { kind: "item", id, label, disabled: !enabled, ...extra };
}

function group(id: string, label: string, items: SubEntry[]): Entry {
  return { kind: "item", id, label, submenu: items };
}

/** Everything is off while another git action runs, except the Auto Fetch setting. */
function lock(items: ExplorerMenuItem[]): ExplorerMenuItem[] {
  return items.map((item): ExplorerMenuItem => {
    if (item.kind === "sep" || item.id === "auto-fetch") return item;
    if (!item.submenu) return { ...item, disabled: true };
    return {
      ...item,
      disabled: true,
      submenu: item.submenu.map((sub) => (sub.kind === "sep" ? sub : { ...sub, disabled: true })),
    };
  });
}

/** The header "…" menu: top-level sync actions, grouped submenus, then Auto Fetch. */
export function gitActionsMenuItems(state: GitMenuState): ExplorerMenuItem[] {
  const hasBranch = state.branch !== null;
  const canPull = state.hasRemote && state.hasUpstream;
  const canPush = state.hasRemote && hasBranch && (!state.hasUpstream || state.ahead > 0);
  const canFetch = state.hasRemote;
  const hasChanges = state.changedCount > 0;
  const hasStaged = state.stagedCount > 0;
  const hasStash = state.stashCount > 0;

  const pull = entry("pull", "Pull", canPull);
  if (!state.actions) {
    const limited: ExplorerMenuItem[] = state.updateNotice
      ? [
          pull,
          SEP,
          entry("host-update", "More actions need a newer bycoda Host", false, {
            description: state.updateNotice,
          }),
        ]
      : [pull];
    return state.busy ? lock(limited) : limited;
  }

  const items: ExplorerMenuItem[] = [
    pull,
    entry("push", "Push", canPush),
    entry("checkout", "Checkout to…", true),
    entry("fetch", "Fetch", canFetch),
    SEP,
    group("commit-menu", "Commit", [
      entry("commit", "Commit", hasChanges),
      entry("commit-staged", "Commit Staged", hasStaged),
      entry("commit-all", "Commit All", hasChanges),
      entry("undo-commit", "Undo Last Commit", state.hasCommits),
      entry(
        "abort-operation",
        state.operation ? `Abort ${operationLabel(state.operation)}` : "Abort Operation",
        state.operation !== null,
      ),
      SEP,
      entry("amend", "Commit (Amend)", state.hasCommits),
      entry("amend-staged", "Commit Staged (Amend)", state.hasCommits),
      entry("amend-all", "Commit All (Amend)", state.hasCommits),
      SEP,
      entry("signoff", "Commit (Signed Off)", hasChanges),
      entry("signoff-staged", "Commit Staged (Signed Off)", hasStaged),
      entry("signoff-all", "Commit All (Signed Off)", hasChanges),
    ]),
    group("changes-menu", "Changes", [
      entry("stage-all", "Stage All Changes", state.unstagedCount > 0),
      entry("unstage-all", "Unstage All Changes", hasStaged),
      entry("discard-all", "Discard All Changes", state.unstagedCount > 0, {
        danger: true,
      }),
    ]),
    group("sync-menu", "Pull, Push", [
      entry("sync", "Sync", state.hasRemote && hasBranch),
      entry("pull", "Pull", canPull),
      entry("pull-rebase", "Pull (Rebase)", canPull),
      entry("push", "Push", canPush),
      SEP,
      entry("fetch", "Fetch", canFetch),
      entry("fetch-prune", "Fetch (Prune)", canFetch),
    ]),
    group("branch-menu", "Branch", [
      entry("branch-merge", "Merge Branch…", hasBranch && state.otherBranchCount > 0),
      entry("branch-rebase", "Rebase Branch…", hasBranch && state.otherBranchCount > 0),
      SEP,
      entry("branch-create", "Create Branch…", true),
      entry("branch-create-from", "Create Branch From…", state.hasCommits),
      SEP,
      entry("branch-rename", "Rename Branch…", hasBranch),
      entry("branch-delete", "Delete Branch…", state.otherLocalBranchCount > 0),
      SEP,
      entry("branch-publish", "Publish Branch", state.hasRemote && hasBranch && !state.hasUpstream),
    ]),
    group("remote-menu", "Remote", [
      entry("remote-add", "Add Remote…", true),
      entry("remote-remove", "Remove Remote…", state.remoteCount > 0),
    ]),
    group("stash-menu", "Stash", [
      entry("stash", "Stash", hasChanges),
      entry("stash-untracked", "Stash (Include Untracked)", hasChanges),
      entry("stash-staged", "Stash Staged", hasStaged),
      SEP,
      entry("stash-apply-latest", "Apply Latest Stash", hasStash),
      entry("stash-apply", "Apply Stash…", hasStash),
      SEP,
      entry("stash-pop-latest", "Pop Latest Stash", hasStash),
      entry("stash-pop", "Pop Stash…", hasStash),
      SEP,
      entry("stash-drop", "Drop Stash…", hasStash),
      entry("stash-drop-all", "Drop All Stashes…", hasStash, { danger: true }),
      SEP,
      entry("stash-view", "View Stash…", hasStash),
    ]),
    group("tags-menu", "Tags", [
      entry("tag-create", "Create Tag…", state.hasCommits),
      entry("tag-delete", "Delete Tag…", state.tagCount > 0),
    ]),
    SEP,
    entry("auto-fetch", "Auto Fetch", canFetch, { checked: state.autoFetch }),
  ];
  return state.busy ? lock(items) : items;
}
