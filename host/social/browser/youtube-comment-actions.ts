import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { json } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  commitYouTubeBrowser,
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubePublicOrigin,
  youtubeStudioOrigin,
} from "./youtube-recipe-guards";

export type YouTubeCommentReaction = {
  commentId: string;
  reaction: "like" | "heart";
  enabled: boolean;
  videoId?: string;
  authorChannelId?: string;
};

const reactionControls = {
  like: {
    selectors: "#like-button button,button#like-button,ytcp-icon-button#like-button",
    labels: ["Like", "Unlike", "Remove like", "Beğen", "Beğenmekten vazgeç"],
  },
  heart: {
    selectors: "#heart-button button,button#heart-button,ytcp-icon-button#heart-button",
    labels: ["Heart", "Remove heart", "Kalp bırak", "Kalbi kaldır"],
  },
};
const marker = "[data-bycoda-youtube-reaction]";

export async function youtubeCommentReaction(
  ctx: BrowserRecipeContext,
  input: YouTubeCommentReaction,
) {
  const channel = youtubeBrowserChannel(ctx);
  const { commentId, reaction, enabled, videoId, authorChannelId } = input;
  if (
    !/^[\w-]{10,200}$/.test(commentId) ||
    (reaction !== "like" && reaction !== "heart") ||
    typeof enabled !== "boolean" ||
    (videoId !== undefined && !/^[\w-]{11}$/.test(videoId)) ||
    (authorChannelId !== undefined && !/^UC[\w-]{22}$/.test(authorChannelId))
  )
    throw new SocialPlatformError("rejected");
  const watch = reaction === "like" && !!videoId;
  const url = watch
    ? `${youtubePublicOrigin}/watch?${new URLSearchParams({ v: videoId!, lc: commentId })}`
    : `${youtubeStudioOrigin}/channel/${channel}/comments/inbox`;
  const route = new URL(url);
  const rows = watch ? "ytd-comment-view-model,ytd-comment-renderer" : "ytcp-comment-thread";
  const controls = reactionControls[reaction];
  const probe = (mark = false, expected?: boolean) => String.raw`(() => {
    if(location.origin!==${json(route.origin)}||location.pathname!==${json(route.pathname)})return;
    if(${watch}&&document.querySelector('ytd-watch-flexy')?.getAttribute('video-id')!==${json(videoId ?? null)})return;
    const visible=el=>!!el&&!el.hidden&&el.getClientRects().length;
    const rows=${json(rows)};
    const exactLink=el=>{try{
      const url=new URL(el.getAttribute('href'),${json(youtubePublicOrigin)});
      return url.origin===${json(youtubePublicOrigin)}&&url.pathname==='/watch'&&url.searchParams.get('lc')===${json(commentId)}&&(!${json(videoId ?? "")}||url.searchParams.get('v')===${json(videoId ?? "")});
    }catch{return false;}};
    const matches=[...document.querySelectorAll(rows)].filter(row=>visible(row)&&[...row.querySelectorAll('a[href*="lc="]')].some(el=>el.closest(rows)===row&&exactLink(el)));
    if(matches.length!==1)return;
    const row=matches[0], author=${json(authorChannelId ?? "")};
    if(author){
      const authors=[...row.querySelectorAll('a[href*="/channel/"]')].filter(el=>el.closest(rows)===row&&visible(el));
      if(!authors.length||authors.some(el=>{try{
        const url=new URL(el.getAttribute('href'),${json(youtubePublicOrigin)});
        return url.origin!==${json(youtubePublicOrigin)}||url.pathname!=='/channel/'+author;
      }catch{return true;}}))return;
    }
    const options=[...row.querySelectorAll(${json(controls.selectors)})].filter(el=>el.closest(rows)===row&&visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&${json(controls.labels)}.includes(el.getAttribute('aria-label')));
    if(options.length!==1)return;
    const control=options[0], pressed=control.getAttribute('aria-pressed');
    if(!['true','false'].includes(pressed))return;
    const enabled=pressed==='true';
    if(${expected === undefined ? "false" : `enabled!==${expected}`})return;
    if(${mark}){
      document.querySelectorAll(${json(marker)}).forEach(el=>el.removeAttribute('data-bycoda-youtube-reaction'));
      control.setAttribute('data-bycoda-youtube-reaction','true');
    }
    return {enabled};
  })()`;

  await ctx.page.goto(url);
  await verifyYouTubeBrowser(ctx);
  const before = await ctx.waitFor<{ enabled: boolean }>(probe(), 20_000);
  if (!before) throw await youtubeBrowserScreenError(ctx);
  if (before.enabled === enabled) return { commentId, reaction, enabled, changed: false };
  await verifyYouTubeBrowser(ctx);
  const marked = await ctx.page.evaluate<{ enabled: boolean }>(probe(true, !enabled));
  if (!marked) throw await youtubeBrowserScreenError(ctx);
  return commitYouTubeBrowser(ctx, marker, async () => {
    if (!(await ctx.waitFor<{ enabled: boolean }>(probe(false, enabled), 20_000))) return;
    await ctx.page.goto(url);
    await verifyYouTubeBrowser(ctx);
    if (!(await ctx.waitFor<{ enabled: boolean }>(probe(false, enabled), 20_000))) return;
    return { commentId, reaction, enabled, changed: true };
  });
}
