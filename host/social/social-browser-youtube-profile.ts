import { SocialPlatformError } from "../../src/integrations/social/adapter";
import {
  commitYouTubeBrowser,
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubeStudioOrigin,
} from "./browser/youtube-recipe-guards";
import { click, control, files, fill, json } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

type ProfileLink = { title: string; url: string };
export type YouTubeBrowserProfilePatch = {
  name?: string;
  handle?: string;
  links?: ProfileLink[];
  avatarUploadId?: string;
};
export type YouTubeBrowserProfile = { name: string; handle: string; links: ProfileLink[]; avatarUrl?: string };

const root = "ytcp-channel-customization";
const nameField = `${root} #channel-name input`;
const handleField = `${root} #channel-handle input`;
const linksRoot = `${root} #links-section`;
const linkRow = "ytcp-channel-link";
const avatarSection = `${root} #avatar-section`;
const publish = `${root} ytcp-button#publish-button,${root} button#publish-button`;

const invalid = () => new SocialPlatformError("rejected");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || /[\p{Cc}]/u.test(value))
    throw invalid();
  return value.trim();
}

function profileLink(value: unknown): ProfileLink {
  if (!record(value) || Object.keys(value).some((key) => key !== "title" && key !== "url"))
    throw invalid();
  const title = boundedText(value.title, 100);
  const url = URL.parse(boundedText(value.url, 2_048));
  if (!url || url.protocol !== "https:" || url.username || url.password) throw invalid();
  return { title, url: url.href };
}

export function parseYouTubeBrowserProfilePatch(value: unknown): YouTubeBrowserProfilePatch {
  if (!record(value)) throw invalid();
  const patch: YouTubeBrowserProfilePatch = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === "name") patch.name = boundedText(field, 100);
    else if (key === "handle") {
      const handle = boundedText(field, 31).replace(/^@/, "");
      if (!/^[\p{L}\p{N}\p{M}_.·-]{1,30}$/u.test(handle)) throw invalid();
      patch.handle = `@${handle}`;
    } else if (key === "avatarUploadId" && typeof field === "string" && /^[a-f0-9-]{36}$/i.test(field)) {
      patch.avatarUploadId = field;
    } else if (key === "links" && Array.isArray(field) && field.length <= 14) {
      patch.links = field.map(profileLink);
    } else throw invalid();
  }
  if (!Object.keys(patch).length) throw invalid();
  return patch;
}

function profileSnapshot(path: string): string {
  return String.raw`(() => {
    if(location.origin!==${json(youtubeStudioOrigin)}||location.pathname!==${json(path)})return;
    const visible=el=>!!el&&!el.hidden&&el.getClientRects().length;
    const one=(scope,selector)=>{const matches=[...scope.querySelectorAll(selector)].filter(visible);return matches.length===1?matches[0]:undefined;};
    const profile=one(document,${json(root)}), name=one(document,${json(nameField)}), handle=one(document,${json(handleField)}), links=one(document,${json(linksRoot)});
    if(!profile||!name||!handle||!links||typeof name.value!=='string'||typeof handle.value!=='string'||!one(document,${json(publish)}))return;
    const rows=[...links.querySelectorAll(${json(linkRow)})].filter(visible);
    if(rows.length>14)return;
    const values=rows.map(row=>{
      const title=one(row,'#link-title input'), url=one(row,'#link-url input');
      if(!title||!url)return;
      let canonical=url.value;try{canonical=new URL(canonical).href;}catch{}
      return {title:title.value,url:canonical};
    });
    if(values.some(row=>!row))return;
    const raw=one(document,${json(`${avatarSection} img`)})?.getAttribute('src');
    let avatarUrl;try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password&&['yt3.ggpht.com','yt3.googleusercontent.com'].includes(url.hostname))avatarUrl=url.href;}catch{}
    return {name:name.value,handle:handle.value.startsWith('@')?handle.value:'@'+handle.value,links:values,avatarUrl};
  })()`;
}

async function readProfile(ctx: BrowserRecipeContext, snapshot: string) {
  const result = await ctx.waitFor<YouTubeBrowserProfile>(snapshot, 20_000);
  if (!result) throw await youtubeBrowserScreenError(ctx);
  return result;
}

async function openProfile(ctx: BrowserRecipeContext) {
  const path = `/channel/${youtubeBrowserChannel(ctx)}/editing/profile`;
  const url = `${youtubeStudioOrigin}${path}`;
  const snapshot = profileSnapshot(path);
  await ctx.page.goto(url);
  await verifyYouTubeBrowser(ctx);
  return { url, snapshot, value: await readProfile(ctx, snapshot) };
}

export async function youtubeBrowserProfile(ctx: BrowserRecipeContext) {
  const { value } = await openProfile(ctx);
  await verifyYouTubeBrowser(ctx);
  return value;
}

async function replaceProfileLinks(ctx: BrowserRecipeContext, snapshot: string, before: ProfileLink[], next: ProfileLink[]) {
  for (let index = before.length; index > next.length; index--) {
    await click(ctx, `${linksRoot} ${linkRow}:nth-of-type(${index}) #remove-link`, "profile-remove-link", ["Remove link", "Bağlantıyı kaldır"]);
    if ((await readProfile(ctx, snapshot)).links.length !== index - 1) throw await youtubeBrowserScreenError(ctx);
  }
  for (let index = 0; index < next.length; index++) {
    if (index >= before.length) {
      await click(ctx, `${linksRoot} #add-link`, "profile-add-link", ["Add link", "Bağlantı ekle"]);
      if ((await readProfile(ctx, snapshot)).links.length !== index + 1) throw await youtubeBrowserScreenError(ctx);
    }
    const row = `${linksRoot} ${linkRow}:nth-of-type(${index + 1})`;
    const link = next[index];
    await fill(ctx, `${row} #link-title input`, "profile-link-title", link.title, true);
    await fill(ctx, `${row} #link-url input`, "profile-link-url", link.url, true);
  }
}

function matchesPatch(value: YouTubeBrowserProfile, patch: YouTubeBrowserProfilePatch, before: YouTubeBrowserProfile) {
  return (
    (patch.name === undefined || value.name === patch.name) &&
    (patch.handle === undefined || value.handle === patch.handle) &&
    (patch.links === undefined || json(value.links) === json(patch.links)) &&
    (patch.avatarUploadId === undefined || (!!value.avatarUrl && value.avatarUrl !== before.avatarUrl))
  );
}

export async function youtubeUpdateBrowserProfile(ctx: BrowserRecipeContext, raw: unknown) {
  const patch = parseYouTubeBrowserProfilePatch(raw);
  if (ctx.files.length !== (patch.avatarUploadId ? 1 : 0) || ctx.files.some((item) => item.kind !== "image")) throw invalid();
  const { value: before, snapshot, url } = await openProfile(ctx);
  if (matchesPatch(before, patch, before)) return before;
  if (patch.name !== undefined) await fill(ctx, nameField, "profile-name", patch.name, true);
  if (patch.handle !== undefined) await fill(ctx, handleField, "profile-handle", patch.handle.replace(/^@/, ""), true);
  if (patch.links !== undefined) await replaceProfileLinks(ctx, snapshot, before.links, patch.links);
  if (patch.avatarUploadId) {
    await files(ctx, `${avatarSection} input[type="file"][accept*="image"]`);
    await click(ctx, 'ytcp-image-cropper-dialog #done-button', "profile-avatar-crop", ["Done", "Bitti"]);
  }
  const prepared = await readProfile(ctx, snapshot);
  if (!matchesPatch(prepared, patch, before)) throw await youtubeBrowserScreenError(ctx);
  const target = await control(ctx, publish, "profile-publish", ["Publish", "Yayınla"]);
  return commitYouTubeBrowser(ctx, target, async () => {
    const saved = await ctx.waitFor<boolean>(String.raw`(() => {
      const matches=[...document.querySelectorAll(${json(publish)})].filter(el=>el.getClientRects().length&&!el.hidden);
      return matches.length===1&&(matches[0].disabled||matches[0].getAttribute('aria-disabled')==='true');
    })()`, 20_000);
    if (!saved) return;
    await ctx.page.goto(url);
    await verifyYouTubeBrowser(ctx);
    const persisted = await readProfile(ctx, snapshot);
    if (matchesPatch(persisted, patch, before)) return persisted;
  });
}
