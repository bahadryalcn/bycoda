import { youtubeVideoIdPattern } from "../../../src/integrations/social/youtube-manage";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { click, control, denied, json } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  commitYouTubeBrowser,
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubeStudioOrigin,
  type YouTubeBrowserRecipeContext,
} from "./youtube-recipe-guards";

const categories = ["upload", "short", "live"] as const;
const rowSelector = "ytcp-video-row";
const menuLabels = ["Options", "More options", "Seçenekler", "Diğer seçenekler"];
const deleteLabels = ["Delete forever", "DELETE FOREVER", "Kalıcı olarak sil", "KALICI OLARAK SİL"];
const dialogSelector = 'ytcp-video-delete-dialog,ytcp-confirmation-dialog,[role="dialog"]';
const menuItems =
  'ytcp-text-menu [role="option"],ytcp-text-menu [role="menuitem"],[role="menu"] [role="menuitem"]';
const checkboxes = '[role="checkbox"],input[type="checkbox"],tp-yt-paper-checkbox';
const confirmedLabels = [
  "Video deleted",
  "Video deleted permanently",
  "Video permanently deleted",
  "Video silindi",
  "Video kalıcı olarak silindi",
];

type StudioVideo = { id: string; title: string; url: string };
type StudioCategory = { items: StudioVideo[]; complete: boolean };

function readRows(path: string, selectedId?: string) {
  return String.raw`(() => {
    if (location.origin !== ${json(youtubeStudioOrigin)} || location.pathname !== ${json(path)}
      || location.search || !document.querySelector('ytcp-app')) return;
    const visible = el => !el.hidden && el.getClientRects().length;
    const source = [...document.querySelectorAll(${json(rowSelector)})].filter(visible);
    const empty = [...document.querySelectorAll('ytcp-empty-state,ytcp-entity-list-empty-state,ytcp-video-section-content .empty-state')]
      .some(el => visible(el));
    if (!source.length && !empty) return;
    const videos = source.flatMap(row => {
      const titles = row.querySelectorAll('a#video-title[href]');
      if (titles.length !== 1) return [];
      let url;
      try { url = new URL(titles[0].getAttribute('href'), location.origin); } catch { return []; }
      const id = /^\/video\/([\w-]{11})\/edit$/.exec(url.pathname)?.[1];
      if (!id || url.origin !== location.origin || url.username || url.password) return [];
      const title = titles[0].textContent.trim();
      return title ? [{ row, item: { id, title, url: 'https://www.youtube.com/watch?v=' + id } }] : [];
    });
    if ((source.length && !videos.length) || new Set(videos.map(({ item }) => item.id)).size !== videos.length)
      return;
    const id = ${json(selectedId ?? null)};
    if (id) {
      const selected = videos.find(({ item }) => item.id === id);
      if (!selected) return;
      document.querySelectorAll('[data-bycoda-youtube-video]').forEach(el =>
        el.removeAttribute('data-bycoda-youtube-video'));
      selected.row.setAttribute('data-bycoda-youtube-video', id);
      return selected.item;
    }
    return { items: videos.map(({ item }) => item), complete: videos.length === source.length };
  })()`;
}

async function openCategory(ctx: BrowserRecipeContext, category: (typeof categories)[number]) {
  const path = `/channel/${youtubeBrowserChannel(ctx)}/videos/${category}`;
  await ctx.page.goto(`${youtubeStudioOrigin}${path}`);
  await verifyYouTubeBrowser(ctx);
  const result = await ctx.waitFor<StudioCategory>(readRows(path), 10_000);
  if (!result) throw await youtubeBrowserScreenError(ctx);
  return { path, ...result };
}

export async function youtubeListStudioVideos(ctx: BrowserRecipeContext) {
  const items = new Map<string, StudioVideo>();
  for (const category of categories)
    for (const video of (await openCategory(ctx, category)).items) items.set(video.id, video);
  return { items: [...items.values()] };
}

function markDeleteDialog(path: string) {
  return String.raw`(() => {
    if (location.origin !== ${json(youtubeStudioOrigin)} || location.pathname !== ${json(path)}) return false;
    const selector = ${json(dialogSelector)};
    const dialogs = [...document.querySelectorAll(selector)].filter(el =>
      !el.hidden && el.getClientRects().length && !el.parentElement?.closest(selector));
    if (dialogs.length !== 1) return false;
    const dialog = dialogs[0];
    const titles = [...dialog.querySelectorAll('[role="heading"],h1,h2,#dialog-title,#title')];
    if (!titles.some(el => ${json([
      "Delete forever",
      "Delete video?",
      "Delete video",
      "Delete video forever?",
      "Video silinsin mi?",
      "Kalıcı olarak sil",
    ])}.includes(el.textContent.trim()))) return false;
    if (dialog.querySelectorAll(${json(checkboxes)}).length !== 1) return false;
    dialog.setAttribute('data-bycoda-youtube-delete', 'confirmed-target');
    return true;
  })()`;
}

export async function youtubeDeleteStudioVideo(ctx: YouTubeBrowserRecipeContext, videoId: string) {
  if (!youtubeVideoIdPattern.test(videoId)) throw new SocialPlatformError("rejected");
  for (const category of categories) {
    const { path, items } = await openCategory(ctx, category);
    if (!items.some((item) => item.id === videoId)) continue;
    if (
      !(await ctx.page.evaluate<StudioVideo>(readRows(path, videoId))) ||
      (await ctx.page
        .evaluate<boolean>(`[...document.querySelectorAll(${json(`${dialogSelector},${menuItems}`)})]
        .some(el => !el.hidden && el.getClientRects().length)`))
    )
      throw denied();
    await click(
      ctx,
      `[data-bycoda-youtube-video=${json(videoId)}] button,
       [data-bycoda-youtube-video=${json(videoId)}] [role="button"]`,
      "youtube-video-options",
      menuLabels,
    );
    await click(ctx, menuItems, "youtube-video-delete-menu", deleteLabels);
    if (!(await ctx.waitFor<boolean>(markDeleteDialog(path), 10_000)))
      throw await youtubeBrowserScreenError(ctx);
    const dialog = '[data-bycoda-youtube-delete="confirmed-target"]';
    const checkbox = `${dialog} :is(${checkboxes})`;
    await click(ctx, checkbox, "youtube-video-delete-acknowledge");
    if (
      !(await ctx.page.evaluate<boolean>(`(() => {
        const el = document.querySelector(${json(checkbox)});
        return !!el && (el.checked === true || el.getAttribute('aria-checked') === 'true' || el.hasAttribute('checked'));
      })()`))
    )
      throw denied();
    const notice = `(location.origin === ${json(youtubeStudioOrigin)} && [...document.querySelectorAll(
      'ytcp-toast,[role="status"],[role="alert"],tp-yt-paper-toast')].some(el =>
      !el.hidden && el.getClientRects().length && ${json(confirmedLabels)}.includes(el.textContent.trim())))`;
    if (await ctx.page.evaluate<boolean>(notice)) throw denied();
    const submit = await control(
      ctx,
      `${dialog} button,${dialog} [role="button"]`,
      "youtube-video-delete-submit",
      deleteLabels,
    );
    return await commitYouTubeBrowser(ctx, submit, async () => {
      if (!(await ctx.waitFor<boolean>(notice, 20_000))) return;
      const latest = await openCategory(ctx, category);
      if (!latest.complete || latest.items.some((item) => item.id === videoId)) return;
      return { id: videoId, deleted: true as const };
    });
  }
  throw denied();
}
