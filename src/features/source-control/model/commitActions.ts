import type { GitHistoryCommit, GitRemote, GitResetMode } from "../../../platform/tauri/fs";
import type { ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { t } from "../../../shared/i18n/git";

export type CommitAction =
  | "open-changes"
  | "blame"
  | "github"
  | "checkout"
  | "branch"
  | "tag"
  | "cherry-pick"
  | "revert"
  | `reset-${GitResetMode}`
  | "copy-sha"
  | "copy-message";

/** Context menu for one graph row, with mutations disabled during an operation. */
export function commitMenuItems(
  commit: GitHistoryCommit,
  mutationsDisabled = false,
): ExplorerMenuItem[] {
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "open-changes", label: "Open Changes" },
    { kind: "item", id: "blame", label: "Open in Blame" },
    { kind: "item", id: "github", label: "Open on GitHub" },
    { kind: "sep" },
    {
      kind: "item",
      id: "checkout",
      label: "Checkout (Detached)",
      disabled: mutationsDisabled,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "branch",
      label: "Create Branch…",
      disabled: mutationsDisabled,
    },
    {
      kind: "item",
      id: "tag",
      label: "Create Tag…",
      disabled: mutationsDisabled,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "cherry-pick",
      label: "Cherry-Pick",
      disabled: commit.head || mutationsDisabled,
    },
    {
      kind: "item",
      id: "revert",
      label: "Revert Commit",
      disabled: mutationsDisabled,
    },
    {
      kind: "item",
      id: "reset",
      label: "Reset Current Branch to Here",
      disabled: commit.head || mutationsDisabled,
      submenu: [
        {
          kind: "item",
          id: "reset-soft",
          label: "Soft",
          description: "Keep changes staged",
        },
        {
          kind: "item",
          id: "reset-mixed",
          label: "Mixed",
          description: "Keep changes unstaged",
        },
        {
          kind: "item",
          id: "reset-hard",
          label: "Hard",
          description: "Discard all changes",
          danger: true,
        },
      ],
    },
    { kind: "sep" },
    { kind: "item", id: "copy-sha", label: "Copy Commit ID" },
    { kind: "item", id: "copy-message", label: "Copy Commit Message" },
  ];
  return items.map((item) =>
    item.kind === "sep"
      ? item
      : {
          ...item,
          label: t(item.label),
          submenu: item.submenu?.map((child) =>
            child.kind === "sep"
              ? child
              : {
                  ...child,
                  label: t(child.label),
                  description: child.description ? t(child.description) : undefined,
                },
          ),
        },
  );
}

/** Only repository URLs on GitHub can become an external commit link. */
export function githubCommitUrl(remotes: GitRemote[], sha: string): string | null {
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) return null;
  const ordered = [...remotes].sort(
    (a, b) => Number(b.name === "origin") - Number(a.name === "origin"),
  );
  for (const remote of ordered) {
    const value = remote.url.trim();
    const scp = /^git@github\.com:([^?#]+)$/i.exec(value);
    let path: string;
    if (scp) path = scp[1];
    else {
      try {
        const url = new URL(value);
        if (
          url.hostname.toLowerCase() !== "github.com" ||
          !["https:", "http:", "ssh:"].includes(url.protocol)
        )
          continue;
        path = url.pathname.slice(1);
      } catch {
        continue;
      }
    }
    const match = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(path);
    if (match && ![match[1], match[2]].some((part) => part === "." || part === ".."))
      return `https://github.com/${match[1]}/${match[2]}/commit/${sha}`;
  }
  return null;
}

/** Commits whose subject, author, ref name, or id contains the query. */
export function filterHistory(commits: GitHistoryCommit[], query: string): GitHistoryCommit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commits;
  return commits.filter(
    (commit) =>
      commit.subject.toLowerCase().includes(needle) ||
      commit.author.toLowerCase().includes(needle) ||
      commit.sha.toLowerCase().startsWith(needle) ||
      commit.refs.some((ref) => ref.name.toLowerCase().includes(needle)),
  );
}

const OPERATION_LABELS = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
} as const;

export function operationLabel(operation: keyof typeof OPERATION_LABELS): string {
  return OPERATION_LABELS[operation];
}
