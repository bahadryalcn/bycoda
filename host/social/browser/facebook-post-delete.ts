import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { facebookPost } from "../social-browser-meta";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { detectChallenge, needsHumanError } from "./challenge";

const marker = "data-bycoda-facebook-delete";

export function facebookPageDeleteTarget(account: SocialAccount, raw: unknown) {
  if (
    account.platform !== "facebook" ||
    account.connection !== "browser" ||
    account.accountType !== "page" ||
    !/^\d{1,30}$/.test(account.platformId)
  )
    throw new SocialPlatformError("unsupported");
  if (typeof raw !== "string" || raw.length > 900) throw new SocialPlatformError("rejected");
  const target = facebookPost(raw);
  const url = new URL(raw);
  if (
    url.pathname === "/permalink.php" &&
    ["story_fbid", "id"].some((key) => url.searchParams.getAll(key).length !== 1)
  )
    throw new SocialPlatformError("rejected");
  const actor = url.searchParams.get("id") ?? url.pathname.split("/")[1]!;
  if (/^\d+$/.test(actor) && actor !== account.platformId) throw new SocialPlatformError("denied");
  return target;
}

/** Deletes an exact post of the selected Page through a recognized owner menu. */
export async function deleteFacebookPagePost(
  context: BrowserRecipeContext,
  raw: string,
  beforeSubmit: () => Promise<void>,
) {
  const target = facebookPageDeleteTarget(context.account, raw);
  let submitted = false;
  const probe = (body: string) => String.raw`(() => {
    if (location.origin !== 'https://www.facebook.com') return;
    const pageId = ${JSON.stringify(context.account.platformId)};
    const target = new URL(${JSON.stringify(target.url)});
    const current = new URL(location.href);
    const path = url => url.pathname.replace(/\/$/, '');
    const exact = url => url.origin === target.origin && path(url) === path(target) &&
      (path(target) !== '/permalink.php' ||
        (url.searchParams.getAll('story_fbid').length === 1 &&
         url.searchParams.getAll('id').length === 1 &&
         url.searchParams.get('story_fbid') === target.searchParams.get('story_fbid') &&
         url.searchParams.get('id') === pageId));
    const visible = el => !el.closest('[hidden],[aria-hidden="true"]') &&
      !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const label = el => (el.getAttribute('aria-label') || text(el)).trim();
    const live = '[role="status"],[role="alert"]';
    const articles = 'article,[role="article"]';
    const dialogs = all(document, '[role="dialog"],[role="alertdialog"]');
    const menus = all(document, '[role="menu"]');
    const direct = (el, article) => el.closest(articles) === article &&
      !el.closest('blockquote, [data-ad-preview="message"]');
    const links = article => all(article, 'a[href]').filter(el => direct(el, article));
    const targetPosts = () => all(document, articles).filter(article => links(article).some(
      link => exact(new URL(link.href)) && !link.closest('h1,h2,h3,[role="heading"]')));
    const owns = article => links(article).some(link => {
      if (!link.closest('h1,h2,h3,h4,[role="heading"]')) return false;
      const author = new URL(link.href);
      return author.origin === target.origin &&
        (path(author) === '/' + pageId ||
         (path(author) === '/profile.php' && author.searchParams.get('id') === pageId));
    });
    const ownPost = () => {
      const posts = targetPosts();
      if (posts.length === 1 && owns(posts[0])) return posts[0];
    };
    const deleted = () => all(document, live).some(el =>
      /^(?:Your post (?:was|has been) deleted|Post deleted|Gönderin silindi|Gönderi silindi)[.!]?$/i.test(text(el)));
    const remove = el => /^(?:Delete(?: post)?|Sil|Gönderiyi sil)$/i.test(label(el));
    const mark = candidates => {
      const enabled = candidates.filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (enabled.length !== 1) return;
      document.querySelectorAll('[${marker}]').forEach(el => el.removeAttribute('${marker}'));
      enabled[0].setAttribute('${marker}', 'true');
      return true;
    };
    ${body}
  })()`;
  const verify = async () => {
    const challenge = await detectChallenge(context.page);
    if (challenge) throw needsHumanError(challenge);
    await context.verifyIdentity();
  };
  const click = async (body: string, action?: "delete" | "confirm") => {
    const expression = probe(body);
    const found = await context.waitFor<true | "deleted">(expression, 12_000);
    if (found === "deleted") return;
    if (!found) {
      await verify();
      throw new SocialPlatformError("unsupported");
    }
    // A recognized confirmation on the still-visible post means the menu has not submitted it.
    if (action === "confirm") submitted = false;
    await verify();
    if (action) await beforeSubmit();
    const current = await context.page.evaluate<true | "deleted">(expression);
    if (!current) throw new SocialPlatformError("unsupported");
    if (action) submitted = true;
    if (current === "deleted") return;
    await context.page.click(`[${marker}="true"]`);
  };
  try {
    await context.page.goto(target.url);
    await verify();
    await click(`
      if (!exact(current) || menus.length || dialogs.length) return;
      const article = ownPost();
      if (!article) return;
      return mark(all(article, 'button,[role="button"]').filter(el => direct(el, article) &&
        /^(?:Actions for this post|Post options|More options|Gönderi seçenekleri|Diğer seçenekler)$/i.test(label(el))));
    `);
    await click(
      `
      if (!exact(current) || !ownPost() || deleted() || dialogs.length || menus.length !== 1) return;
      return mark(all(menus[0], '[role="menuitem"]').filter(remove));
    `,
      "delete",
    );
    await click(
      String.raw`
      if (deleted()) return 'deleted';
      if (!exact(current) || !ownPost() || dialogs.length !== 1) return;
      const dialog = dialogs[0];
      const title = el => /^(?:Delete (?:this )?post\??|Gönderi silinsin mi\?|Gönderiyi sil)$/i.test(label(el));
      if (!title(dialog) && !all(dialog, 'h1,h2,h3,[role="heading"]').some(title)) return;
      return mark(all(dialog, 'button,[role="button"]').filter(remove));
    `,
      "confirm",
    );
    if (!(await context.waitFor<boolean>(probe("return deleted();"), 12_000)))
      throw new SocialPlatformError("unknown");
    await context.page.goto(target.url);
    const gone = probe(`
      if (!exact(current) || targetPosts().length || dialogs.length) return;
      return all(document, 'main h1,main h2,[role="main"] [role="heading"],[role="alert"]').some(el =>
        /^(?:This content isn['’]t available (?:right now|at the moment)|This post has been deleted|Bu içerik şu anda kullanılamıyor|Bu gönderi silindi)[.!]?$/i.test(text(el)));
    `);
    if (!(await context.waitFor<boolean>(gone, 12_000))) throw new SocialPlatformError("unknown");
    await verify();
  } catch (error) {
    if (submitted) throw new SocialPlatformError("unknown");
    throw error;
  }
}
