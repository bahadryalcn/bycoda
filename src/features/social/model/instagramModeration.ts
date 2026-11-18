export type InstagramModerationAction = "hide" | "unhide" | "delete";

export type InstagramModerationRequest = {
  id: string;
  accountId: string;
  platformAccountId: string;
  projectId: string;
  threadId: string;
  commentId: string;
  eventId: string;
  commentDigest: string;
  action: InstagramModerationAction;
  status: "pending" | "attempting" | "applied" | "dismissed" | "uncertain";
  createdAt: number;
};

export type InstagramModerationReview = InstagramModerationRequest & { commentText?: string };
