import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { exact, str } from "./core/social-helpers";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const origin = "https://www.linkedin.com";
const feed = `${origin}/feed/`;
const marker = "data-bycoda-linkedin-article";
const draftPath = /^\/article\/edit\/[1-9][0-9]{0,24}\/?$/;

export function parseLinkedInArticleDraft(raw: unknown): { title: string; body: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new SocialPlatformError("rejected");
  const fields = raw as Record<string, unknown>;
  exact(fields, ["title", "body"]);
  const title = str(fields.title, "LinkedIn article title", 100);
  const body = str(fields.body, "LinkedIn article body", 50_000).replace(/\r\n?/g, "\n");
  if (/[\r\n]/.test(title)) throw new SocialPlatformError("rejected");
  return { title, body };
}

const openArticle = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(origin)} || !/^\/feed\/?$/.test(location.pathname)) return;
  const matches = [...document.querySelectorAll('main a[href]')].filter(el => {
    if (!el.getClientRects().length || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const target = URL.parse(el.getAttribute('href'), location.origin);
    return target?.origin === location.origin &&
      /^\/article\/new\/?$/.test(target.pathname) && !target.search && !target.hash &&
      ['Write article', 'Makale yaz'].includes(el.textContent.trim());
  });
  if (matches.length === 1) return matches[0].href;
})()`;

type Editor = { path: string; title: string; body: string; saved: boolean };

/** Require a visible indication of the selected publisher and refuse mixed or unrecognized editors. */
const articleEditor = (profilePath: string) => String.raw`(() => {
  if (location.origin !== ${JSON.stringify(origin)} ||
      !/^\/article\/(?:new|edit\/[1-9][0-9]{0,24})\/?$/.test(location.pathname) ||
      location.search || location.hash) return;
  const visible = el => !!el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
  if ([...document.querySelectorAll('dialog[open],[role="dialog"],input[type="password"]')].some(visible))
    return;
  const normalize = value => (value || '').trim().toLowerCase();
  const identity = [...document.querySelectorAll('a[href][aria-current="true"],a[href][aria-selected="true"]')]
    .filter(visible);
  if (identity.length !== 1) return;
  const selected = URL.parse(identity[0].getAttribute('href'), location.origin);
  if (selected?.origin !== location.origin ||
      selected.pathname.replace(/\/$/, '').toLowerCase() !== ${JSON.stringify(profilePath)}) return;
  const labels = el => [el.getAttribute('aria-label'), el.getAttribute('placeholder'),
    el.getAttribute('data-placeholder'), ...(el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .filter(Boolean).map(id => document.getElementById(id)?.textContent)].map(normalize);
  const title = [...document.querySelectorAll('main input[type="text"],main input:not([type]),main textarea')]
    .filter(el => visible(el) && !el.disabled && !el.readOnly &&
      labels(el).some(label => ['title', 'başlık'].includes(label)));
  const body = [...document.querySelectorAll('main [contenteditable="true"][role="textbox"]')]
    .filter(el => visible(el) && el.getAttribute('aria-readonly') !== 'true' &&
      labels(el).some(label => ['write here', 'buraya yazın'].includes(label)));
  if (title.length !== 1 || body.length !== 1) return;
  const status = [...document.querySelectorAll('main [role="status"]')].filter(el =>
    visible(el) && ['saved', 'all changes saved', 'kaydedildi', 'tüm değişiklikler kaydedildi']
      .includes(normalize(el.textContent)));
  const marker = ${JSON.stringify(marker)};
  document.querySelectorAll('[' + marker + ']').forEach(el => el.removeAttribute(marker));
  title[0].setAttribute(marker, 'title');
  body[0].setAttribute(marker, 'body');
  return { path: location.pathname, title: title[0].value, body: body[0].innerText.trim(), saved: status.length === 1 };
})()`;

const handoff = () =>
  new SocialPlatformError("needs_human", undefined, {
    url: feed,
    reasonCode: "linkedin_article_editor_requires_owner",
  });

async function checkChallenge(ctx: BrowserRecipeContext) {
  const hit = await detectChallenge(ctx.page);
  if (hit) throw needsHumanError(hit);
}

/**
 * A draft may autosave when the editor is first touched. Guard the first write and every
 * subsequent step. Report an uncertain result if a durable draft cannot be identified.
 */
export async function linkedInPrepareArticle(
  ctx: BrowserRecipeContext,
  raw: unknown,
  beforeDraftWrite: () => Promise<void>,
) {
  const draft = parseLinkedInArticleDraft(raw);
  const slug = /^web:linkedin:in:([\w-]{1,100})$/.exec(ctx.account.platformId)?.[1];
  if (
    !slug ||
    ctx.account.platform !== "linkedin" ||
    ctx.account.connection !== "browser" ||
    ctx.account.accountType !== "member"
  )
    throw new SocialPlatformError("denied");
  const editorProbe = articleEditor(`/in/${slug.toLowerCase()}`);
  await ctx.page.goto(feed);
  await checkChallenge(ctx);
  await ctx.verifyIdentity();
  const url = await ctx.waitFor<string>(openArticle, 10_000);
  await checkChallenge(ctx);
  if (!url || ![origin + "/article/new/", origin + "/article/new"].includes(url)) throw handoff();
  await ctx.verifyIdentity();
  await ctx.page.goto(url);
  await checkChallenge(ctx);
  const editor = await ctx.waitFor<Editor>(editorProbe, 10_000);
  await checkChallenge(ctx);
  if (!editor || editor.title || editor.body || !/^\/article\/new\/?$/.test(editor.path))
    throw handoff();
  await ctx.verifyIdentity();
  await beforeDraftWrite();
  await checkChallenge(ctx);
  const initial = await ctx.page.evaluate<Editor | undefined>(editorProbe);
  if (!initial || initial.title || initial.body || initial.path !== editor.path) throw handoff();
  ctx.markSubmitted?.();
  try {
    await ctx.page.fill(`[${marker}="title"]`, draft.title);
    await checkChallenge(ctx);
    await ctx.verifyIdentity();
    const next = await ctx.page.evaluate<Editor | undefined>(editorProbe);
    if (!next || next.title !== draft.title || next.body) throw handoff();
    await ctx.page.fill(`[${marker}="body"]`, draft.body);
    const receipt = await ctx.waitFor<string>(
      `(() => { const editor = ${editorProbe}; return editor?.saved && ${draftPath}.test(editor.path) &&
        editor.title === ${JSON.stringify(draft.title)} && editor.body === ${JSON.stringify(draft.body)}
        ? editor.path : undefined; })()`,
      10_000,
    );
    await checkChallenge(ctx);
    await ctx.verifyIdentity();
    if (!receipt || !draftPath.test(receipt)) throw handoff();
    return { state: "draft" as const, url: origin + receipt };
  } catch (error) {
    if (
      error instanceof SocialPlatformError &&
      error.code === "needs_human" &&
      error.detail?.reasonCode !== "linkedin_article_editor_requires_owner"
    )
      throw error;
    throw new SocialPlatformError("unknown");
  }
}
