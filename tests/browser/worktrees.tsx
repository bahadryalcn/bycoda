import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { setRemoteCommandRunner } from "../../src/platform/tauri/fs";
import { WorktreesPage } from "../../src/features/source-control/ui/WorktreesPage";
import { SourceControlSettings } from "../../src/features/settings/ui/SourceControlSettings";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import { Modal } from "../../src/shared/ui/Modal";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";
import type {
  ManagedWorkspace,
  WorkspacePolicy,
  WorkspaceStorageStatus,
} from "../../src/features/workspaces/model/contracts";
import type { Session } from "../../src/features/sessions/model/session";

const query = new URLSearchParams(location.search);
// `?populated` is the realistic Source Control settings composition: global Git preferences, a
// selected-repository boundary, a project policy override, storage pressure and long collections.
// `?remote` opens the same data as a project on a connected machine.
const populated = query.has("populated");
const remote = query.has("remote");
const managed = query.has("managed") || populated;
let storageMode: WorkspaceStorageStatus["materialization"] = query.has("unknownStorage")
  ? "unknown"
  : query.has("allowedStorage") || populated
    ? "allowed"
    : "paused";
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
if (populated) {
  policy = {
    ...policy,
    defaultMode: "current",
    pinned: true,
    retention: {
      active: "never",
      idle: 10 * 86_400_000,
      finished: 3 * 86_400_000,
      merged: 86_400_000,
      abandoned: "never",
    },
  };
}
let revision = populated ? 7 : 1;
const populatedWorkspace = (
  index: number,
  state: ManagedWorkspace["state"],
  extra: Partial<ManagedWorkspace> = {},
): ManagedWorkspace => ({
  id: `managed-populated-${index}`,
  repositoryId: "repo",
  projectId: project.id,
  environmentId: machine.environmentId,
  owner: { kind: index % 2 ? "session" : "task", id: `owner-${index}-0123456789abcdef` },
  path: `/fixture/worktrees/wt-populated-${index}-${"deep-folder-".repeat(index % 3)}end`,
  branchRef: `refs/heads/bycoda/${index % 2 ? "s" : "t"}/${
    [
      "login-form-validation",
      "fix-flaky-terminal-resize",
      "release-notes-generator",
      "settings-redesign-composition-with-an-unusually-long-branch-name-that-must-wrap",
      "update-dependencies",
      "mobile-pairing-recovery",
      "archive-search",
      "worktree-retention-copy",
    ][index % 8]
  }`,
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  state,
  directoryState: "present",
  revision: 1,
  lastActivityAt: 1,
  pinned: false,
  ...extra,
});
let workspaces: ManagedWorkspace[] = populated
  ? [
      populatedWorkspace(1, "active"),
      populatedWorkspace(2, "idle", { pinned: true }),
      populatedWorkspace(3, "finished"),
      populatedWorkspace(4, "merged", { directoryState: "blocked" }),
      populatedWorkspace(5, "abandoned"),
      populatedWorkspace(6, "idle"),
      populatedWorkspace(7, "merged", { directoryState: "removing" }),
      populatedWorkspace(8, "finished", { pinned: true }),
      populatedWorkspace(9, "merged", { directoryState: "removed" }),
      populatedWorkspace(10, "idle"),
    ]
  : [
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
const liveSessions: Session[] = workspaces
  .filter((workspace) => workspace.owner.kind === "session")
  .map((workspace, index) => ({
    id: workspace.owner.id,
    harness: "claude",
    model: "fixture-model",
    modelSettings: {},
    runtimeMode: "supervised",
    title: [
      "Provider settings parity across AI providers",
      "Worktree recovery with an unusually long session title that must remain readable",
      "Archive search",
      "Mobile pairing recovery",
    ][index % 4],
    cwd: project.cwd,
    blocks: [],
    busy: workspace.state === "active",
  }));
Object.assign(window, {
  workspaceFixtureCalls: workspaceCalls,
  workspaceFixtureSetStorage: (next: WorkspaceStorageStatus["materialization"]) => {
    storageMode = next;
  },
  // Simulates another editor saving the Host policy while this page holds unsaved edits.
  workspaceFixtureHostChangesPolicy: () => {
    policy = { ...policy, defaultMode: policy.defaultMode === "worktree" ? "current" : "worktree" };
    ++revision;
  },
});

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
const baseTrees = [
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
// Populated: every status the page can show, plus enough rows to exceed the bounded list.
const populatedTrees = [
  ...baseTrees.slice(0, 3),
  makeTree("publication-unknown", "feature/publication-unknown", { unpushed: null }),
  makeTree("three-unpublished", "feature/three-unpublished", { unpushed: 3, dirty: true }),
  makeTree("detached-review", "", { branch: null, head: "def5678" }),
  ...baseTrees.slice(3),
  ...Array.from({ length: 9 }, (_, index) =>
    makeTree(
      `spike-${index + 1}`,
      `spike/${["cache", "queue", "sync", "ui", "auth"][index % 5]}-${index + 1}`,
      {
        dirty: index % 4 === 0 ? true : false,
        unpushed: index % 3 === 0 ? 2 : 0,
        sessionIds: index % 5 === 0 ? ["spike-session"] : [],
      },
    ),
  ),
  // A managed directory is listed once, in the managed roster, never repeated here.
  makeTree("wt-populated-1-end", "bycoda/s/login-form-validation", {
    path: "/fixture/worktrees/wt-populated-1-end",
  }),
];
const trees = populated ? populatedTrees : baseTrees;
mockIPC((command, args = {}) => {
  if (command === "managed_worktree_removal_plan" || command === "managed_worktree_removal_apply") {
    const method =
      command === "managed_worktree_removal_plan"
        ? "workspaces.cleanup.plan"
        : "workspaces.cleanup.apply";
    command = "remote_request";
    args = { method, params: args.request };
  }
  if (command.startsWith("plugin:event|")) return null;
  if (command === "git_worktrees") return { worktrees: trees, defaultRoot: "/fixture/worktrees" };
  if (command === "local_host_connect") return machine;
  if (command === "remote_machines") return [machine];
  if (command === "git_branches") return [];
  if (command === "remote_request") {
    const { method, params = {} } = args as {
      method: string;
      params?: Record<string, unknown>;
    };
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
        materializedBytes: storageMode === "unknown" ? null : 42 * 1_073_741_824,
        sharedCacheBytes: storageMode === "unknown" ? null : 8 * 1_073_741_824,
        recoveryBytes: populated ? Math.round(1.4 * 1_073_741_824) : null,
        freeBytes: (storageMode === "paused" ? 18 : 153.5) * 1_073_741_824,
        budgetBytes: policy.disk.budgetBytes,
        warningRatio: policy.disk.warningRatio,
        minimumFreeBytes: policy.disk.minimumFreeBytes,
        materialization: storageMode,
        missingPaths: query.has("missingFolder") ? ["/fixture/worktrees/wt-merged"] : [],
        requiredFreeBytes:
          storageMode === "unknown" ? null : storageMode === "paused" ? 2 * 1_073_741_824 : 0,
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
// A connected machine runs its commands through the same in-memory transport.
if (remote) setRemoteCommandRunner((command, args) => invoke(command, args));
const fixtureCwd = remote ? `remote://${machine.environmentId}${project.cwd}` : project.cwd;
const removeDisabled = async () => {
  throw new Error("Deletion is disabled in this fixture");
};
void Promise.all([
  setLanguagePreference(query.get("lang") === "tr" ? "tr" : "en"),
  setDomainLanguagePreference("git", "app"),
]).then(() => {
  createRoot(document.getElementById("root")!).render(
    populated ? (
      // Mirrors the Settings workspace track: category rail, then the wide presentation scroller.
      // The app shell locks the document, so the track scrolls inside itself as in Settings.
      <main
        className="bg-background-base text-content"
        style={{ display: "flex", height: "100vh" }}
      >
        <nav
          aria-hidden="true"
          style={{ flex: "none", inlineSize: 200, background: "var(--ui-surface-panel)" }}
        />
        <div
          className="bycoda-settings-workbench"
          data-testid="populated-scroller"
          style={{ flex: 1, minInlineSize: 0, overflowY: "auto" }}
        >
          <div data-settings-scroller data-settings-width="workspace">
            <div className="bycoda-settings-form" data-testid="populated-settings">
              <div className="settings-topics">
                <SourceControlSettings />
                <WorktreesPage
                  boundary
                  cwd={fixtureCwd}
                  liveSessions={liveSessions}
                  onRemove={removeDisabled}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    ) : (
      <main className="min-h-screen bg-background-base p-6 text-content">
        <Modal title="Worktrees" size="lg" onClose={() => {}}>
          <div className="bycoda-settings-workbench">
            <WorktreesPage cwd={fixtureCwd} liveSessions={liveSessions} onRemove={removeDisabled} />
          </div>
        </Modal>
      </main>
    ),
  );
});
