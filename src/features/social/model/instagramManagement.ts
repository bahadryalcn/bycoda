/** Owner-run Instagram browser changes a project session may queue for review. Nothing runs from the queue. */
export const INSTAGRAM_MANAGEMENT_KINDS = [
  "post.edit",
  "post.delete",
  "profile.update",
  "highlight.create",
  "highlight.edit",
  "highlight.delete",
  "dm.draft",
] as const;

export type InstagramManagementKind = (typeof INSTAGRAM_MANAGEMENT_KINDS)[number];

export type InstagramManagementRequest = {
  id: string;
  accountId: string;
  platformAccountId: string;
  projectId?: string;
  kind: InstagramManagementKind;
  details: Record<string, unknown>;
  createdAt: number;
};
