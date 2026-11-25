import type {
  InstagramPostChange,
  InstagramPostChangeResult,
  InstagramPostDeletion,
} from "../../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { hash } from "../core/social-helpers";
import type { SocialService } from "../social";
import { instagramPost } from "../social-browser-instagram";

type Settings = Pick<SocialService, "setting" | "setSetting">;
type DeletePost = Extract<InstagramPostChange, { action: "delete" }>;

const key = (actor: string, url: unknown) =>
  `instagram.post.delete:${hash(JSON.stringify([actor, instagramPost(url).code]))}`;

export async function instagramPostDeletion(
  settings: Settings,
  actor: string,
  url: unknown,
): Promise<InstagramPostDeletion | undefined> {
  const state = await settings.setting(key(actor, url));
  return state === "review" || state === "deleted" ? state : undefined;
}

/** The account's browser lock serializes calls. Persist before the provider click. */
export async function deleteInstagramPostOnce(
  settings: Settings,
  actor: string,
  input: DeletePost,
  run: (beforeDelete: () => Promise<void>) => Promise<InstagramPostChangeResult>,
): Promise<InstagramPostChangeResult> {
  const previous = await instagramPostDeletion(settings, actor, input.postUrl);
  if (previous) return { postUrl: input.postUrl, changed: false, deletion: previous };

  const receiptKey = key(actor, input.postUrl);
  let armed = false;
  try {
    const result = await run(async () => {
      await settings.setSetting(receiptKey, "review");
      armed = true;
    });
    if (!armed || !result.changed) throw new SocialPlatformError("unknown");
    await settings.setSetting(receiptKey, "deleted");
    return { ...result, deletion: "deleted" };
  } catch (error) {
    if (!armed) throw error;
    return { postUrl: input.postUrl, changed: false, deletion: "review" };
  }
}
