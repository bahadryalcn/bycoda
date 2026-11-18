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
  status: "pending" | "submitted" | "completed" | "review";
};
