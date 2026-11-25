import type {
  InstagramFollowerSample,
  InstagramFollowChange,
  InstagramFollowResult,
} from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { numeric, readResponse, values } from "./social-browser-meta-shared";

const followerLimit = 50;

export function instagramHandle(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._]{1,30}$/.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..")
  )
    throw new SocialPlatformError("rejected");
  return value.toLowerCase();
}

export function parseInstagramFollowChange(input: Record<string, unknown>): InstagramFollowChange {
  const handle = instagramHandle(input.handle);
  if (input.follow === true && input.confirm === "FOLLOW_INSTAGRAM_ACCOUNT")
    return { handle, follow: true, confirm: input.confirm };
  if (input.follow === false && input.confirm === "UNFOLLOW_INSTAGRAM_ACCOUNT")
    return { handle, follow: false, confirm: input.confirm };
  throw new SocialPlatformError("rejected");
}

async function verifyInstagramPage(context: BrowserRecipeContext) {
  const challenge = await detectChallenge(context.page);
  if (challenge) throw needsHumanError(challenge);
  await context.verifyIdentity();
}

/** Opens a username and binds the displayed profile to its numeric account ID. */
export async function openInstagramRecipientProfile(
  context: BrowserRecipeContext,
  rawHandle: string,
): Promise<string> {
  const handle = instagramHandle(rawHandle);
  const url = `https://www.instagram.com/${handle}/`;
  const response = /\/api\/v1\/users\/web_profile_info\/(?:\?|$)/;
  const profileFrom = (raw: string) => {
    const value = values(raw, true)[0];
    const user = value.data?.user;
    const rawId = user?.id;
    const id = typeof rawId === "string" || Number.isSafeInteger(rawId) ? String(rawId) : "";
    if (typeof user?.username === "string" && user.username.toLowerCase() === handle && numeric(id))
      return id;
  };
  const checkedContext = { ...context, verifyIdentity: () => verifyInstagramPage(context) };
  const raw = await readResponse(checkedContext, url, response, (body) => {
    try {
      return !!profileFrom(body);
    } catch {
      return false;
    }
  });
  await verifyInstagramPage(context);
  const id = profileFrom(raw);
  const pathMatches = await context.page.evaluate<boolean>(`(() =>
    location.origin === "https://www.instagram.com" &&
    location.pathname.toLowerCase() === ${JSON.stringify(`/${handle}/`)}
  )()`);
  if (!pathMatches || !id || id === context.account.platformId)
    throw new SocialPlatformError("denied");
  return id;
}

/** Reads one visible follower page. No scroll, pagination, or collection side effects. */
export async function instagramFollowers(
  context: BrowserRecipeContext,
  handle: string,
): Promise<InstagramFollowerSample> {
  const username = instagramHandle(handle);
  const profilePath = `/${username}/`;
  const followersPath = `${profilePath}followers/`;
  await context.page.goto(`https://www.instagram.com${profilePath}`);
  await verifyInstagramPage(context);
  const ready = await context.waitFor<boolean>(
    `(() => {
    if (location.origin !== 'https://www.instagram.com' || location.pathname.toLowerCase() !== ${JSON.stringify(profilePath)}) return;
    const links = [...document.querySelectorAll('main header a[href]')].filter(el =>
      el.getClientRects().length && el.getAttribute('href')?.toLowerCase() === ${JSON.stringify(followersPath)});
    if (links.length !== 1) return;
    links[0].setAttribute('data-bycoda-instagram-followers','true');
    return true;
  })()`,
    15_000,
  );
  await verifyInstagramPage(context);
  if (!ready) throw new SocialPlatformError("unsupported");
  await context.page.click('[data-bycoda-instagram-followers="true"]');
  const followers = await context.waitFor<InstagramFollowerSample>(
    `(() => {
    if (location.origin !== 'https://www.instagram.com' ||
        !${JSON.stringify([profilePath, followersPath])}.includes(location.pathname.toLowerCase())) return;
    const visible = el => !!el.getClientRects().length;
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    if (dialogs.length !== 1) return;
    const title = [...dialogs[0].querySelectorAll('h1,h2,h3,[role="heading"]')].some(el =>
      visible(el) && ['Followers', 'Takipçiler'].includes(el.textContent.trim()));
    if (!title) return;
    const usernames = new Map();
    for (const link of dialogs[0].querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      const result = link.getAttribute('href')?.match(/^\\/([A-Za-z0-9_][A-Za-z0-9._]{0,29})\\/$/);
      if (!result || link.textContent.trim().toLowerCase() !== result[1].toLowerCase()) continue;
      usernames.set(result[1].toLowerCase(), { username: result[1] });
      if (usernames.size >= ${followerLimit}) break;
    }
    if (!usernames.size) {
      const empty = [...dialogs[0].querySelectorAll('p,[role="status"]')].some(el =>
        visible(el) && ['No followers yet', 'Henüz takipçi yok'].includes(el.textContent.trim()));
      if (!empty) return;
    }
    return { followers: [...usernames.values()], partial: true };
  })()`,
    15_000,
  );
  await verifyInstagramPage(context);
  if (!followers) throw new SocialPlatformError("unsupported");
  return followers;
}

export async function instagramFollow(
  context: BrowserRecipeContext,
  input: InstagramFollowChange,
  beforeSubmission: (recipientId: string, recordAttempt: boolean) => Promise<void>,
): Promise<InstagramFollowResult> {
  const handle = instagramHandle(input.handle);
  const profilePath = `/${handle}/`;
  const marker = '[data-bycoda-instagram-follow="true"]';
  const readIdentity = () => openInstagramRecipientProfile(context, handle);
  type State = "following" | "requested" | "available";
  const labels = {
    following: ["Following", "Takiptesin", "Takip ediliyor"],
    requested: ["Requested", "İstek gönderildi"],
    available: ["Follow", "Follow back", "Takip Et", "Takip et", "Takip Et (Sen de)"],
  };
  const state = (expected?: boolean) =>
    context.waitFor<State>(
      `(() => {
    if (location.origin !== 'https://www.instagram.com' ||
        location.pathname.toLowerCase() !== ${JSON.stringify(profilePath)}) return;
    const visible = el => !!el.getClientRects().length;
    if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) return;
    const headers = [...document.querySelectorAll('main header')].filter(visible);
    if (headers.length !== 1) return;
    const labels = ${JSON.stringify(labels)};
    const controls = [...headers[0].querySelectorAll('button,[role="button"]')].flatMap(el => {
      if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return [];
      const text = (el.getAttribute('aria-label') || el.textContent || '').trim();
      const state = Object.keys(labels).find(key => labels[key].includes(text));
      return state ? [{el, state}] : [];
    });
    if (controls.length !== 1) return;
    if (${JSON.stringify(expected ?? null)} !== null &&
        (controls[0].state !== 'available') !== ${JSON.stringify(expected ?? null)}) return;
    document.querySelectorAll('[data-bycoda-instagram-follow]').forEach(el => el.removeAttribute('data-bycoda-instagram-follow'));
    controls[0].el.setAttribute('data-bycoda-instagram-follow','true');
    return controls[0].state;
  })()`,
      15_000,
    );
  const result = (value: State, changed: boolean) => ({
    handle,
    following: value === "following",
    requested: value === "requested",
    changed,
  });
  const recipientId = await readIdentity();
  const previous = await state();
  await verifyInstagramPage(context);
  if (!previous) throw new SocialPlatformError("unsupported");
  if ((previous !== "available") === input.follow) return result(previous, false);
  if (!input.follow && previous !== "following") throw new SocialPlatformError("unsupported");
  await beforeSubmission(recipientId, true);
  await verifyInstagramPage(context);
  let submitted = false;
  try {
    if (!input.follow) {
      // Some layouts may toggle immediately. Treat the initial click as a
      // possible write before checking for the separate confirmation.
      submitted = true;
      await context.page.click(marker);
      const confirm = await context.waitFor<boolean>(
        `(() => {
        if (location.origin !== 'https://www.instagram.com' ||
            location.pathname.toLowerCase() !== ${JSON.stringify(profilePath)}) return;
        const visible = el => !!el.getClientRects().length;
        const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
        if (dialogs.length !== 1) return;
        const candidates = [...dialogs[0].querySelectorAll('button,[role="button"]')].filter(el =>
          visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
          ['Unfollow', 'Takibi bırak', 'Takipten çık'].includes(el.textContent.trim()));
        if (candidates.length !== 1) return;
        document.querySelectorAll('[data-bycoda-instagram-follow]').forEach(el => el.removeAttribute('data-bycoda-instagram-follow'));
        candidates[0].setAttribute('data-bycoda-instagram-follow','true'); return true;
      })()`,
        15_000,
      );
      await verifyInstagramPage(context);
      if (confirm) {
        await beforeSubmission(recipientId, false);
        await verifyInstagramPage(context);
        await context.page.click(marker);
      }
    } else {
      submitted = true;
      await context.page.click(marker);
    }
    const changed = await state(input.follow);
    if (!changed || (await readIdentity()) !== recipientId)
      throw new SocialPlatformError("unknown");
    const persisted = await state(input.follow);
    await verifyInstagramPage(context);
    if (!persisted) throw new SocialPlatformError("unknown");
    return result(persisted, true);
  } catch (error) {
    if (submitted) throw new SocialPlatformError("unknown");
    throw error;
  }
}
