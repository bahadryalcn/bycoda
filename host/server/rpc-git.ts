import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleGitRpc(
  dependencies: Pick<ServerBindings, "gitService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "git.diff":
      request.result = await dependencies.gitService.diff(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.branches":
      request.result = await dependencies.gitService.branches(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.switch":
      request.result = await dependencies.gitService.switch(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.createBranch":
      request.result = await dependencies.gitService.createBranch(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.worktrees":
      request.result = await dependencies.gitService.worktrees(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.worktreeCreate":
      request.result = await dependencies.gitService.worktreeCreate(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.index":
      request.result = await dependencies.gitService.index(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.fileDiff":
      request.result = await dependencies.gitService.fileDiff(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.action":
      request.result = await dependencies.gitService.action(request.params, request.domainContext, {
        legacy: true,
      });
      break;
  }
}
