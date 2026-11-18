import type { SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "../browser/challenge";
import {
  click,
  control,
  denied,
  files,
  fill,
  json,
  unknown,
  unsupported,
} from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";

const TIKTOK = "https://www.tiktok.com";
const CAPTION_EDITOR =
  '[data-e2e="caption-editor"][contenteditable="true"],[data-e2e="caption-editor"] [contenteditable="true"],textarea[data-e2e="edit-post-caption"]';

export async function checkTikTokPublishingChallenge(ctx: BrowserRecipeContext): Promise<void> {
  const challenge = await detectChallenge(ctx.page);
  if (challenge) throw needsHumanError(challenge);
}

function postPath(
  ctx: BrowserRecipeContext,
  target: { postId: string; mediaType?: "video" | "photo" },
) {
  const handle = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  if (!handle || !/^\d{1,30}$/.test(target.postId)) throw denied();
  if (
    target.mediaType !== undefined &&
    target.mediaType !== "video" &&
    target.mediaType !== "photo"
  )
    throw unsupported();
  return `/@${handle}/${target.mediaType ?? "video"}/${target.postId}`;
}

async function verifyPostPage(ctx: BrowserRecipeContext, path: string) {
  await checkTikTokPublishingChallenge(ctx);
  await ctx.verifyIdentity();
  if (
    !(await ctx.page.evaluate(
      `location.origin === ${json(TIKTOK)} && location.pathname === ${json(path)}`,
    ))
  )
    throw denied();
}

async function openPostMenu(ctx: BrowserRecipeContext, path: string) {
  await ctx.page.goto(TIKTOK + path);
  await verifyPostPage(ctx, path);
  await click(
    ctx,
    'button[data-e2e="browse-more-menu"],button[data-e2e="post-more-menu"]',
    "post-menu",
  );
  await checkTikTokPublishingChallenge(ctx);
}

async function commitPostChange(
  ctx: BrowserRecipeContext,
  path: string,
  selector: string,
  label: string,
  beforeSubmit: () => Promise<void>,
  verifyReceipt: () => Promise<void>,
) {
  const button = await control(ctx, selector, label);
  await beforeSubmit();
  await verifyPostPage(ctx, path);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(button);
    await checkTikTokPublishingChallenge(ctx);
    await verifyReceipt();
    await verifyPostPage(ctx, path);
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "needs_human") throw error;
    throw unknown();
  }
}

export async function tiktokEditPost(
  ctx: BrowserRecipeContext,
  target: { postId: string; caption: string; mediaType?: "video" | "photo" },
  beforeSubmit: () => Promise<void>,
) {
  const path = postPath(ctx, target);
  if (
    typeof target.caption !== "string" ||
    target.caption.length > (target.mediaType === "photo" ? 4000 : 2200)
  )
    throw unsupported();
  await openPostMenu(ctx, path);
  await click(ctx, '[data-e2e="post-edit"],[data-e2e="browse-edit"]', "post-edit");
  await checkTikTokPublishingChallenge(ctx);
  await fill(ctx, CAPTION_EDITOR, "post-caption", target.caption, true);
  await commitPostChange(
    ctx,
    path,
    '[role="dialog"] button[data-e2e="save-edit-post"],[role="dialog"] button[data-e2e="edit-post-save"]',
    "post-save",
    beforeSubmit,
    async () => {
      const saved = String.raw`(() => {
        const captions = [...document.querySelectorAll('[data-e2e="browse-video-desc"],[data-e2e="browse-photo-desc"]')].filter(el => !el.hidden && el.getClientRects().length);
        return captions.length === 1 && captions[0].textContent.trim() === ${json(target.caption.trim())};
      })()`;
      if (!(await ctx.waitFor<boolean>(saved))) throw unknown();
      await ctx.page.goto(TIKTOK + path);
      await checkTikTokPublishingChallenge(ctx);
      if (!(await ctx.waitFor<boolean>(saved))) throw unknown();
    },
  );
  return { postId: target.postId };
}

export async function tiktokDeletePost(
  ctx: BrowserRecipeContext,
  target: { postId: string; mediaType?: "video" | "photo" },
  beforeSubmit: () => Promise<void>,
) {
  const path = postPath(ctx, target);
  await openPostMenu(ctx, path);
  await click(ctx, '[data-e2e="post-delete"],[data-e2e="browse-delete"]', "post-delete");
  await checkTikTokPublishingChallenge(ctx);
  await commitPostChange(
    ctx,
    path,
    '[role="dialog"] button[data-e2e="confirm-delete"],[role="dialog"] button[data-e2e="delete-post-confirm"]',
    "post-delete-confirm",
    beforeSubmit,
    async () => {
      const succeeded = String.raw`(() => {
        const receipts = [...document.querySelectorAll('[role="status"],[role="alert"]')].filter(el => !el.hidden && el.getClientRects().length);
        return receipts.some(el => /^(?:Post deleted|Video deleted|Photo deleted|Gönderi silindi|Video silindi|Fotoğraf silindi)[.!]?$/i.test(el.textContent.trim()));
      })()`;
      if (!(await ctx.waitFor<boolean>(succeeded))) throw unknown();
      await ctx.page.goto(TIKTOK + path);
      await checkTikTokPublishingChallenge(ctx);
      const gone = String.raw`[...document.querySelectorAll('[data-e2e="video-not-available"],[data-e2e="post-not-available"]')].some(el => !el.hidden && el.getClientRects().length)`;
      if (!(await ctx.waitFor<boolean>(gone))) throw unknown();
    },
  );
  return { postId: target.postId };
}

/** Studio photo actions are limited to sessions that expose an accessible image uploader. */
export async function selectTikTokPostMedia(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  photo: boolean,
) {
  await checkTikTokPublishingChallenge(ctx);
  if (!photo) {
    await files(ctx, 'input[type="file"][accept*="video"]');
    return;
  }
  const options = job.payload.tiktok!;
  const cover = options.photoCoverIndex!;
  await files(ctx, 'input[type="file"][accept*="image"]');
  if (options.photoTitle)
    await fill(
      ctx,
      'input[data-e2e="photo-title"],textarea[data-e2e="photo-title"]',
      "photo-title",
      options.photoTitle,
      true,
    );
  if (ctx.files.length > 1) {
    const coverSelector = `button[data-e2e="photo-cover-option"][data-index="${cover}"]`;
    await click(ctx, coverSelector, "photo-cover");
    if (
      !(await ctx.page.evaluate(
        `document.querySelector(${json(coverSelector)})?.getAttribute('aria-pressed') === 'true'`,
      ))
    )
      throw unsupported();
  }
}
