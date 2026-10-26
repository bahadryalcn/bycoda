import type { HostTask } from "../../tasks/model/hostTasks";

/** App-side presentation state alongside the authoritative Host task fields. */
export type ManagedTaskState = {
  workspaceId?: string;
  workspaceRevision?: number;
  completionState?: "pending" | "running" | "finished" | "failed";
  deliveryState?: HostTask["deliveryState"] | "pending" | "review" | "blocked";
  autoMergeSuspended?: boolean;
};
export function taskWorkspaceState(task: Omit<HostTask, "deliveryState"> & ManagedTaskState) {
  const finished =
    task.completionState === "finished" ||
    Boolean(task.finalization) ||
    (!task.completionState && (task.status === "review" || task.status === "done"));
  const delivered =
    task.merged || task.deliveryState === "merged" || task.deliveryState === "published";
  return {
    workspaceId: task.workspaceId,
    finished,
    completion: finished
      ? "Implementation finished"
      : task.completionState === "failed"
        ? "Implementation blocked"
        : "Implementation in progress",
    delivery: task.artifactDeliveryPending
      ? "Delivery is blocked"
      : delivered
        ? "Delivered"
        : task.mergeError || task.deliveryState === "blocked"
          ? "Delivery is blocked"
          : "Not delivered",
    needsRenewedApproval:
      !delivered &&
      Boolean(
        task.deliveryApprovalRequired ||
        task.deliveryState === "awaitingOwner" ||
        task.autoMergeSuspended ||
        task.autoMerge ||
        task.deliveryRequested,
      ),
  };
}
