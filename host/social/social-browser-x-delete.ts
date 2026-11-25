import type { SocialAccount } from "../../src/features/social/model/social";
import { isXResourceId } from "../../src/integrations/social/adapters/x-identifiers";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { challengeError } from "./browser/challenge";
import { X_POST_PATH, type XBrowserDeps } from "./social-browser-x-page";

const control = '[data-bycoda-x-delete="true"]';

function confirmedDeleteReceipt(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    const result = parsed?.data?.delete_tweet;
    return (
      (parsed?.errors === undefined || (Array.isArray(parsed.errors) && !parsed.errors.length)) &&
      !!result &&
      typeof result === "object" &&
      !Array.isArray(result)
    );
  } catch {
    return false;
  }
}

/**
 * Delete one post using X's owner menu. An unrecognized layout or readback never counts
 * as a deletion.
 */
export async function deleteXPost(
  deps: Pick<XBrowserDeps, "directory" | "identity" | "until" | "profile" | "launcher">,
  account: SocialAccount,
  postId: string,
  beforeSubmit: (() => Promise<void>) | undefined,
): Promise<void> {
  if (account.platform !== "x" || account.connection !== "browser" || !beforeSubmit)
    throw new SocialPlatformError("denied");
  if (!deps.launcher || !isXResourceId(postId)) throw new SocialPlatformError("unsupported");
  const url = `https://x.com/i/web/status/${postId}`;
  const session = await deps.launcher(deps.profile(account.id), true);
  const { page } = session;
  let submitted = false;
  const probe = (body: string) => String.raw`(() => {
    if (location.origin !== 'https://x.com') return;
    const visible = el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' &&
      !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
    const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const path = raw => new URL(raw, location.origin).pathname;
    const status = ${X_POST_PATH};
    const postId = ${JSON.stringify(postId)};
    const exact = status.exec(location.pathname)?.[1] === postId;
    const direct = (element, article) => element.closest('article') === article &&
      !element.closest('[data-testid="quoteTweet"]');
    const permalinks = article => all('a[href] time', article).filter(el => direct(el, article))
      .map(el => new URL(el.closest('a').href)).filter(url => url.origin === location.origin);
    const posts = () => all('article[data-testid="tweet"]').filter(article =>
      permalinks(article).some(url => status.exec(url.pathname)?.[1] === postId));
    const ownedPost = () => {
      const profile = all('a[data-testid="AppTabBar_Profile_Link"][href]');
      const targets = posts();
      if (profile.length !== 1 || new URL(profile[0].href).origin !== location.origin ||
          targets.length !== 1) return;
      const ownPath = path(profile[0].href).toLowerCase().replace(/\/$/, '');
      if (!/^\/[a-z0-9_]{1,15}$/.test(ownPath)) return;
      const targetPath = ownPath + '/status/' + postId;
      const permalink = permalinks(targets[0]).find(url => url.pathname.toLowerCase().replace(/\/$/, '') === targetPath);
      if (permalink) return { article: targets[0], url: permalink.origin + permalink.pathname };
    };
    const mark = items => {
      const enabled = items.filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (enabled.length !== 1) return;
      const target = enabled[0];
      // X exposes the menu to the DOM before its opening transition accepts pointer input.
      target.scrollIntoView({ block: 'center' });
      const box = target.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!hit || !target.contains(hit)) return;
      document.querySelectorAll('[data-bycoda-x-delete]').forEach(el => el.removeAttribute('data-bycoda-x-delete'));
      target.setAttribute('data-bycoda-x-delete', 'true');
      return true;
    };
    const deleted = () => all('[data-testid="toast"]').some(el =>
      /^(?:Your post was deleted|Your post has been deleted|Post deleted|Gönderin silindi|Gönderi silindi)[.!]?$/i.test(text(el)));
    ${body}
  })()`;
  const verify = async () => {
    const challenge = await challengeError(page, deps.directory);
    if (challenge) throw challenge;
    await deps.identity(page, account);
  };
  const click = async (body: string, final = false) => {
    const marked = probe(body);
    if (!(await deps.until<boolean>(page, marked, 12_000))) {
      await verify();
      throw new SocialPlatformError("unsupported");
    }
    await verify();
    if (final) await beforeSubmit();
    if (!(await page.evaluate<boolean>(marked))) throw new SocialPlatformError("unsupported");
    if (final) submitted = true;
    await page.click(control);
  };
  try {
    await page.goto(url);
    await verify();
    await click(`
      if (!exact || all('[role="dialog"],[role="alertdialog"],[role="menu"]').length) return;
      const target = ownedPost()?.article;
      if (!target) return;
      return mark(all('[data-testid="caret"]', target).filter(el => direct(el, target)));
    `);
    await click(`
      if (!exact || !ownedPost() || all('[role="dialog"],[role="alertdialog"]').length) return;
      return mark(all('[role="menuitem"]').filter(el => /^(?:Delete(?: post)?|Sil|Gönderiyi sil)$/i.test(text(el))));
    `);
    const readbackUrl = await page.evaluate<string | undefined>(
      probe("return exact ? ownedPost()?.url : undefined;"),
    );
    if (!readbackUrl) throw new SocialPlatformError("unsupported");
    const response = page.watchResponse(/\/DeleteTweet$/);
    try {
      await click(
        `
      if (!exact || deleted() || ownedPost()?.url !== ${JSON.stringify(readbackUrl)}) return;
      const dialogs = all('[role="alertdialog"],[role="dialog"]');
      if (dialogs.length !== 1) return;
      const dialog = dialogs[0];
      const labelled = (dialog.getAttribute('aria-labelledby') || '').split(/\\s+/)
        .map(id => document.getElementById(id)).filter(el => el && dialog.contains(el) && visible(el));
      if (![...labelled, ...all('h1,h2,h3,[role="heading"]', dialog)].some(el =>
          /^(?:Delete (?:post|tweet)\\?|Gönderi silinsin(?: mi)?\\?)$/i.test(text(el)))) return;
      return mark(all('[data-testid="confirmationSheetConfirm"]', dialogs[0]).filter(el =>
          /^(?:Delete|Sil)$/i.test(text(el))));
    `,
        true,
      );
      const [receipt, toast] = await Promise.all([
        response.body(12_000),
        deps.until<boolean>(page, probe("return deleted();"), 12_000),
      ]);
      if (receipt === undefined ? !toast : !confirmedDeleteReceipt(receipt))
        throw new SocialPlatformError("unknown");
    } finally {
      response.stop();
    }
    await page.goto(readbackUrl);
    await verify();
    const gone = probe(String.raw`
      if (!exact || posts().length) return false;
      return all('[data-testid="emptyState"],[data-testid="emptyState"] :is(h1,h2,p,span,[role="heading"]),[role="alert"]').some(el =>
        /^(?:This post is unavailable|This post was deleted|This Post was deleted by the Post author|Sorry, that page doesn’t exist|Bu gönderi kullanılamıyor|Bu gönderi silindi)[.!]?$/i.test(text(el))) ||
        all('[data-testid="primaryColumn"] [data-testid="error-detail"] span').some(el =>
          /^Hmm\.\.\.this page doesn['’]t exist\. Try searching for something else\.$/i.test(text(el)));
    `);
    if (!(await deps.until<boolean>(page, gone, 12_000))) throw new SocialPlatformError("unknown");
    await verify();
  } catch (error) {
    if (submitted) throw new SocialPlatformError("unknown");
    throw error;
  } finally {
    await session.close().catch(() => undefined);
  }
}
