import { createRoot } from "react-dom/client";
import { GitHistoryGraph } from "../../src/features/source-control/ui/GitHistoryGraph";
import { GitGraphWorkspace } from "../../src/features/source-control/ui/GitGraphWorkspace";
import { WorkspaceSourceControl } from "../../src/features/source-control/ui/WorkspaceSourceControl";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import "../../src/styles/index.css";
// Eagerly include the workspace in fixture discovery so Vite optimizes its
// desktop dependencies before the scenario opens the lazy production surface.
void GitGraphWorkspace;

// This fixture exercises the actual UI against a deterministic desktop bridge.
// No user repository or remote is changed by these scenarios.
const sha = (n: number) => n.toString(16).padStart(40, "0");
const commits = Array.from({ length: 40 }, (_, n) => ({
  sha: sha(40 - n),
  shortSha: sha(40 - n).slice(-7),
  parents: n === 39 ? [] : [sha(39 - n)],
  subject: n === 0 ? "Improve workspace navigation" : `Workspace change ${40 - n}`,
  author: n % 2 ? "Deniz Yılmaz" : "Bahar Kaya",
  timestamp: 1791567000 - n * 3600,
  head: n === 0,
  refs:
    n === 0
      ? [
          { name: "main", kind: "local" },
          { name: "origin/main", kind: "remote" },
        ]
      : n === 3
        ? [{ name: "feature/graph", kind: "local" }]
        : [],
}));
let branches = [
  { name: "main", current: true, remote: null },
  { name: "feature/graph", current: false, remote: null },
  { name: "develop", current: false, remote: null },
  { name: "main", current: false, remote: "origin" },
  { name: "feature/team", current: false, remote: "origin" },
];
const file = (relative: string, staged = false) => ({
  relative,
  path: `/fixture/${relative}`,
  status: "modified",
  additions: 4,
  deletions: 2,
  staged,
  unstaged: !staged,
});
let files = [file("src/workspace.tsx"), file("src/theme.css"), file("README.md", true)];
let conflicts = new URLSearchParams(location.search).has("conflict")
  ? [
      {
        path: "/fixture/src/conflict.ts",
        relative: "src/conflict.ts",
        kind: "both-modified",
      },
    ]
  : [];
let operation: string | null = conflicts.length ? "merge" : null;
let disk =
  "<<<<<<< HEAD\nconst theme = 'dark';\n=======\nconst theme = 'light';\n>>>>>>> feature/theme\n";
const calls: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, {
  gitFixtureCalls: calls,
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "git_history") return { head: commits[0].sha, commits };
      if (command === "git_branches")
        return {
          current: branches.find((b) => b.current)?.name,
          detached: false,
          branches,
        };
      if (command === "git_diff_index" || command === "git_diff_files")
        return {
          repository: true,
          branch: new URLSearchParams(location.search).has("checkouts")
            ? checkoutTrees[String(args.cwd)]?.branch
            : branches.find((b) => b.current)?.name,
          head: new URLSearchParams(location.search).has("checkouts")
            ? checkoutTrees[String(args.cwd)]?.head
            : commits[0].sha,
          files,
          conflicts,
          operation,
          additions: 12,
          deletions: 6,
          remote: "origin",
          upstream: "origin/main",
          defaultBranch: "main",
          ahead: 2,
          behind: 1,
          headPushed: false,
          aheadOfDefault: 2,
        };
      if (command === "git_commit_files") return [file("src/workspace.tsx"), file("src/theme.css")];
      if (command === "git_commit_message") return "Workspace change 39\n\nFull commit body.\n";
      if (command === "git_blame")
        return [
          {
            line: 1,
            sha: args.sha,
            shortSha: "0000027",
            author: "Deniz Yılmaz",
            timestamp: 1791567000,
            summary: "Workspace change 39",
          },
          {
            line: 2,
            sha: args.sha,
            shortSha: "0000027",
            author: "Deniz Yılmaz",
            timestamp: 1791567000,
            summary: "Workspace change 39",
          },
        ];
      if (command === "git_remotes")
        return [{ name: "origin", url: "git@github.com:fixture/workspace.git" }];
      if (command === "git_file_diff" || command === "git_commit_file_diff")
        return {
          ...file(String(args.relative)),
          original: `// ${args.relative}\nconst before = true;\n`,
          current: `// ${args.relative}\nconst after = true;\n`,
          binary: false,
          tooLarge: false,
        };
      if (command === "git_stash_list")
        return [
          {
            index: 0,
            sha: sha(45),
            message: "WIP: keyboard navigation",
            timestamp: 1791566500,
          },
        ];
      if (command === "git_checkout") {
        branches = branches.map((b) => ({
          ...b,
          current: b.name === args.name && !b.remote,
        }));
        return args.name;
      }
      if (command === "git_create_branch_from" || command === "git_create_branch_at") {
        branches = branches.map((b) => ({ ...b, current: false }));
        branches.push({ name: String(args.name), current: true, remote: null });
        return args.name;
      }
      if (command === "git_stage_all") {
        files = files.map((f) => ({ ...f, staged: true, unstaged: false }));
        return;
      }
      if (command === "git_unstage_all") {
        files = files.map((f) => ({ ...f, staged: false, unstaged: true }));
        return;
      }
      if (command === "git_stash") {
        files = [];
        return;
      }
      if (command === "git_delete_branch") {
        branches = branches.filter((b) => b.remote || b.name !== args.name);
        return;
      }
      if (command === "git_delete_remote_branch") {
        branches = branches.filter((b) => b.remote !== args.remote || b.name !== args.name);
        return;
      }
      if (command === "git_stage_file") {
        conflicts = conflicts.filter((f) => f.relative !== args.relative);
        files = files.map((f) =>
          f.relative === args.relative ? { ...f, staged: true, unstaged: false } : f,
        );
        return;
      }
      if (command === "git_conflict_stages")
        return {
          relative: args.relative,
          path: "/fixture/src/conflict.ts",
          kind: "both-modified",
          base: "const theme = 'system';\n",
          ours: "const theme = 'dark';\n",
          theirs: "const theme = 'light';\n",
          binary: false,
          tooLarge: false,
        };
      if (command === "read_text_file") return disk;
      if (command === "write_text_file") {
        disk = String(args.content);
        return;
      }
      if (command === "git_resolve_conflict") {
        conflicts = [];
        return;
      }
      if (command === "git_operation_continue" || command === "git_operation_abort") {
        operation = null;
        return;
      }
      if (command === "git_operation_state") return operation;
      if (command === "git_conflicts") return conflicts.map((f) => f.relative);
      if (command === "git_pr_status") return null;
      if (command === "git_head_message") return "Improve workspace navigation";
      if (command === "git_tags" || command === "stat_files") return [];
      if (command === "plugin:dialog|ask" || command === "plugin:dialog|confirm") return true;
      if (command === "plugin:dialog|message") {
        const buttons = args.buttons as { OkCancelCustom?: string[] } | undefined;
        return buttons?.OkCancelCustom?.[0] ?? "Yes";
      }
      if (command === "plugin:event|listen") return 1;
      return null;
    },
  },
});
document.body.style.cssText =
  "height:100vh;margin:0;background:var(--color-background-base);color:var(--color-content)";
const checkoutTrees: Record<string, Worktree> = Object.fromEntries(
  ["/fixture", "/trees/audit/very-long-worktree-folder-name", "/trees/detached"].map(
    (path, index) => [
      path,
      {
        path,
        branch:
          index === 0
            ? "main"
            : index === 1
              ? "audit/2026-10-14-long-branch-name-for-responsive-review"
              : null,
        head: "fd3caac123456",
        isMain: index === 0,
        locked: false,
        prunable: false,
        missing: false,
        dirty: true,
        unpushed: 1,
        sessionIds: [],
      },
    ],
  ),
);
createRoot(document.getElementById("root")!).render(
  <div
    className={
      new URLSearchParams(location.search).has("checkouts")
        ? "h-screen w-full max-w-[520px] border-r border-stroke"
        : "h-screen w-80 border-r border-stroke"
    }
  >
    {new URLSearchParams(location.search).has("checkouts") ? (
      <WorkspaceSourceControl
        cwd="/fixture"
        paths={Object.keys(checkoutTrees)}
        worktrees={checkoutTrees}
        labels={Object.fromEntries(
          Object.values(checkoutTrees).map((tree) => [
            tree.path,
            `${tree.branch ?? "Detached"} · ${tree.path}`,
          ]),
        )}
        checkouts
        enabled
        onOpen={() => {}}
      />
    ) : (
      <GitHistoryGraph
        cwd="/fixture"
        enabled
        expanded
        onToggleExpanded={() => {}}
        onOpenCommit={() => {
          throw new Error("Workspace selections must stay in the graph");
        }}
      />
    )}
  </div>,
);
