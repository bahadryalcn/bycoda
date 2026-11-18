import { SocialPlatformError, type SocialSendResult } from "../../src/integrations/social/adapter";
import {
  commitYouTubeBrowser,
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubePublicOrigin,
} from "./browser/youtube-recipe-guards";
import { click, control, files, fill, json } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

export type YouTubeCommunityPost = {
  kind: "text" | "image" | "poll";
  text: string;
  choices?: string[];
  imageUploadIds?: string[];
};

const dialog = "ytd-backstage-post-dialog-renderer";
const editor = `${dialog} #contenteditable-root[contenteditable="true"]`;
const poll = `${dialog} ytd-backstage-poll-editor-renderer`;
const submit = `${dialog} #submit-button button,${dialog} button#submit-button`;
const invalid = () => new SocialPlatformError("rejected");

export function parseYouTubeCommunityPost(raw: unknown): YouTubeCommunityPost {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["kind", "text", "choices", "imageUploadIds"].includes(key))) throw invalid();
  const { kind, text, choices, imageUploadIds } = value;
  if ((kind !== "text" && kind !== "image" && kind !== "poll") || typeof text !== "string" || [...text].length > 1_500 || text.includes("\0") || (kind !== "image" && !text.trim())) throw invalid();
  if (kind === "poll") {
    if (imageUploadIds !== undefined || !Array.isArray(choices) || choices.length < 2 || choices.length > 4 || choices.some((choice) => typeof choice !== "string" || !choice.trim() || [...choice].length > 65 || /[\p{Cc}]/u.test(choice))) throw invalid();
    const normalized = choices.map((choice: string) => choice.trim());
    if (new Set(normalized).size !== normalized.length) throw invalid();
    return { kind, text: text.trim(), choices: normalized };
  }
  if (choices !== undefined) throw invalid();
  if (kind === "image") {
    if (!Array.isArray(imageUploadIds) || !imageUploadIds.length || imageUploadIds.length > 10 || imageUploadIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) || new Set(imageUploadIds).size !== imageUploadIds.length) throw invalid();
    return { kind, text: text.trim(), imageUploadIds };
  }
  if (imageUploadIds !== undefined) throw invalid();
  return { kind, text: text.trim() };
}

function currentPostIds(path: string) {
  return String.raw`(() => {
    if(location.origin!==${json(youtubePublicOrigin)}||location.pathname!==${json(path)}||!document.querySelector('ytd-browse[page-subtype="channels"]'))return;
    return [...document.querySelectorAll('ytd-backstage-post-thread-renderer a[href*="/post/"]')].map(el=>{
      try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin?(/^\/post\/([\w-]{10,150})$/.exec(url.pathname)?.[1]):undefined;}catch{return;}
    }).filter(Boolean);
  })()`;
}

async function openComposer(ctx: BrowserRecipeContext) {
  await click(ctx, "ytd-masthead #create-icon button,ytd-masthead #create-button button", "community-create", ["Create", "Oluştur"]);
  // The Create post entry is absent for channels without Posts access.
  const labels = ["Create post", "Gönderi oluştur"];
  await click(ctx, "ytd-menu-popup-renderer ytd-menu-service-item-renderer,ytd-menu-popup-renderer a[role=menuitem]", "community-create-post", labels);
}

async function prepareCommunityPoll(ctx: BrowserRecipeContext, choices: string[]) {
  await click(ctx, `${dialog} #poll-button button,${dialog} button#poll-button`, "community-poll", ["Poll", "Anket"]);
  await click(ctx, `${dialog} #text-poll-button`, "community-text-poll", ["Text poll", "Metin anketi"]);
  for (let index = 0; index < choices.length; index++) {
    if (index >= 2) await click(ctx, `${poll} #add-option-button`, "community-add-option", ["Add another option", "Başka seçenek ekle"]);
    await fill(ctx, `${poll} ytd-backstage-poll-option-editor-renderer:nth-of-type(${index + 1}) input`, "community-poll-option", choices[index]);
  }
}

async function prepareCommunityImage(ctx: BrowserRecipeContext, count: number) {
  await click(ctx, `${dialog} #image-button button,${dialog} button#image-button`, "community-image", ["Image", "Resim"]);
  await files(ctx, `${dialog} input[type="file"][accept*="image"]`);
  const ready = await ctx.waitFor<boolean>(String.raw`(() => {
    const images=[...document.querySelectorAll(${json(`${dialog} ytd-backstage-image-editor-renderer img` )})].filter(el=>el.getClientRects().length&&el.complete&&el.naturalWidth>0);
    return images.length===${count};
  })()`, 30_000);
  if (!ready) throw await youtubeBrowserScreenError(ctx);
}

function communityReceipt(path: string, channel: string, text: string, previous: string[]) {
  return String.raw`(() => {
    if(location.origin!==${json(youtubePublicOrigin)}||location.pathname!==${json(path)})return;
    const visible=el=>!!el&&!el.hidden&&el.getClientRects().length;
    if([...document.querySelectorAll(${json(dialog)})].some(visible))return;
    const receipt=[...document.querySelectorAll('ytd-notification-action-renderer #text,[role="status"]')].filter(el=>visible(el)&&['Post created','Your post was published','Gönderi oluşturuldu','Gönderiniz yayınlandı'].includes(el.textContent.trim()));
    if(receipt.length!==1)return;
    const expected=${json(text)}, previous=new Set(${json(previous)});
    const channelPath=${json(`/channel/${channel}`)};
    const ids=[...document.querySelectorAll('ytd-backstage-post-thread-renderer')].filter(row=>{
      if(!visible(row)||row.querySelector('#content-text')?.textContent.trim()!==expected)return false;
      return [...row.querySelectorAll('a#author-text')].some(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&url.pathname===channelPath;}catch{return false;}});
    }).flatMap(row=>[...row.querySelectorAll('a[href*="/post/"]')].map(el=>{
      try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin?(/^\/post\/([\w-]{10,150})$/.exec(url.pathname)?.[1]):undefined;}catch{return;}
    })).filter(id=>id&&!previous.has(id));
    const distinct=[...new Set(ids)];if(distinct.length===1)return distinct[0];
  })()`;
}

/** Public Posts API access is limited to individually approved Cloud projects. */
export async function youtubePublishCommunity(ctx: BrowserRecipeContext, raw: unknown): Promise<SocialSendResult> {
  const post = parseYouTubeCommunityPost(raw);
  const expectedImages = post.imageUploadIds?.length ?? 0;
  if (ctx.files.length !== expectedImages || ctx.files.some((item) => item.kind !== "image")) throw invalid();
  const channel = youtubeBrowserChannel(ctx);
  const path = `/channel/${channel}/posts`;
  const url = `${youtubePublicOrigin}${path}`;
  await ctx.page.goto(url);
  await verifyYouTubeBrowser(ctx);
  try {
    const previous = await ctx.waitFor<string[]>(currentPostIds(path), 20_000);
    if (!previous) throw await youtubeBrowserScreenError(ctx);
    await openComposer(ctx);
    if (post.choices) await prepareCommunityPoll(ctx, post.choices);
    if (expectedImages) await prepareCommunityImage(ctx, expectedImages);
    if (post.text) await fill(ctx, editor, "community-text", post.text);
    const controlSelector = await control(ctx, submit, "community-submit", ["Post", "Yayınla"]);
    return await commitYouTubeBrowser(ctx, controlSelector, async () => {
      const id = await ctx.waitFor<string>(communityReceipt(path, channel, post.text, previous), 30_000);
      return id ? { platformId: id, url: `${youtubePublicOrigin}/post/${id}`, visibility: "public" } : undefined;
    });
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported") throw await youtubeBrowserScreenError(ctx);
    throw error;
  }
}
