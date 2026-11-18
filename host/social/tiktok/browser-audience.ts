import { denied, json, unknown, unsupported } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  creatorExpression,
  markedTikTokCreatorControl,
  openTikTokCreatorPage,
  ownerHandle,
  readTikTokCreatorPage,
  submitTikTokCreatorAction,
  TIKTOK_ORIGIN,
  TIKTOK_WEB_ID,
} from "./browser-creator-page";

export type TikTokRelationshipKind = "followers" | "following";
export type TikTokRelationship = {
  platformId: string;
  username: string;
  name: string;
  url: string;
};

const profile = (handle: string, body: string) =>
  creatorExpression(
    `/@${handle}`,
    String.raw`
  const title = one(document, '[data-e2e="user-title"]');
  const main = title?.closest('main,[role="main"]');
  if (!main || label(title).replace(/^@/, '').toLowerCase() !== ${json(handle)}) return;
  ${body}
`,
  );

export async function listTikTokRelationships(
  ctx: BrowserRecipeContext,
  kind: TikTokRelationshipKind,
  limit = 40,
): Promise<{ people: TikTokRelationship[]; coverage: "visible" }> {
  if (
    (kind !== "followers" && kind !== "following") ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw denied();
  const own = ownerHandle(ctx);
  await openTikTokCreatorPage(ctx, `/@${own}`);
  await readTikTokCreatorPage<boolean>(
    ctx,
    profile(
      own,
      `
    const count = one(main, ${json(`[data-e2e="${kind}-count"]`)});
    const button = count?.closest('button,[role="button"]');
    if (!button || !enabled(button)) return;
    return mark(button, 'relationships-open');`,
    ),
  );
  await ctx.page.click(markedTikTokCreatorControl("relationships-open"));
  const people = await readTikTokCreatorPage<TikTokRelationship[]>(
    ctx,
    profile(
      own,
      String.raw`
    const root = one(document, '[role="dialog"],dialog[open]');
    const tab = root && one(root, '[role="tab"][aria-selected="true"]');
    const labels = ${json(kind === "followers" ? ["Followers", "Takipçiler"] : ["Following", "Takip edilenler"])};
    if (!tab || !labels.includes(label(tab).replace(/\s+[\d.,]+[KMB]?$/i,''))) return;
    const id = tab.getAttribute('aria-controls');
    const list = id ? document.getElementById(id) : one(root, '[role="tabpanel"]');
    if (!list || !root.contains(list) || !visible(list) || list.getAttribute('aria-busy') === 'true') return;
    const rows = new Map();
    for (const el of all(list, 'a[href^="/@"]')) {
      const url = new URL(el.getAttribute('href'),location.origin);
      const username = /^\/@([\w.]{2,24})\/?$/.exec(url.pathname)?.[1]?.toLowerCase();
      if (!username || url.origin !== location.origin || rows.has(username)) continue;
      rows.set(username, {platformId:'web:tiktok:'+username,username,name:label(el).slice(0,160)||username,
        url:location.origin+'/@'+username});
      if (rows.size === ${limit}) break;
    }
    if (!rows.size && !one(list, '[data-e2e="empty-list"]')) return;
    return [...rows.values()];`,
    ),
  );
  return { people, coverage: "visible" };
}

const followLabels = ["Follow", "Follow back", "Takip et", "Geri takip et"];
const followingLabels = [
  "Unfollow",
  "Following",
  "Friends",
  "Takibi bırak",
  "Takip ediliyor",
  "Arkadaşlar",
];
const relationshipButton = (handle: string, action: string) =>
  profile(
    handle,
    `
  const container = title.closest('[data-e2e="user-profile-info"],header') || title.parentElement?.parentElement;
  const button = container && one(container, 'button[data-e2e="follow-button"],button[data-e2e="follow-icon"]');
  if (!button) return;
  const value = label(button);
  const state = ${json(followLabels)}.includes(value) ? false : ${json(followingLabels)}.includes(value) ? true : undefined;
  if (state === undefined) return;
  ${action}
`,
  );

export async function setTikTokFollowing(
  ctx: BrowserRecipeContext,
  recipientId: string,
  following: boolean,
  beforeSubmit: () => Promise<void>,
): Promise<{ platformId: string; url: string; following: boolean }> {
  const own = ownerHandle(ctx);
  const handle = TIKTOK_WEB_ID.exec(recipientId)?.[1];
  if (!handle || handle === own || typeof following !== "boolean") throw denied();
  await openTikTokCreatorPage(ctx, `/@${handle}`);
  const result = { platformId: recipientId, url: `${TIKTOK_ORIGIN}/@${handle}`, following };
  const state = await readTikTokCreatorPage<{ following: boolean }>(
    ctx,
    relationshipButton(handle, "return {following:state};"),
  );
  if (state.following === following) return result;
  if (!beforeSubmit) throw unsupported();
  return submitTikTokCreatorAction(
    ctx,
    relationshipButton(
      handle,
      `
    if (!enabled(button) || state === ${following}) return;
    return mark(button, 'follow-action');`,
    ),
    "follow-action",
    async () => {
      if (
        !(await readTikTokCreatorPage<boolean>(
          ctx,
          relationshipButton(handle, `return state === ${following};`),
        ))
      )
        throw unknown();
      return result;
    },
    beforeSubmit,
  );
}
