/**
 * Audience shapes that adapters produce or consume. This file must not import from `src/features`:
 * `src/features/social/model/audience.ts` re-exports these types for the rest of the app.
 */

export type InteractionKind =
  | "comment"
  | "like"
  | "share"
  | "quote"
  | "mention"
  | "dm"
  | "follower"
  | "search"
  | "import"
  | "email"
  | "reply";

/** Where an audience collection reads from. Platform is implied by the account. */
export type CaptureSource =
  | {
      kind:
        | "own_post_comments"
        | "own_post_likes"
        | "own_post_shares"
        | "mentions"
        | "dm_senders"
        | "followers";
      accountId: string;
      postRef?: string;
    }
  | { kind: "keyword" | "hashtag"; accountId: string; query: string }
  | { kind: "account_commenters"; accountId: string; handle: string };

/** One person seen by an adapter during collection. `platformId` is the platform's stable identity. */
export type CollectedPerson = {
  platformId: string;
  name: string;
  username?: string;
  profileUrl?: string;
  followers?: number;
  text?: string;
  kind: InteractionKind;
  /** Post, thread or message identifier the interaction refers to. */
  ref?: string;
  at: number;
};
