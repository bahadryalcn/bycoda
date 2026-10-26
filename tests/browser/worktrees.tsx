import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WorktreesPage } from "../../src/features/source-control/ui/WorktreesPage";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import { Modal } from "../../src/shared/ui/Modal";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";
import type {
  ManagedWorkspace,
  WorkspacePolicy,
} from "../../src/features/workspaces/model/contracts";

const query = new URLSearchParams(location.search);
const managed = query.has("managed");
const machine = {
  id: "workspace-fixture-machine",
  environmentId: "workspace-fixture-env",
  name: "Fixture Host",
  endpoint: "http://fixture.invalid",
  localHost: true,
};
const project = {
  id: "workspace-fixture-project",
  cwd: "/fixture/settings-project",
  name: "Settings project",
};
let policy: WorkspacePolicy = {
  defaultMode: "worktree",
  integrationBranchRef: "refs/heads/main",
  root: null,
  pinned: false,
  retention: {
    active: "never",
    idle: 14 * 86_400_000,
    finished: 7 * 86_400_000,
    merged: 86_400_000,
    abandoned: 7 * 86_400_000,
  },
  disk: {
    budgetBytes: 50 * 1_073_741_824,
    warningRatio: 0.8,
    minimumFreeBytes: 20 * 1_073_741_824,
  },
};
let revision = 1;
let workspaces: ManagedWorkspace[] = [
  {
    id: "managed-blocked",
    repositoryId: "repo",
    projectId: project.id,
    environmentId: machine.environmentId,
    owner: { kind: "session", id: "session-readable" },
    path: "/fixture/worktrees/wt-mc-851db1b6",
    branchRef: "refs/heads/bycoda/s/settings-draft",
    baseRef: "refs/heads/main",
    baseCommit: "a".repeat(40),
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "blocked",
    revision: 1,
    lastActivityAt: 1,
    pinned: true,
  },
  {
    id: "managed-merged",
    repositoryId: "repo",
    projectId: project.id,
    environmentId: machine.environmentId,
    owner: { kind: "task", id: "task-merged" },
    path: "/fixture/worktrees/wt-merged",
    branchRef: "refs/heads/bycoda/t/settings-reviewed",
    baseRef: "refs/heads/main",
    baseCommit: "a".repeat(40),
    targetBranchRef: "refs/heads/main",
    state: "merged",
    directoryState: "present",
    revision: 1,
    lastActivityAt: 1,
    pinned: false,
  },
];
const workspaceCalls: { method: string; params: Record<string, unknown> }[] = [];
Object.assign(window, { workspaceFixtureCalls: workspaceCalls });

// In-memory transport only. No owner host, filesystem or native deletion is reachable.
mockWindows("main");
const makeTree = (name: string, branch: string, state: Partial<Worktree> = {}): Worktree => ({
  path: `/fixture/worktrees/${name}`,
  branch,
  head: "abc1234",
  isMain: false,
  locked: false,
  missing: false,
  prunable: false,
  unpushed: 0,
  dirty: false,
  sessionIds: [],
  ...state,
});
const trees = [
  makeTree("settings-project", "main", { path: "/fixture/settings-project", isMain: true }),
  makeTree("fix-go-to-file-deleted-paths", "fix/go-to-file-deleted-paths"),
  makeTree("wt-mc-851db1b6", "mc/851db1b6", {
    dirty: true,
    unpushed: 1,
    sessionIds: ["one", "two"],
  }),
  makeTree("missing-worktree", "fix/missing", { missing: true, dirty: null }),
  makeTree("long-project-name-".repeat(6), "feature/" + "long-branch-name-".repeat(6), {
    locked: true,
  }),
];
mockIPC((command, args = {}) => {
  if (command.startsWith("plugin:event|")) return null;
  if (command === "git_worktrees") return { worktrees: trees, defaultRoot: "/fixture/worktrees" };
  if (command === "local_host_connect") return machine;
  if (command === "remote_machines") return [machine];
  if (command === "git_branches") return [];
  if (command === "remote_request") {
    const { method, params = {} } = args as { method: string; params?: Record<string, unknown> };
    workspaceCalls.push({ method, params: structuredClone(params) });
    if (method === "environment.describe")
      return {
        capabilities: managed
          ? [
              "workspaces.managed.v1",
              "workspaces.policy.v1",
              "workspaces.lifecycle.v1",
              "workspaces.delivery.v1",
              "workspaces.pr-publication.v1",
              ...(!query.has("noPinning") ? ["workspaces.pinning.v1"] : []),
            ]
          : [],
      };
    if (method === "projects.list") return [project];
    if (method === "workspaces.list") return structuredClone(workspaces);
    if (method === "workspaces.get")
      return structuredClone(workspaces.find((entry) => entry.id === params.workspaceId) ?? null);
    if (method === "workspaces.delivery.review") {
      const workspace = workspaces.find((entry) => entry.id === params.workspaceId)!;
      return {
        token: "fixture-owner-review",
        expiresAt: Date.now() + 600000,
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        sourceBranchRef: workspace.branchRef,
        sourceHead: "b".repeat(40),
        targetBranchRef: workspace.targetBranchRef,
        targetHead: "a".repeat(40),
        targetStatusFingerprint: "fixture-target",
        commits: [],
        changedPaths: ["src/example.ts"],
        overlappingPaths: [],
        artifacts: {
          paths: ["artifacts/acceptance.png"],
          hashes: { "artifacts/acceptance.png": "fixture-artifact-sha256" },
          sourceFingerprint: "fixture-source",
          targetFingerprint: "fixture-target",
          targetHashes: { "artifacts/acceptance.png": null },
          blockers: [],
        },
        checks: [],
        visualEvidence: [],
        blockers: [],
        action: params.action,
        ...(params.action === "publish" ? { publication: params.publication } : {}),
      };
    }
    if (method === "workspaces.delivery.merge") {
      const workspace = workspaces[0];
      workspace.state = "merged";
      ++workspace.revision;
      return structuredClone(workspace);
    }
    if (method === "workspaces.pin") {
      const workspace = workspaces.find((entry) => entry.id === params.workspaceId)!;
      if (workspace.revision !== params.expectedRevision)
        throw new Error("Workspace revision moved");
      workspace.pinned = params.pinned === true;
      ++workspace.revision;
      return structuredClone(workspace);
    }
    if (method === "projects.workspacePolicy.get")
      return {
        revision,
        resolved: { policy: structuredClone(policy), appliedScopes: ["host", "project"] },
      };
    if (method === "projects.workspacePolicy.update") {
      if (query.has("saveError"))
        throw new Error("Fixture policy save failed. Retry after reconnecting.");
      const next = params.policy as Partial<WorkspacePolicy>;
      policy = { ...policy, ...next };
      ++revision;
      return {
        revision,
        resolved: { policy: structuredClone(policy), appliedScopes: ["host", "project"] },
      };
    }
    if (method === "workspaces.storage.status")
      return {
        root: "/fixture/worktrees",
        materializedBytes: 42 * 1_073_741_824,
        sharedCacheBytes: 8 * 1_073_741_824,
        recoveryBytes: null,
        freeBytes: 18 * 1_073_741_824,
        budgetBytes: policy.disk.budgetBytes,
        warningRatio: policy.disk.warningRatio,
        minimumFreeBytes: policy.disk.minimumFreeBytes,
        materialization: "paused",
        requiredFreeBytes: 2 * 1_073_741_824,
      };
    if (method === "workspaces.cleanup.plan") {
      const workspace = workspaces.find((entry) => entry.id === params.workspaceId)!;
      return {
        token: "fingerprint-bound-cleanup",
        expiresAt: Date.now() + 60_000,
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        path: workspace.path,
        branchRef: workspace.branchRef,
        head: "b".repeat(40),
        statusFingerprint: "dirty-status-1",
        dirty: workspace.directoryState === "blocked",
        preservationRequired: workspace.directoryState === "blocked",
        blockers: query.has("hardBlock")
          ? ["An editor still has unsaved changes. Close it before retrying."]
          : [],
        links: [],
      };
    }
    if (method === "workspaces.cleanup.apply") {
      if (params.planToken !== "fingerprint-bound-cleanup") throw new Error("Unreviewed cleanup");
      const workspace = workspaces.find((entry) => entry.id === params.workspaceId)!;
      workspace.directoryState = "removed";
      ++workspace.revision;
      return {
        operationId: "cleanup-1",
        workspaceId: workspace.id,
        directoryState: "removed",
        workspaceRevision: workspace.revision,
        retainedBranchRef: workspace.branchRef,
        recoveryIds: ["recovery-1"],
      };
    }
    if (method === "workspaces.cleanup.status")
      return {
        workspace: workspaces.find((entry) => entry.id === params.workspaceId),
        operations: [],
      };
    throw new Error(`Unmocked workspace method: ${method}`);
  }
  throw new Error(`Unmocked worktree fixture command: ${command}`);
});
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
);
void Promise.all([setLanguagePreference("en"), setDomainLanguagePreference("git", "app")]).then(
  () => {
    createRoot(document.getElementById("root")!).render(
      <main className="min-h-screen bg-background-base p-6 text-content">
        <Modal title="Worktrees" size="lg" onClose={() => {}}>
          <div className="bycoda-settings-workbench p-4">
            <WorktreesPage
              cwd="/fixture/settings-project"
              onRemove={async () => {
                throw new Error("Deletion is disabled in this fixture");
              }}
            />
          </div>
        </Modal>
      </main>,
    );
  },
);
