import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { SessionWorkspaceActions } from "../../src/features/workspaces/ui/SessionWorkspaceActions";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../src/shared/i18n";
import { setSessions } from "../../src/features/sessions/model/sessionsStore";
import type { Session } from "../../src/features/sessions/model/session";
import type {
  BranchDeliveryPlan,
  ManagedWorkspace,
} from "../../src/features/workspaces/model/contracts";
import "../../src/styles/index.css";

mockWindows("main");
const query = new URLSearchParams(location.search);
const cwd = "/fixture/session-project";
const machine = {
  id: "fixture-actions",
  environmentId: "fixture-actions-env",
  name: "Fixture",
  localHost: true,
  endpoint: "http://127.0.0.1:1",
};
let workspace: ManagedWorkspace = {
  id: "session-workspace",
  repositoryId: "fixture-repo",
  projectId: "fixture-project",
  environmentId: machine.environmentId,
  owner: { kind: "session", id: "session" },
  path: "/fixture/worktrees/wt-session",
  branchRef: "refs/heads/bycoda/s/compact-review-a1b2c3d4e5f6",
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  state: query.has("removed") ? "merged" : "finished",
  directoryState: query.has("removed") ? "removed" : "present",
  revision: 3,
  lastActivityAt: 1,
  pinned: false,
};
const calls: { method: string; params: unknown }[] = [];
(window as unknown as { workspaceCalls: typeof calls }).workspaceCalls = calls;
const review = (action: "merge" | "publish", publication?: unknown) =>
  ({
    token: "sha-bound-review",
    expiresAt: Date.now() + 600000,
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    sourceBranchRef: workspace.branchRef,
    sourceHead: "b".repeat(40),
    targetBranchRef: workspace.targetBranchRef,
    targetHead: "a".repeat(40),
    targetStatusFingerprint: "target-status-fingerprint",
    commits: ["b".repeat(40)],
    changedPaths: ["src/features/example.tsx", "src/features/example.test.ts"],
    overlappingPaths: query.has("overlap") ? ["src/features/example.tsx"] : [],
    checks: [{ name: "Focused unit tests", status: "passed" }],
    visualEvidence: ["temp/verification/feature/light-800.png"],
    blockers: [],
    action,
    ...(action === "publish" ? { publication } : {}),
  }) as BranchDeliveryPlan;
mockIPC((command, payload) => {
  if (command === "managed_worktree_removal_plan" || command === "managed_worktree_removal_apply") {
    const method =
      command === "managed_worktree_removal_plan"
        ? "workspaces.cleanup.plan"
        : "workspaces.cleanup.apply";
    command = "remote_request";
    payload = { method, params: payload.request };
  }
  if (command.startsWith("plugin:event|")) return null;
  if (command === "local_host_connect") return machine;
  if (command === "remote_machines") return [machine];
  if (command === "remote_request") {
    const method = payload.method as string;
    const params = payload.params as Record<string, unknown>;
    calls.push({ method, params });
    if (method === "environment.describe")
      return {
        capabilities: [
          "workspaces.managed.v1",
          "workspaces.delivery.v1",
          "workspaces.pr-publication.v1",
          "workspaces.lifecycle.v1",
        ],
      };
    if (method === "projects.list") return [{ id: "fixture-project", cwd }];
    if (method === "workspaces.get") return workspace;
    if (method === "workspaces.delivery.review")
      return review(params.action as "merge" | "publish", params.publication);
    if (method === "workspaces.delivery.merge") {
      workspace = { ...workspace, state: "merged", revision: workspace.revision + 1 };
      return {
        operationId: "merge",
        workspaceId: workspace.id,
        sourceHead: "b".repeat(40),
        previousTargetHead: "a".repeat(40),
        targetHead: "c".repeat(40),
        workspaceRevision: workspace.revision,
      };
    }
    if (method === "workspaces.delivery.publish")
      return {
        operationId: "publication",
        workspaceId: workspace.id,
        status: "complete",
        push: {
          remote: "origin",
          branchRef: workspace.branchRef,
          sourceHead: "b".repeat(40),
          pushedAt: Date.now(),
        },
        pullRequest: {
          repository: "fixture/repo",
          number: 42,
          url: "https://example.test/42",
          sourceHead: "b".repeat(40),
          createdAt: Date.now(),
        },
      };
    if (
      method === "workspaces.finish" ||
      method === "workspaces.close" ||
      method === "workspaces.resume"
    ) {
      workspace = {
        ...workspace,
        state:
          method === "workspaces.finish"
            ? "finished"
            : method === "workspaces.close"
              ? "abandoned"
              : "idle",
        directoryState: "present",
        revision: workspace.revision + 1,
      };
      return workspace;
    }
    if (method === "workspaces.cleanup.plan")
      return {
        token: "cleanup-plan",
        expiresAt: Date.now() + 600000,
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        path: workspace.path,
        branchRef: workspace.branchRef,
        head: "b".repeat(40),
        statusFingerprint: "clean-source",
        dirty: false,
        preservationRequired: false,
        blockers: [],
        links: [{ path: "node_modules", kind: "dependencyJunction" }],
      };
    if (method === "workspaces.cleanup.apply") {
      workspace = { ...workspace, directoryState: "removed", revision: workspace.revision + 1 };
      return {
        operationId: "cleanup",
        workspaceId: workspace.id,
        directoryState: "removed",
        workspaceRevision: workspace.revision,
        retainedBranchRef: workspace.branchRef,
        recoveryIds: ["rescue"],
      };
    }
    if (method === "workspaces.cleanup.status") return { workspace, operations: [] };
    throw new Error(`Unmocked workspace action: ${method}`);
  }
  if (command === "git_commit_files")
    return [
      {
        path: `${workspace.path}/src/features/example.tsx`,
        relative: "src/features/example.tsx",
        status: "modified",
      },
    ];
  if (command === "git_commit_file_diff")
    return {
      path: "src/features/example.tsx",
      relative: "src/features/example.tsx",
      status: "modified",
      original: "export const mode = 'current';\n",
      current: "export const mode = 'worktree';\n",
      binary: false,
      tooLarge: false,
    };
  if (command === "session_upsert") return null;
  return null;
});
setSessions([
  {
    id: "session",
    title: "Review workspace changes",
    cwd,
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    worktreeCwd: workspace.path,
    worktreeRemoved: workspace.directoryState === "removed",
    blocks: [],
    busy: false,
    harness: "claude",
    model: "sonnet",
    modelSettings: {},
    runtimeMode: "supervised",
  } as Session,
]);
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");
void setLanguagePreference("en").then(() =>
  createRoot(document.getElementById("root")!).render(
    <main className="min-h-screen bg-(--ui-surface) p-6 text-(--ui-text)">
      <div className="mx-auto grid max-w-4xl gap-6">
        <h1 className="text-lg font-medium">Workspace conversation</h1>
        <p>The conversation remains readable after its worktree directory is deleted.</p>
        <SessionWorkspaceActions sessionId="session" cwd={cwd} />
        <article className="border-t border-(--ui-border) py-4">
          <h2 className="font-medium">Assistant</h2>
          <p>
            Implementation and focused checks are complete. Review the committed changes to approve
            delivery.
          </p>
        </article>
      </div>
    </main>,
  ),
);
