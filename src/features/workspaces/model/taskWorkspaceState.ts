import type { HostTask } from "../../tasks/model/hostTasks";

/** Temporary app-side extension until S3 projects these fields into HostTask. */
export type ManagedTaskState = {
  workspaceId?: string;
  workspaceRevision?: number;
  completionState?: "pending" | "running" | "finished" | "failed";
  deliveryState?: "pending" | "review" | "merged" | "published" | "blocked";
  autoMergeSuspended?: boolean;
};
export function taskWorkspaceState(task: HostTask & ManagedTaskState) {
  const finished =
    task.completionState === "finished" ||
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
    delivery: delivered
      ? "Delivered"
      : task.mergeError || task.deliveryState === "blocked"
        ? "Delivery is blocked"
        : "Not delivered",
    needsRenewedApproval:
      !delivered && Boolean(task.autoMergeSuspended || task.autoMerge || task.deliveryRequested),
  };
}
