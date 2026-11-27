import type { InstagramCommentLike } from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { instagramPost } from "./social-browser-instagram";
import { numeric, readResponse, values, type Value } from "./social-browser-meta-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

export function parseInstagramCommentLike(input: Record<string, unknown>): InstagramCommentLike {
  if (
    typeof input.postId !== "string" ||
    !instagramPost(input.postId).id ||
    !numeric(input.commentId) ||
    input.confirm !== "LIKE_INSTAGRAM_COMMENT"
  )
    throw new SocialPlatformError("rejected");
  return { postId: input.postId, commentId: input.commentId, confirm: input.confirm };
}

export async function instagramLikeComment(
  context: BrowserRecipeContext,
  input: InstagramCommentLike,
  authorize: (recipientId: string) => Promise<void>,
): Promise<{ liked: true; changed: boolean }> {
  const post = instagramPost(input.postId);
  if (!post.id || !numeric(input.commentId)) throw new SocialPlatformError("rejected");
  const verify = async () => {
    const challenge = await detectChallenge(context.page);
    if (challenge) throw needsHumanError(challenge);
    await context.verifyIdentity();
  };
  const read = async () => {
    const raw = await readResponse(
      { ...context, verifyIdentity: verify },
      post.url,
      new RegExp(`/api/v1/media/${post.id}/comments/(?:\\?|$)`),
    );
    const value = values(raw, true)[0];
    if (value.status !== "ok" || !Array.isArray(value.comments))
      throw new SocialPlatformError("unsupported");
    const matches = value.comments
      .slice(0, 100)
      .filter((entry: Value) => String(entry?.pk ?? "") === input.commentId);
    const comment = matches[0];
    const author = String(comment?.user?.pk ?? "");
    if (matches.length !== 1 || !numeric(author) || typeof comment.has_liked_comment !== "boolean")
      throw new SocialPlatformError("unsupported");
    return { author, liked: comment.has_liked_comment as boolean };
  };
  const before = await read();
  if (before.liked) return { liked: true, changed: false };
  const marked = await context.waitFor<boolean>(
    `(() => {
    if (location.origin !== 'https://www.instagram.com' ||
        !${JSON.stringify(["/p/" + post.code + "/", "/reel/" + post.code + "/"])}.includes(location.pathname)) return;
    const visible = el => !!el.getClientRects().length;
    const links = [...document.querySelectorAll('main li a[href]')].filter(el =>
      visible(el) && new URL(el.href).origin === location.origin &&
      new URL(el.href).pathname === ${JSON.stringify(`/p/${post.code}/c/${input.commentId}/`)});
    const row = links.length === 1 ? links[0].closest('li') : null;
    if (!row) return;
    const controls = [...row.querySelectorAll('button,[role="button"]')].filter(el =>
      el.closest('li') === row && visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      ['Like','Beğen'].includes((el.getAttribute('aria-label') ||
        el.querySelector('svg[aria-label]')?.getAttribute('aria-label') || '').trim()));
    if (controls.length !== 1) return;
    document.querySelectorAll('[data-bycoda-instagram-like]').forEach(el => el.removeAttribute('data-bycoda-instagram-like'));
    controls[0].setAttribute('data-bycoda-instagram-like','true');
    return true;
  })()`,
    15_000,
  );
  await verify();
  if (!marked) throw new SocialPlatformError("unsupported");
  await authorize(before.author);
  await verify();
  try {
    await context.page.click('[data-bycoda-instagram-like="true"]');
    const stored = await read();
    if (stored.author !== before.author || !stored.liked) throw new SocialPlatformError("unknown");
    return { liked: true, changed: true };
  } catch {
    throw new SocialPlatformError("unknown");
  }
}
