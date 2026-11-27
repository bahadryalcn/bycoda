/** Exact owner operations a project session may propose without contacting Facebook. */
export const FACEBOOK_MANAGEMENT_ACTIONS = [
  "facebook.page.update",
  "facebook.post.edit",
  "facebook.post.delete",
  "facebook.comment.moderate",
  "facebook.live.create",
  "facebook.live.start",
  "facebook.live.end",
] as const;

export type FacebookManagementAction = (typeof FACEBOOK_MANAGEMENT_ACTIONS)[number];
export type FacebookManagementRequest = {
  id: string;
  accountId: string;
  pageId: string;
  projectId: string;
  operation: FacebookManagementAction;
  details: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "approved" | "submitted" | "completed" | "review";
  approvalVersion?: number;
};

/** Browser, Page administration, deletion and Live controls remain owner operations. */
export function facebookManagementAutonomy({
  operation,
  details,
}: Pick<FacebookManagementRequest, "operation" | "details">) {
  if (operation === "facebook.post.edit") return "publish";
  if (
    operation === "facebook.comment.moderate" &&
    ["hide", "unhide", "like", "unlike"].includes(String(details.action))
  )
    return "comment";
  return undefined;
}
