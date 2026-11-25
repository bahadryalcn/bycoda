import type { GitHistoryCommit, GitRemote, GitResetMode } from "../../../platform/tauri/fs";
import type { ExplorerMenuItem } from "../../files";
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
  return [
    { kind: "item", id: "open-changes", label: t("Open changes") },
    { kind: "item", id: "blame", label: t("Open in blame") },
    { kind: "item", id: "github", label: t("Open on GitHub") },
    { kind: "sep" },
    {
      kind: "item",
      id: "checkout",
      label: t("Checkout (Detached)"),
      disabled: mutationsDisabled,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "branch",
      label: t("Create branch…"),
      disabled: mutationsDisabled,
    },
    {
      kind: "item",
      id: "tag",
      label: t("Create Tag…"),
      disabled: mutationsDisabled,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "cherry-pick",
      label: t("Cherry-Pick"),
      disabled: commit.head || mutationsDisabled,
    },
    {
      kind: "item",
      id: "revert",
      label: t("Revert Commit"),
      disabled: mutationsDisabled,
    },
    {
      kind: "item",
      id: "reset",
      label: t("Reset Current Branch to Here"),
      disabled: commit.head || mutationsDisabled,
      submenu: [
        {
          kind: "item",
          id: "reset-soft",
          label: t("Soft"),
          description: t("Keep changes staged"),
        },
        {
          kind: "item",
          id: "reset-mixed",
          label: t("Mixed"),
          description: t("Keep changes unstaged"),
        },
        {
          kind: "item",
          id: "reset-hard",
          label: t("Hard"),
          description: t("Discard all changes"),
          danger: true,
        },
      ],
    },
    { kind: "sep" },
    { kind: "item", id: "copy-sha", label: t("Copy Commit ID") },
    { kind: "item", id: "copy-message", label: t("Copy Commit Message") },
  ];
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

export function operationLabel(operation: "merge" | "rebase" | "cherry-pick" | "revert"): string {
  switch (operation) {
    case "rebase":
      return t("Rebase");
    case "cherry-pick":
      return t("Cherry-pick");
    case "revert":
      return t("Revert");
    case "merge":
      return t("Merge");
  }
}
