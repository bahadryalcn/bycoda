import {
  desktopOperationId,
  openDesktopReview,
  sealDesktopReview,
} from "../desktop/reviewed-desktop-scope";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleWorktreesRpc(
  dependencies: Pick<ServerBindings, "desktopSigningSecret" | "engine" | "scopedDesktopCall">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "worktrees.removal.review":

    case "worktrees.removal.approve":

    case "worktrees.removal.status": {
      const mode = request.input.method.slice("worktrees.removal.".length);
      const reviewSecret = await dependencies.desktopSigningSecret();
      const reviewScope = {
        environmentId: dependencies.engine.store.environmentId,
        projectId: String(request.params.projectId ?? ""),
        sessionId: String(request.params.sessionId ?? ""),
      };
      const bound =
        mode === "review"
          ? request.params
          : {
              ...request.params,
              requestId: desktopOperationId(
                reviewSecret,
                request.token,
                reviewScope,
                request.params.requestId,
              ),
              ...(mode === "approve"
                ? {
                    reviewId: openDesktopReview(
                      reviewSecret,
                      request.token,
                      reviewScope,
                      request.params.reviewId,
                    ),
                  }
                : {}),
            };
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        request.input.method,
        bound,
        mode === "review"
          ? ["path"]
          : mode === "approve"
            ? ["reviewId", "requestId"]
            : ["requestId"],
      );
      if (mode === "review") {
        if (!request.result || typeof request.result !== "object" || Array.isArray(request.result))
          throw new Error("Invalid worktree review");
        const review = request.result as Record<string, unknown>;
        request.result = {
          ...review,
          reviewId: sealDesktopReview(
            reviewSecret,
            request.token,
            reviewScope,
            review.reviewId,
            review.expiresAt,
          ),
        };
      }
      break;
    }
  }
}
