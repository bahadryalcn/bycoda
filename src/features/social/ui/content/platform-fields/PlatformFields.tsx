import type { SocialAccount, SocialJob, TikTokCreatorInfo } from "../../../model/social";
import type { ContentMedia, PlatformDraft } from "../contentDraft";
import { FacebookReelFields } from "./FacebookReelFields";
import { LinkedInFields } from "./LinkedInFields";
import { FacebookVideoFields } from "./FacebookVideoFields";
import { MetaFields } from "./MetaFields";
import { RedditFields } from "./RedditFields";
import { SnapchatFields } from "./SnapchatFields";
import { TikTokFields } from "./TikTokFields";
import { XFields } from "./XFields";
import { YouTubeFields } from "./YouTubeFields";

export type PlatformFieldProps = {
  account: SocialAccount;
  value: PlatformDraft;
  media: ContentMedia[];
  /** Publishing is not available for this account, or the editor is locked. */
  disabled: boolean;
  creator?: TikTokCreatorInfo;
  /** Jobs MonoCode already ran, for choosing a post to quote. */
  posts?: readonly SocialJob[];
  onChange: (next: PlatformDraft) => void;
};

/** Whether an account has platform options, so the editor shows a section only when there is something in it. */
export function hasPlatformFields(account: SocialAccount): boolean {
  switch (account.platform) {
    case "x":
    case "instagram":
    case "facebook":
    case "tiktok":
    case "youtube":
    case "reddit":
    case "snapchat":
      return true;
    case "linkedin":
      return account.connection === "oauth";
    default:
      return false;
  }
}

/** The platform-specific options for one selected account. Platforms without options render nothing. */
export function PlatformFields(props: PlatformFieldProps) {
  switch (props.account.platform) {
    case "x":
      return <XFields {...props} />;
    case "instagram":
    case "facebook":
      return (
        <>
          <MetaFields {...props} />
          {props.account.platform === "facebook" && props.value.facebook?.target === "reel" ? (
            <FacebookReelFields {...props} />
          ) : null}
          {props.account.platform === "facebook" && props.account.connection !== "browser" ? (
            <FacebookVideoFields {...props} />
          ) : null}
        </>
      );
    case "tiktok":
      return <TikTokFields {...props} />;
    case "youtube":
      return <YouTubeFields {...props} />;
    case "reddit":
      return <RedditFields {...props} />;
    case "snapchat":
      return <SnapchatFields {...props} />;
    case "linkedin":
      return props.account.connection === "oauth" ? <LinkedInFields {...props} /> : null;
    default:
      return null;
  }
}
