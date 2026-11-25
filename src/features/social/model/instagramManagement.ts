import type {
  InstagramHighlightChange,
  InstagramPostChange,
  InstagramPostDeletion,
  InstagramProfilePatch,
} from "./socialBrowser";

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
  deletion?: InstagramPostDeletion;
};

/** The owner-only browser call a queued request maps to, rebuilt with its confirm token. */
export type InstagramManagementApply =
  | { type: "post"; change: InstagramPostChange }
  | { type: "highlight"; change: InstagramHighlightChange }
  | { type: "profile"; patch: InstagramProfilePatch }
  | { type: "message"; handle: string; text: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const ids = (value: unknown) => (Array.isArray(value) ? (value as string[]) : undefined);

/** Maps a stored request to the existing owner action; undefined when its details are unusable. */
export function instagramManagementApply(
  request: Pick<InstagramManagementRequest, "kind" | "details">,
): InstagramManagementApply | undefined {
  const d = request.details;
  switch (request.kind) {
    case "post.edit":
      return text(d.postUrl)
        ? {
            type: "post",
            change: {
              action: "caption",
              postUrl: text(d.postUrl),
              caption: text(d.caption),
              confirm: "EDIT_INSTAGRAM_CAPTION",
            },
          }
        : undefined;
    case "post.delete":
      return text(d.postUrl)
        ? {
            type: "post",
            change: {
              action: "delete",
              postUrl: text(d.postUrl),
              confirm: "DELETE_INSTAGRAM_POST",
            },
          }
        : undefined;
    case "profile.update":
      return d.patch && typeof d.patch === "object"
        ? { type: "profile", patch: d.patch as InstagramProfilePatch }
        : undefined;
    case "highlight.create":
      return {
        type: "highlight",
        change: {
          action: "create",
          name: text(d.name),
          storyIds: ids(d.storyIds) ?? [],
          confirm: "CREATE_INSTAGRAM_HIGHLIGHT",
        },
      };
    case "highlight.edit": {
      const storyIds = ids(d.storyIds);
      return {
        type: "highlight",
        change: {
          action: "edit",
          id: text(d.id),
          expectedName: text(d.expectedName),
          name: text(d.name),
          ...(storyIds ? { storyIds } : {}),
          confirm: "EDIT_INSTAGRAM_HIGHLIGHT",
        },
      };
    }
    case "highlight.delete":
      return {
        type: "highlight",
        change: {
          action: "delete",
          id: text(d.id),
          expectedName: text(d.expectedName),
          confirm: "DELETE_INSTAGRAM_HIGHLIGHT",
        },
      };
    case "dm.draft":
      return text(d.handle) && text(d.text)
        ? { type: "message", handle: text(d.handle), text: text(d.text) }
        : undefined;
  }
}
