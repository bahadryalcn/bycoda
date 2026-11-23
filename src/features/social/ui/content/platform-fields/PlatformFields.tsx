import type { SocialAccount, TikTokCreatorInfo } from "../../../model/social";
import type { ContentMedia, PlatformDraft } from "../contentDraft";
import { FacebookReelFields } from "./FacebookReelFields";
import { MetaFields } from "./MetaFields";
import { RedditFields } from "./RedditFields";
import { TikTokFields } from "./TikTokFields";
import { YouTubeFields } from "./YouTubeFields";

export type PlatformFieldProps = {
  account: SocialAccount;
  value: PlatformDraft;
  media: ContentMedia[];
  /** Publishing is not available for this account, or the editor is locked. */
  disabled: boolean;
  creator?: TikTokCreatorInfo;
  onChange: (next: PlatformDraft) => void;
};

/** The platform-specific options for one selected account. Platforms without options render nothing. */
export function PlatformFields(props: PlatformFieldProps) {
  switch (props.account.platform) {
    case "facebook":
      return (
        <>
          <MetaFields {...props} />
          {props.value.facebook?.target === "reel" ? <FacebookReelFields {...props} /> : null}
        </>
      );
    case "tiktok":
      return <TikTokFields {...props} />;
    case "youtube":
      return <YouTubeFields {...props} />;
    case "reddit":
      return <RedditFields {...props} />;
    default:
      return null;
  }
}
