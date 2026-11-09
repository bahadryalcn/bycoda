import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { openDevServerBrowser } from "../dev-servers/dev-server-browser";
import { createDevServersService } from "../domains/dev-servers/service";
import { createFileService } from "../domains/files/service";
import { createHostGitService } from "../domains/git/service";
import { createHostGoalsService } from "../domains/goals/service";
import { createHostNotesService } from "../domains/notes/service";
import { createHostSprintsService } from "../domains/sprints/service";
import { createHostTasksService } from "../domains/tasks/service";
import { createTerminalService } from "../domains/terminals/service";
import { createHostBranch, hostBranches, switchHostBranch } from "../git/git-branches";
import { withHostGitMutation } from "../git/git-mutations";
import { createHostWorktree, hostWorktrees, resolveHostWorktreeAsync } from "../git/git-worktrees";
import { HostTasks } from "../tasks/tasks";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  indexHostFiles,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "../workspaces/workspace";
import type { ServerBindings } from "./bindings";
export function createGitRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "startWorkspaceActivity"
    | "terminals"
    | "touchTerminalWorkspace"
    | "workspace"
    | "featureSession"
    | "hostNotes"
    | "tasks"
    | "goals"
    | "workspaceForOwnerRpc"
    | "managed"
    | "devServers"
    | "sprints"
  >,
) {
  const fileService = createFileService({
    project: (id) => dependencies.engine.store.project(id),
    resolveWorkspace: resolveHostWorktreeAsync,
    activity: dependencies.startWorkspaceActivity,
    files: {
      read: readHostFile,
      list: listHostFiles,
      index: indexHostFiles,
      search: searchHostFiles,
      searchContent: searchHostContent,
      create: createHostPath,
      write: writeHostFile,
    },
  });
  const terminalService = createTerminalService({
    project: (id) => dependencies.engine.store.project(id),
    terminals: dependencies.terminals,
    activity: dependencies.touchTerminalWorkspace,
  });
  const gitService = createHostGitService({
    project: (id) => dependencies.engine.store.project(id),
    resolveWorktree: resolveHostWorktreeAsync,
    withIdleProject: (id, work) => dependencies.engine.withIdleProject(id, work),
    serializeMutation: (cwd, work, scope) => withHostGitMutation(cwd, work, undefined, scope),
    startActivity: (cwd) => dependencies.startWorkspaceActivity(cwd, "mutation", "git.action"),
    invalidateRoots: () => dependencies.workspace.invalidateRoots(),
    diff: async (cwd) =>
      (
        await exec(
          "git",
          ["-c", "core.pager=cat", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
          { cwd, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
        )
      ).stdout,
    branches: hostBranches,
    switch: switchHostBranch,
    createBranch: createHostBranch,
    worktrees: hostWorktrees,
    worktreeCreate: createHostWorktree,
    index: hostGitIndex,
    fileDiff: hostFileDiff,
    action: hostGitAction,
  });
  const notesService = createHostNotesService({
    session: dependencies.featureSession,
    project: (id) => dependencies.engine.store.project(id),
    notes: dependencies.hostNotes,
  });
  const tasksService = createHostTasksService({
    project: (id) => dependencies.engine.store.project(id),
    tasks: dependencies.tasks,
    withAuthorization: (authorized, work) =>
      dependencies.engine.store.db.withAuthorization(authorized, work),
    retarget: (id, target, autoMerge, context) => {
      if (!context.retargetTask)
        throw new Error("Authenticated workspace-owner capability is required");
      return context.retargetTask(id, target, autoMerge) as ReturnType<HostTasks["retarget"]>;
    },
  });
  const goalsService = createHostGoalsService({ goals: dependencies.goals });
  const devServersService = createDevServersService({
    project: (id) => dependencies.engine.store.project(id),
    projects: () => dependencies.engine.store.projects(),
    workspace: async (id) => (await dependencies.workspaceForOwnerRpc(id)) ?? undefined,
    assertWorkspaceWritable: (id) => dependencies.managed.assertWritable(id),
    servers: dependencies.devServers,
    openExternal: async (url, _context, authorize) => {
      await authorize();
      return openDevServerBrowser(url);
    },
  });
  const sprintsService = createHostSprintsService({ sprints: dependencies.sprints });
  return {
    fileService,
    terminalService,
    gitService,
    notesService,
    tasksService,
    goalsService,
    devServersService,
    sprintsService,
  };
}
