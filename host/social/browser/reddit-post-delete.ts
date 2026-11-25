import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { redditFullname } from "../../../src/integrations/social/adapters/reddit-api";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { detectChallenge, needsHumanError } from "./challenge";

const origin = "https://www.reddit.com";
const marker = "[data-bycoda-reddit-delete-menu]";

export async function deleteRedditBrowserPost(
  ctx: BrowserRecipeContext,
  raw: string,
  beforeSubmit: () => Promise<void>,
) {
  const { platform, platformId, connection, accountType } = ctx.account;
  if (platform !== "reddit" || connection !== "browser" || accountType !== "member")
    throw new SocialPlatformError("unsupported");
  const owner = /^web:reddit:(t2_[a-z0-9]{3,12})$/.exec(platformId)?.[1];
  if (!owner) throw new SocialPlatformError("denied");
  const id = redditFullname(raw, ["t3"]);
  const url = `${origin}/comments/${id.slice(3)}/`;
  const probe = (body: string) => String.raw`(() => {
    if (location.origin !== ${JSON.stringify(origin)} ||
        !new RegExp('^/(?:(?:r|user)/[A-Za-z0-9_-]+/)?comments/' + ${JSON.stringify(id.slice(3))} +
          '(?:/[^/]+)?/?$').test(location.pathname)) return;
    const posts = [...document.querySelectorAll('shreddit-post')].filter(
      post => post.id === ${JSON.stringify(id)});
    if (posts.length !== 1) return;
    const post = posts[0];
    const owned = post.getAttribute('author-id') === ${JSON.stringify(owner)};
    const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const enabled = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('[hidden],[aria-hidden="true"]') && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const all = (root, selector) => root ? [...root.querySelectorAll(selector)].filter(enabled) : [];
    const menus = [...post.querySelectorAll('shreddit-post-overflow-menu')].filter(el =>
      el.closest('shreddit-post') === post && el.getAttribute('post-id') === post.id &&
      el.getAttribute('author-id') === ${JSON.stringify(owner)});
    const menu = menus.length === 1 ? menus[0] : undefined;
    const roots = [document, ...[...document.querySelectorAll('faceplate-dialog,rpl-dialog,faceplate-confirmation-modal')].map(el => el.shadowRoot).filter(Boolean)];
    const dialogs = roots.flatMap(root => all(root, 'dialog[open],[role="dialog"],[role="alertdialog"]'))
      .map(panel => ({ container: panel, title: panel }));
    for (const shell of document.querySelectorAll('#post-deletion-confirmation-modal')) {
      // The portal has no layout box. Its shadow panel labels the visible slotted controls.
      const panels = all(shell.shadowRoot, '[role="dialog"][aria-modal="true"]');
      if (panels.length === 1) dialogs.push({ container: shell, title: panels[0] });
    }
    const deleted = !owned && (!post.getAttribute('author-id') || post.getAttribute('author') === '[deleted]') &&
      (post.getAttribute('removed-by-category') === 'deleted' ||
       (post.getAttribute('author') === '[deleted]' && post.hasAttribute('is-author-deleted')) ||
       all(post, 'p,[role="status"]').some(el =>
        /^(?:Sorry, this post was deleted by the person who originally posted it|This post was deleted by the person who originally posted it|Bu gönderi, gönderiyi paylaşan kişi tarafından silindi)[.!]?$/i.test(text(el))));
    const label = el => (el.getAttribute('aria-label') || text(el)).trim();
    const remove = el => /^(?:Delete(?: post)?|Yes, delete|Gönderiyi sil|Sil)$/i.test(label(el));
    ${body}
  })()`;
  const requireStage = async (body: string) => {
    if (await ctx.waitFor<boolean>(probe(body), 12_000)) return;
    const challenge = await detectChallenge(ctx.page);
    if (challenge) throw needsHumanError(challenge);
    throw new SocialPlatformError("unsupported");
  };
  const item = `
    if (!owned || !menu || dialogs.length || deleted) return;
    const options = all(menu.shadowRoot, '[role="menuitem"]').filter(remove);
    if (options.length !== 1) return;
  `;
  const confirm = String.raw`
    if (!owned || dialogs.length !== 1) return;
    const { container: dialog, title } = dialogs[0];
    const heading = el => /^(?:Delete (?:this )?post\??|Gönderiyi sil|Gönderi silinsin mi\?)$/i.test(label(el));
    if (!heading(title) && !all(dialog, 'h1,h2,h3,[role="heading"],[slot="title"]').some(heading)) return;
    const options = all(dialog, 'button,[role="button"]').filter(remove);
    if (options.length !== 1) return;
  `;
  await ctx.page.goto(url);
  await ctx.verifyIdentity();
  await requireStage(`
    if (!owned || !menu || dialogs.length) return;
    const buttons = all(menu, 'button').filter(el => /^(?:Open user actions|More options|Kullanıcı işlemlerini aç|Diğer seçenekler)$/i.test(label(el)));
    if (buttons.length !== 1) return;
    document.querySelectorAll(${JSON.stringify(marker)}).forEach(el => el.removeAttribute('data-bycoda-reddit-delete-menu'));
    buttons[0].setAttribute('data-bycoda-reddit-delete-menu', '');
    return true;
  `);
  await ctx.page.click(marker);
  await requireStage(item + "return true;");
  await ctx.verifyIdentity();
  await beforeSubmit();
  if (!(await ctx.page.evaluate<boolean>(probe(item + "options[0].click(); return true;"))))
    throw new SocialPlatformError("unknown");
  const state = await ctx.waitFor<"deleted" | "confirm">(
    probe("if (deleted) return 'deleted';" + confirm + "return 'confirm';"),
    12_000,
  );
  if (state === "confirm") {
    await ctx.verifyIdentity();
    await beforeSubmit();
    if (!(await ctx.page.evaluate<boolean>(probe(confirm + "options[0].click(); return true;"))))
      throw new SocialPlatformError("unknown");
    // Give the provider time to finish its write before navigating away.
    await ctx.waitFor<boolean>(probe("return deleted;"), 12_000);
  }
  // Reddit retains the permalink and discussion. Require its author-deletion tombstone.
  await ctx.page.goto(url);
  if (!(await ctx.waitFor<boolean>(probe("return deleted;"), 12_000)))
    throw new SocialPlatformError("unknown");
  await ctx.verifyIdentity();
}
