import { hostGitExec } from "../git/git-exec-pool";
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
import { generateGitText } from "../git/git-text-generation";
import { hostModelRoutingService } from "../model-routing/runtime";
import { readModelRouting } from "../model-routing/storage";
import { TEXT_HARNESSES } from "../../src/features/source-control/model/gitGenerationChoice";
import type { GitStagedContext, GitRangeContext } from "../../src/platform/tauri/fs";
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
    | "providers"
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
    | "gitWatches"
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
        await hostGitExec.exec(
          "git",
          ["-c", "core.pager=cat", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
          { cwd, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
        )
      ).stdout,
    // The picker reuses the list until the checkout's watched refs change.
    branches: (cwd) => hostBranches(cwd, (path) => dependencies.gitWatches.read(path)),
    switch: switchHostBranch,
    createBranch: createHostBranch,
    worktrees: hostWorktrees,
    worktreeCreate: createHostWorktree,
    index: hostGitIndex,
    generateText: async (cwd, params, authorize) => {
      const routing = await readModelRouting(dependencies.engine.store);
      let choice = params.choice;
      if (params.kind === "commit" && choice) {
        if (
          !dependencies.providers.includes(choice.harness) ||
          !TEXT_HARNESSES.includes(choice.harness)
        )
          throw new Error("The selected text generation provider is unavailable on this Host");
      } else if (routing.roles["text.git"]) {
        const resolution = await hostModelRoutingService(dependencies.engine.store).resolve({
          role: "text.git",
        });
        if (!resolution.ok) throw new Error(`Git model routing failed: ${resolution.reason}`);
        choice = resolution.target;
      }
      const preferred =
        params.preferred && dependencies.providers.includes(params.preferred)
          ? params.preferred
          : dependencies.providers.find((provider) => TEXT_HARNESSES.includes(provider));
      if (!choice && !preferred)
        throw new Error("No text generation provider is available on this Host");
      return generateGitText(
        cwd,
        { ...params, preferred, choice },
        {
          authorize,
          context: async (kind) =>
            (await dependencies.workspace.run(
              kind === "commit" ? "git_staged_context" : "git_range_context",
              { cwd },
            )) as GitStagedContext | GitRangeContext,
        },
      );
    },
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
