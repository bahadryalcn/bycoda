import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { click, control, denied, fill, json } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { detectChallenge, needsHumanError } from "./challenge";
import {
  commitYouTubeBrowser,
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubePublicOrigin,
  type YouTubeBrowserRecipeContext,
} from "./youtube-recipe-guards";

export type YouTubePostStatus = "published" | "scheduled";
export const youtubeCommunityDialog = "ytd-backstage-post-dialog-renderer";
export const youtubeCommunityEditor = `${youtubeCommunityDialog} #contenteditable-root[contenteditable="true"]`;
export const youtubeCommunitySubmit = `${youtubeCommunityDialog} #submit-button button,${youtubeCommunityDialog} button#submit-button`;
const rowSelector = "ytd-backstage-post-thread-renderer";
const postIdPattern = /^[\w-]{10,150}$/;
const scheduledTabs =
  'ytd-browse[page-subtype="channels"] [role="tab"],ytd-browse[page-subtype="channels"] yt-tab-shape:not(:has([role="tab"]))';
const scheduledLabels = ["Scheduled", "Planlandı", "Planlananlar"];

type PostRow = { id: string; text: string; publishAt?: string; url: string };

/** Return only visible posts whose canonical author and permalink match the verified channel. */
export function communityRows(path: string, channel: string, selectedId?: string) {
  return String.raw`(() => {
    if(location.origin!==${json(youtubePublicOrigin)}||location.pathname!==${json(path)}||!document.querySelector('ytd-browse[page-subtype="channels"]'))return;
    const pathOf=(el)=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin?url.pathname:undefined;}catch{return;}};
    const visible=el=>!el.hidden&&el.getClientRects().length;
    const rows=[...document.querySelectorAll(${json(rowSelector)})].filter(visible).flatMap(row=>{
      const authors=[...new Set([...row.querySelectorAll('a#author-text')].map(pathOf))];
      if(authors.length!==1||authors[0]!==${json(`/channel/${channel}`)})return [];
      const ids=[...new Set([...row.querySelectorAll('a[href*="/post/"]')].map(el=>/^\/post\/([\w-]{10,150})$/.exec(pathOf(el)??"")?.[1]).filter(Boolean))];
      if(ids.length!==1)return [];
      const id=ids[0];
      const publishAt=row.querySelector('time[datetime]')?.getAttribute('datetime');
      const data={id,text:(row.querySelector('#content-text')?.textContent??"").trim(),
        url:location.origin+'/post/'+id,...(publishAt?{publishAt}:{})};
      return [{row,data}];
    });
    const selectedId=${json(selectedId ?? null)};
    if(selectedId){
      const matches=rows.filter(({data})=>data.id===selectedId);
      if(matches.length!==1)return;
      document.querySelectorAll('[data-bycoda-community-post]').forEach(el=>el.removeAttribute('data-bycoda-community-post'));
      matches[0].row.setAttribute('data-bycoda-community-post',selectedId);
      return matches[0].data;
    }
    return rows.map(({data})=>data);
  })()`;
}

export function communityNotice(labels: string[]) {
  return String.raw`[...document.querySelectorAll('ytd-notification-action-renderer #text,[role="status"],tp-yt-paper-toast #text')]
    .filter(el=>!el.hidden&&el.getClientRects().length&&${json(labels)}.includes(el.textContent.trim())).length===1`;
}

export function communityPath(channel: string): string {
  return `/channel/${channel}/posts`;
}

export async function selectScheduledCommunity(ctx: BrowserRecipeContext, optional = false) {
  const state = String.raw`(() => {
    const tabs=[...document.querySelectorAll(${json(scheduledTabs)})].filter(el=>
      !el.hidden&&el.getClientRects().length&&${json(scheduledLabels)}.includes((el.getAttribute('aria-label')||el.textContent).trim()));
    return {count:tabs.length,selected:tabs.length===1&&(tabs[0].getAttribute('aria-selected')==='true'||tabs[0].hasAttribute('selected'))};
  })()`;
  if (optional && (await ctx.page.evaluate<{ count: number }>(state)).count === 0) return false;
  try {
    if (!(await ctx.page.evaluate<{ selected: boolean }>(state)).selected)
      await click(ctx, scheduledTabs, "community-scheduled-view", scheduledLabels);
    if (!(await ctx.waitFor<boolean>(`${state}.selected`, 20_000)))
      throw await youtubeBrowserScreenError(ctx);
    return true;
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported")
      throw await youtubeBrowserScreenError(ctx);
    throw error;
  }
}

export async function openCommunityView(ctx: BrowserRecipeContext, status: YouTubePostStatus) {
  const channel = youtubeBrowserChannel(ctx);
  const path = communityPath(channel);
  await ctx.page.goto(`${youtubePublicOrigin}${path}`);
  await verifyYouTubeBrowser(ctx);
  if (status === "scheduled") await selectScheduledCommunity(ctx);
  return { channel, path };
}

export async function youtubeListCommunity(ctx: BrowserRecipeContext, status: YouTubePostStatus) {
  const { path, channel } = await openCommunityView(ctx, status);
  const items = await ctx.waitFor<PostRow[]>(communityRows(path, channel), 20_000);
  if (!items) throw await youtubeBrowserScreenError(ctx);
  return { items: items.slice(0, 100).map((item) => ({ ...item, status })) };
}

async function communityPostMenu(
  ctx: BrowserRecipeContext,
  postId: string,
  status: YouTubePostStatus,
  labels: string[],
) {
  if (!postIdPattern.test(postId)) throw new SocialPlatformError("rejected");
  const { path, channel } = await openCommunityView(ctx, status);
  const row = await ctx.waitFor<PostRow>(communityRows(path, channel, postId), 20_000);
  if (!row) throw await youtubeBrowserScreenError(ctx);
  try {
    await click(
      ctx,
      `[data-bycoda-community-post=${json(postId)}] #menu button`,
      "community-post-menu",
      ["More actions", "Action menu", "More", "Diğer işlemler", "Diğer"],
    );
    const action = await control(
      ctx,
      "ytd-menu-popup-renderer ytd-menu-service-item-renderer,ytd-menu-popup-renderer [role=menuitem]",
      "community-post-action",
      labels,
    );
    return { path, channel, row, action };
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported")
      throw await youtubeBrowserScreenError(ctx);
    throw error;
  }
}

export async function youtubeEditCommunity(
  ctx: BrowserRecipeContext,
  postId: string,
  text: string,
  status: YouTubePostStatus,
) {
  const { path, channel, row, action } = await communityPostMenu(ctx, postId, status, [
    "Edit",
    "Düzenle",
  ]);
  await verifyYouTubeBrowser(ctx);
  await ctx.page.click(action);
  const shown = await ctx.waitFor<string>(
    String.raw`(() => {const el=document.querySelector(${json(youtubeCommunityEditor)});return el?.textContent?.trim();})()`,
    20_000,
  );
  if (shown === undefined) throw await youtubeBrowserScreenError(ctx);
  if (shown !== row.text) throw denied();
  if (row.text === text) return { ...row, changed: false };
  await fill(ctx, youtubeCommunityEditor, "community-edit-text", text, true);
  const target = await control(ctx, youtubeCommunitySubmit, "community-save-edit", [
    "Save",
    "Kaydet",
  ]);
  return await commitYouTubeBrowser(ctx, target, async () => {
    const acknowledged = await ctx.waitFor<boolean>(
      `(${communityNotice(["Post updated", "Post saved", "Gönderi güncellendi", "Gönderi kaydedildi"])})`,
      30_000,
    );
    if (!acknowledged) return;
    const current = await ctx.waitFor<PostRow>(communityRows(path, channel, postId), 20_000);
    return current?.text === text ? { ...current, changed: true } : undefined;
  });
}

async function communityPostStatus(ctx: BrowserRecipeContext, postId: string) {
  const path = `/post/${postId}`;
  await ctx.page.goto(`${youtubePublicOrigin}${path}`);
  const status = await ctx.waitFor<number>(
    String.raw`(() => {
      if(location.origin!==${json(youtubePublicOrigin)}||location.pathname!==${json(path)}||
          document.readyState!=='complete')return;
      const response=performance.getEntriesByType('navigation')[0];
      if(!response?.name||!response.responseStatus)return;
      const address=new URL(response.name);
      if(address.origin===location.origin&&address.pathname===location.pathname)
        return response.responseStatus;
    })()`,
    12_000,
  );
  const challenge = await detectChallenge(ctx.page);
  if (challenge) throw needsHumanError(challenge);
  return status;
}

export async function youtubeDeleteCommunity(
  ctx: YouTubeBrowserRecipeContext,
  postId: string,
  status: YouTubePostStatus,
) {
  if (!postIdPattern.test(postId)) throw new SocialPlatformError("rejected");
  const before = await communityPostStatus(ctx, postId);
  const { path, action } = await communityPostMenu(ctx, postId, status, ["Delete", "Sil"]);
  const confirm =
    "yt-confirm-dialog-renderer #confirm-button button,yt-confirm-dialog-renderer button#confirm-button";
  const notice = communityNotice(["Post deleted", "Gönderi silindi"]);
  if (await ctx.page.evaluate<boolean>(`(${notice})`)) throw await youtubeBrowserScreenError(ctx);
  return await commitYouTubeBrowser(ctx, action, async () => {
    const stage = await ctx.waitFor<"deleted" | "confirm">(
      String.raw`(() => {
        if(${notice})return "deleted";
        if([...document.querySelectorAll(${json(confirm)})].some(el=>!el.hidden&&el.getClientRects().length))return "confirm";
      })()`,
      20_000,
    );
    if (stage === "confirm") {
      const target = await control(ctx, confirm, "community-confirm-delete", ["Delete", "Sil"]);
      await verifyYouTubeBrowser(ctx);
      await ctx.beforeYouTubeSubmission?.();
      await ctx.page.click(target);
    }
    const acknowledged = stage && (await ctx.waitFor<boolean>(`(${notice})`, 30_000));
    // A temporarily empty list and an already inaccessible link cannot prove deletion.
    if (!acknowledged || before !== 200 || (await communityPostStatus(ctx, postId)) !== 404) return;
    await ctx.page.goto(`${youtubePublicOrigin}${path}`);
    return { id: postId, deleted: true };
  });
}
