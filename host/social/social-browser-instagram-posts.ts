import type {
  InstagramPostChange,
  InstagramPostChangeResult,
} from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { instagramPost } from "./social-browser-instagram";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const marker = '[data-bycoda-instagram-post-control="true"]';
const edit = ["Edit", "Düzenle"];
const remove = ["Delete", "Sil"];
const done = ["Done", "Bitti"];
const editor =
  'textarea[aria-label="Write a caption..."], textarea[aria-label="Write a caption…"], textarea[aria-label="Açıklama yaz..."], textarea[aria-label="Açıklama yaz…"]';
const deleteNotice = `[...document.querySelectorAll('[role="status"],[role="alert"]')].some(el =>
  el.getClientRects().length && ['Post deleted', 'Gönderi silindi'].includes(el.textContent.trim()))`;
const unavailablePost = ["Post isn't available", "Post mevcut değil"];

export function parseInstagramPostChange(input: Record<string, unknown>): InstagramPostChange {
  const { action, caption, confirm } = input;
  const postUrl = instagramPost(input.postUrl).url;
  if (
    action === "caption" &&
    confirm === "EDIT_INSTAGRAM_CAPTION" &&
    typeof caption === "string" &&
    !caption.includes("\0") &&
    [...caption].length <= 2200
  )
    return { action, caption, confirm, postUrl };
  if (action === "delete" && confirm === "DELETE_INSTAGRAM_POST")
    return { action, confirm, postUrl };
  throw new SocialPlatformError("rejected");
}

export async function changeInstagramPost(
  context: BrowserRecipeContext,
  input: InstagramPostChange,
  beforeDelete?: () => Promise<void>,
): Promise<InstagramPostChangeResult> {
  const target = instagramPost(input.postUrl);
  const isDelete = input.action === "delete";
  let submitted = false;
  const probe = (body: string) => `(() => {
    if (location.origin !== 'https://www.instagram.com' ||
        location.pathname.match(/^\\/(?:p|reel)\\/([A-Za-z0-9_-]+)\\/?$/)?.[1] !== ${JSON.stringify(target.code)}) return;
    const visible = el => !!el.getClientRects().length;
    const matches = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    const controls = root => matches(root, 'button,[role="button"]').filter(el =>
      !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const label = el => (el.getAttribute('aria-label') || el.querySelector('svg[aria-label]')?.getAttribute('aria-label') || el.textContent || '').trim();
    const button = (root, labels) => controls(root).filter(el => labels.includes(label(el)));
    const mark = list => {
      if (list.length !== 1) return;
      document.querySelectorAll('[data-bycoda-instagram-post-control]').forEach(el => el.removeAttribute('data-bycoda-instagram-post-control'));
      list[0].setAttribute('data-bycoda-instagram-post-control','true');
      return true;
    };
    const dialogs = matches(document, '[role="dialog"]');
    ${body}
  })()`;
  const verify = async () => {
    const challenge = await detectChallenge(context.page);
    if (challenge) throw needsHumanError(challenge);
    await context.verifyIdentity();
  };
  const waitFor = async <T>(body: string) => {
    const found = await context.waitFor<T>(probe(body), 15_000);
    if (found) return found;
    await verify();
    throw new SocialPlatformError("unsupported");
  };
  const click = async (body: string, mutation = false) => {
    await waitFor(body);
    await verify();
    if (mutation) {
      if (isDelete && beforeDelete) {
        await waitFor(body);
        await beforeDelete();
        await verify();
        await waitFor(body);
      }
      submitted = true;
    }
    await context.page.click(marker);
  };
  const openMenu = async () => {
    await click(`
      if (dialogs.length) return;
      const articles = matches(document, 'main article').filter(article =>
        matches(article, 'a[href]').some(link => new URL(link.href).origin === location.origin &&
          new URL(link.href).pathname.match(/^\\/(?:p|reel)\\/([A-Za-z0-9_-]+)\\/?$/)?.[1] === ${JSON.stringify(target.code)}));
      if (articles.length !== 1) return;
      return mark(button(articles[0], ['More options', 'Diğer seçenekler']));
    `);
    await click(`
      if (dialogs.length !== 1) return;
      const edits = button(dialogs[0], ${JSON.stringify(edit)});
      const deletes = button(dialogs[0], ${JSON.stringify(remove)});
      if (edits.length !== 1 || deletes.length !== 1) return;
      return mark(${isDelete ? "deletes" : "edits"});
    `);
  };
  const openEditor = () =>
    waitFor<{ caption: string }>(`
    if (dialogs.length !== 1) return;
    const editors = matches(dialogs[0], ${JSON.stringify(editor)}).filter(el => !el.disabled && !el.readOnly);
    if (!mark(editors)) return;
    return {caption: editors[0].value};
  `);
  const postUrl = target.url;
  try {
    await context.page.goto(postUrl);
    await verify();
    await openMenu();
    if (input.action === "caption") {
      const previous = await openEditor();
      if (previous.caption === input.caption) return { postUrl, changed: false };
      await verify();
      await context.page.fill(marker, input.caption);
      await click(
        `
        if (dialogs.length !== 1) return;
        const editors = matches(dialogs[0], ${JSON.stringify(editor)});
        if (editors.length !== 1 || editors[0].value !== ${JSON.stringify(input.caption)}) return;
        return mark(button(dialogs[0], ${JSON.stringify(done)}));
      `,
        true,
      );
      await waitFor("return dialogs.length === 0;");
      await context.page.goto(postUrl);
      await verify();
      await openMenu();
      if ((await openEditor()).caption !== input.caption) throw new SocialPlatformError("unknown");
    } else {
      await click(
        `
        if (dialogs.length !== 1 || ${deleteNotice}) return;
        const titles = matches(dialogs[0], 'h1,h2,h3,[role="heading"]');
        if (!titles.some(el => ['Delete post?', 'Gönderi silinsin mi?'].includes(label(el)))) return;
        return mark(button(dialogs[0], ${JSON.stringify(remove)}));
      `,
        true,
      );
      const receipt = await context.waitFor<boolean>(
        `location.origin === 'https://www.instagram.com' && (${deleteNotice})`,
        15_000,
      );
      if (!receipt) throw new SocialPlatformError("unknown");
      await verify();
      await context.page.goto(postUrl);
      await waitFor(`
        if (dialogs.length || matches(document, 'main article,[role="main"] article').length) return;
        return matches(document, 'main span,[role="main"] span').some(el =>
          ${JSON.stringify(unavailablePost)}.some(message =>
            el.textContent.trim() === message && document.title === message + ' • Instagram'));
      `);
      await verify();
    }
    return { postUrl, changed: true };
  } catch (error) {
    if (submitted) throw new SocialPlatformError("unknown");
    throw error;
  }
}
