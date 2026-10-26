import { open } from "node:fs/promises";
import type { SocialJob, SocialMedia } from "../src/features/social/model/social";
import { SocialPlatformError, type SocialSendResult } from "../src/integrations/social/adapter";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const origin = "https://www.linkedin.com";
const json = JSON.stringify;
const unsupported = () => new SocialPlatformError("unsupported");
const denied = () => new SocialPlatformError("denied");
const unknown = () => new SocialPlatformError("unknown");
const content = (job: SocialJob) => [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** The visible UI contracts follow LinkedIn Help a541865, a518909 and a519856.
 * No Voyager request, hidden application state or InMail credit is used here. */
async function unique(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
  hidden = false,
): Promise<string> {
  const found = await ctx.waitFor<boolean>(
    String.raw`(() => {
    if(location.origin!==${json(origin)})return false;
    const labels=${json(labels ?? [])};
    const candidates=[...document.querySelectorAll(${json(selector)})].filter(el=>
      (${hidden}||!!el.getClientRects().length)&&!el.hidden&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&
      (!labels.length||labels.includes((el.getAttribute('aria-label')||el.textContent||'').trim())));
    if(candidates.length!==1)return false;
    document.querySelectorAll('[data-bycoda-linkedin-extended]').forEach(el=>el.removeAttribute('data-bycoda-linkedin-extended'));
    candidates[0].setAttribute('data-bycoda-linkedin-extended',${json(token)});return true;
  })()`,
    20_000,
  );
  if (!found) throw unsupported();
  return `[data-bycoda-linkedin-extended=${json(token)}]`;
}

async function click(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
) {
  const target = await unique(ctx, selector, token, labels);
  await ctx.verifyIdentity();
  await ctx.page.click(target);
}

function actor(ctx: BrowserRecipeContext): { path: string; home: string } {
  if (ctx.account.platform !== "linkedin" || ctx.account.connection !== "browser") throw denied();
  const member = /^web:linkedin:in:([\w-]+)$/.exec(ctx.account.platformId);
  const company = /^web:linkedin:company:([\w-]+)$/.exec(ctx.account.platformId);
  if (ctx.account.accountType === "member" && member)
    return { path: `/in/${member[1]}`, home: `${origin}/feed/` };
  if (ctx.account.accountType === "organization" && company)
    return {
      path: `/company/${company[1]}`,
      home: `${origin}/company/${company[1]}/admin/page-posts/published/`,
    };
  throw denied();
}

/** Local content-type/size checks supplement the Host's owner-upload validation. */
export async function validateLinkedInPdf(path: string): Promise<void> {
  if (!/\.pdf$/i.test(path)) throw unsupported();
  let handle;
  try {
    handle = await open(path, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 14 || stat.size > 100_000_000) throw unsupported();
    const head = Buffer.alloc(8),
      tail = Buffer.alloc(Math.min(1024, stat.size));
    await handle.read(head, 0, head.length, 0);
    await handle.read(tail, 0, tail.length, stat.size - tail.length);
    if (!/^%PDF-\d\.\d/.test(head.toString("ascii")) || !/%%EOF\s*$/.test(tail.toString("ascii")))
      throw unsupported();
  } catch {
    throw unsupported();
  } finally {
    await handle?.close();
  }
}

/** One image is intentionally required: an unknown multi-image selection cannot
 * be trusted to attach a description to the intended image. */
export async function linkedInApplyImageAlt(
  ctx: BrowserRecipeContext,
  media: SocialMedia[],
): Promise<void> {
  const described = media.filter((item) => item.alt?.trim());
  if (!described.length) return;
  actor(ctx);
  if (
    media.length !== 1 ||
    media[0].kind !== "image" ||
    !media[0].uploadId ||
    !media[0].alt?.trim()
  )
    throw unsupported();
  const description = media[0].alt;
  if (description.length > 1000) throw unsupported();
  const image = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const dialog=document.querySelector('[role="dialog"]');
    return !!dialog&&dialog.querySelectorAll('img[src^="blob:"]').length===1&&!dialog.querySelector('[role="progressbar"],.uploading');
  })()`,
    30_000,
  );
  if (!image) throw unsupported();
  const openEditor = async () =>
    click(ctx, '[role="dialog"] button,[role="dialog"] [role="button"]', "alt-open", [
      "Alt.text",
      "Alt. text",
      "Add alt text",
      "Alternative text",
      "Alternatif metin",
    ]);
  await openEditor();
  const field = await unique(
    ctx,
    '[role="dialog"] textarea,[role="dialog"] input[type="text"]',
    "alt-field",
  );
  await ctx.verifyIdentity();
  await ctx.page.fill(field, description);
  const value = await ctx.page.evaluate<string>(
    `String(document.querySelector(${json(field)})?.value??'')`,
  );
  if (value !== description) throw denied();
  await click(ctx, '[role="dialog"] button', "alt-save", [
    "Save",
    "Add",
    "Done",
    "Kaydet",
    "Ekle",
    "Bitti",
  ]);
  // Reopen the editor to distinguish a saved description from an input echo.
  await openEditor();
  const savedField = await unique(
    ctx,
    '[role="dialog"] textarea,[role="dialog"] input[type="text"]',
    "alt-readback",
  );
  const saved = await ctx.page.evaluate<string>(
    `String(document.querySelector(${json(savedField)})?.value??'')`,
  );
  if (saved !== description) throw denied();
  await click(ctx, '[role="dialog"] button', "alt-close", [
    "Save",
    "Add",
    "Done",
    "Kaydet",
    "Ekle",
    "Bitti",
  ]);
}

/** Call after reopening a persisted post when a described image was submitted. */
export function linkedInImageAltEvidence(postId: string, media: SocialMedia[]): string {
  return String.raw`(() => {
    const rows=[...document.querySelectorAll('[data-urn]')].filter(el=>el.getAttribute('data-urn')===${json(postId)});
    if(rows.length!==1)return false;
    const images=[...rows[0].querySelectorAll('.update-components-image img,.feed-shared-image img')].filter(el=>{try{return /(^|\.)licdn.com$/.test(new URL(el.getAttribute('src')).hostname);}catch{return false;}});
    const expected=${json(media.map((item) => item.alt ?? ""))};
    return images.length===expected.length&&expected.every((alt,index)=>!alt||images[index].getAttribute('alt')===alt);
  })()`;
}

export async function linkedInPublishDocument(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  title: string,
): Promise<SocialSendResult> {
  const own = actor(ctx);
  if (
    job.kind !== "publish" ||
    job.payload.media.length !== 1 ||
    job.payload.media[0].kind !== "document" ||
    !job.payload.media[0].uploadId ||
    job.payload.media[0].url ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "document" ||
    !content(job).trim() ||
    !title.trim() ||
    title.length > 200 ||
    /[\r\n]/.test(title) ||
    title.includes("\0")
  )
    throw unsupported();
  await validateLinkedInPdf(ctx.files[0].path);
  await ctx.page.goto(own.home);
  await ctx.verifyIdentity();
  await click(ctx, "button.share-box-feed-entry__trigger", "post-open");
  // Document is an additional sharing option, not an image attachment.
  const visibleDocument = await ctx.page.evaluate<boolean>(
    String.raw`[...document.querySelectorAll('[role="dialog"] button')].some(el=>['Add a document','Document','Belge ekle','Belge'].includes((el.getAttribute('aria-label')||el.textContent||'').trim())&&el.getClientRects().length)`,
  );
  if (!visibleDocument)
    await click(ctx, '[role="dialog"] button', "post-more", [
      "More",
      "More options",
      "Diğer",
      "Diğer seçenekler",
    ]);
  await click(ctx, '[role="dialog"] button', "document-open", [
    "Add a document",
    "Document",
    "Belge ekle",
    "Belge",
  ]);
  const upload = await unique(
    ctx,
    '[role="dialog"] input[type="file"][accept*="pdf"],[role="dialog"] input[type="file"][accept*="application"]',
    "document-upload",
    undefined,
    true,
  );
  await ctx.verifyIdentity();
  await ctx.page.setFiles(upload, [ctx.files[0].path]);
  const titleField = await unique(
    ctx,
    '[role="dialog"] input[aria-label="Document title"],[role="dialog"] input[placeholder="Document title"],[role="dialog"] input[aria-label="Belge başlığı"]',
    "document-title",
  );
  await ctx.verifyIdentity();
  await ctx.page.fill(titleField, title);
  const ready = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const dialog=document.querySelector('[role="dialog"]'),input=document.querySelector(${json(titleField)});
    return !!dialog&&input?.value===${json(title)}&&!dialog.querySelector('[role="progressbar"],.uploading,.processing')&&
      !!dialog.querySelector('iframe,object[type="application/pdf"],[role="document"]');
  })()`,
    120_000,
  );
  if (!ready) throw unsupported();
  await click(ctx, '[role="dialog"] button', "document-done", ["Done", "Bitti"]);
  const editor = await unique(
    ctx,
    '[role="dialog"] .ql-editor[contenteditable="true"]',
    "post-text",
  );
  const previous = await ctx.page.evaluate<string>(
    `document.querySelector(${json(editor)})?.textContent??''`,
  );
  if (previous.trim()) throw denied();
  await ctx.verifyIdentity();
  await ctx.page.fill(editor, content(job));
  const submit = await unique(ctx, "button.share-actions__primary-action", "document-post", [
    "Post",
    "Yayınla",
    "Paylaş",
  ]);
  const watcher = ctx.page.watchResponse(
    /\/(?:voyager\/api\/)?(?:contentcreation\/normShares|graphql)/,
    (raw) => !!createdId(raw),
  );
  let submitted = false;
  try {
    await ctx.verifyIdentity();
    ctx.markSubmitted?.();
    submitted = true;
    await ctx.page.click(submit);
    const raw = await watcher.body(30_000),
      id = raw && createdId(raw);
    if (!id) throw unknown();
    const url = `${origin}/feed/update/${encodeURIComponent(id)}/`;
    await ctx.page.goto(url);
    const persisted = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const rows=[...document.querySelectorAll('[data-urn]')].filter(el=>el.getAttribute('data-urn')===${json(id)});
      if(rows.length!==1)return false;const row=rows[0],author=row.querySelector('.update-components-actor__meta-link,.feed-shared-actor__container-link');
      const text=row.querySelector('.update-components-text,.feed-shared-update-v2__description');
      if(!author||!text||text.textContent.trim()!==${json(content(job))})return false;
      try{const url=new URL(author.getAttribute('href'),location.origin);if(url.origin!==${json(origin)}||url.pathname.replace(/\/$/,'').toLowerCase()!==${json(own.path)})return false;}catch{return false;}
      return [...row.querySelectorAll('iframe[title],object[aria-label],[role="document"][aria-label]')].some(el=>
        (el.getAttribute('title')||el.getAttribute('aria-label'))===${json(title)});
    })()`,
      30_000,
    );
    if (!persisted) throw unknown();
    await ctx.verifyIdentity();
    return { platformId: id, url };
  } catch (error) {
    if (submitted) throw unknown();
    throw error;
  } finally {
    watcher.stop();
  }
}

function createdId(raw: string): string | undefined {
  try {
    const body = JSON.parse(raw),
      value = body?.value ?? body?.data?.value ?? body?.data?.data?.createContent?.value;
    if (body?.errors?.length || body?.data?.errors?.length) return undefined;
    const id =
      typeof value === "string"
        ? value
        : (value?.entityUrn ?? value?.updateUrn ?? value?.activityUrn);
    return typeof id === "string" && /^urn:li:(?:activity|share|ugcPost):\d+$/.test(id)
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

type Conversation = {
  recipient: string;
  href: string;
  rows: { id: string; sender: string; text: string; at: number }[];
};
function conversationExpression(): string {
  return String.raw`(() => {
    if(location.origin!==${json(origin)})return;
    const threads=[...document.querySelectorAll('.msg-thread,.msg-overlay-conversation-bubble')].filter(el=>el.getClientRects().length);
    if(threads.length!==1)return;const thread=threads[0];
    if(thread.querySelector('input[name="subject"],[aria-label="Subject"],.msg-inmail-credit-count'))return;
    const profiles=[...thread.querySelectorAll('.msg-thread__link-to-profile[href],.msg-entity-lockup__link[href]')].map(el=>{try{
      const url=new URL(el.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
      return url.origin===${json(origin)}&&slug?'web:linkedin:in:'+slug.toLowerCase():null;
    }catch{return null;}}).filter(Boolean);
    const recipients=[...new Set(profiles)];if(recipients.length!==1)return;
    const hrefs=[...thread.querySelectorAll('a[href*="/messaging/thread/"]')].map(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===${json(origin)}&&/^\/messaging\/thread\/[\w:(),-]+\/?$/.test(url.pathname)?url.origin+url.pathname:null;}catch{return null;}}).filter(Boolean);
    const current=/^\/messaging\/thread\/[\w:(),-]+\/?$/.test(location.pathname)?location.origin+location.pathname:null;
    const href=[...new Set([current,...hrefs].filter(Boolean))];if(href.length>1)return;
    const list=thread.querySelector('.msg-s-message-list');if(!list)return;
    const rows=[...list.querySelectorAll('[data-event-urn]')].slice(-100).map(el=>{
      const id=el.getAttribute('data-event-urn'),body=el.querySelector('.msg-s-event-listitem__body'),group=el.closest('.msg-s-message-group')||el;
      const actor=group.querySelector('a.msg-s-message-group__profile-link[href]'),time=el.querySelector('time[datetime]')||group.querySelector('time[datetime]');
      if(!/^urn:li:(?:msg_message|fsd_message):[\w:(),-]+$/.test(id||'')||!body||!actor||!time||el.querySelector('.msg-s-event-listitem--pending'))return null;
      try{const url=new URL(actor.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1],at=Date.parse(time.getAttribute('datetime'));
      return url.origin===${json(origin)}&&slug&&Number.isFinite(at)?{id,sender:'web:linkedin:in:'+slug.toLowerCase(),text:body.textContent.trim(),at}:null;}catch{return null;}
    }).filter(Boolean);
    return {recipient:recipients[0],href:href[0]||'',rows};
  })()`;
}

/** Initiation is restricted to an exact, visibly first-degree member. It never
 * buys InMail, sends an invitation, chooses a name search result, or upgrades. */
export async function linkedInStartMessage(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  actor(ctx);
  const match = /^web:linkedin:in:([\w-]+)$/.exec(job.payload.recipientId ?? "");
  if (
    ctx.account.accountType !== "member" ||
    job.kind !== "message" ||
    !match ||
    !job.payload.text.trim() ||
    job.payload.link ||
    job.payload.media.length ||
    ctx.files.length ||
    job.payload.recipientId === ctx.account.platformId
  )
    throw unsupported();
  const recipient = `web:linkedin:in:${match[1].toLowerCase()}`;
  await ctx.page.goto(`${origin}/in/${match[1]}/`);
  await ctx.verifyIdentity();
  const eligible = await ctx.waitFor<boolean>(
    String.raw`(() => {
    if(location.origin!==${json(origin)}||location.pathname.replace(/\/$/,'').toLowerCase()!==${json(`/in/${match[1].toLowerCase()}`)})return false;
    const main=document.querySelector('main');if(!main||!main.querySelector('h1'))return false;
    const first=[...main.querySelectorAll('.distance-badge,.dist-value')].some(el=>/^(1st|1\.|1\. derece)$/.test((el.textContent||'').trim()));
    const buttons=[...main.querySelectorAll('button,a[role="button"]')].filter(el=>el.getClientRects().length&&!el.disabled&&
      ['Message','Mesaj'].includes((el.getAttribute('aria-label')||el.textContent||'').trim()));
    if(!first||buttons.length!==1)return false;buttons[0].setAttribute('data-bycoda-linkedin-new-message','true');return true;
  })()`,
    20_000,
  );
  if (!eligible) throw denied();
  await ctx.verifyIdentity();
  await ctx.page.click('[data-bycoda-linkedin-new-message="true"]');
  const before = await ctx.waitFor<Conversation>(conversationExpression(), 20_000);
  if (before?.recipient !== recipient) throw denied();
  const editor = await unique(
    ctx,
    '.msg-thread .msg-form__contenteditable[contenteditable="true"],.msg-overlay-conversation-bubble .msg-form__contenteditable[contenteditable="true"]',
    "message-editor",
  );
  const previous = await ctx.page.evaluate<string>(
    `document.querySelector(${json(editor)})?.textContent??''`,
  );
  if (previous.trim()) throw denied();
  await ctx.verifyIdentity();
  await ctx.page.fill(editor, job.payload.text);
  const submit = await unique(
    ctx,
    ".msg-thread button.msg-form__send-button,.msg-overlay-conversation-bubble button.msg-form__send-button",
    "message-send",
    ["Send", "Gönder"],
  );
  const at = ctx.now();
  let submitted = false;
  try {
    await ctx.verifyIdentity();
    const live = await ctx.page.evaluate<Conversation>(conversationExpression());
    if (live?.recipient !== recipient) throw denied();
    ctx.markSubmitted?.();
    submitted = true;
    await ctx.page.click(submit);
    const sent = await ctx.waitFor<Conversation>(conversationExpression(), 30_000);
    if (sent?.recipient !== recipient || !sent.href) throw unknown();
    await ctx.page.goto(sent.href);
    const after = await ctx.waitFor<Conversation>(conversationExpression(), 30_000);
    await ctx.verifyIdentity();
    if (after?.recipient !== recipient || after.href !== sent.href) throw unknown();
    const matches = after.rows.filter(
      (row) =>
        row.sender === ctx.account.platformId &&
        row.text === job.payload.text &&
        row.at >= at - 5000 &&
        !before.rows.some((old) => old.id === row.id),
    );
    if (matches.length !== 1) throw unknown();
    return { platformId: matches[0].id, url: sent.href };
  } catch (error) {
    if (submitted) throw unknown();
    throw error;
  }
}
