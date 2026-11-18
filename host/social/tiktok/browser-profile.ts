import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { denied, json, unknown, unsupported } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  assertNoTikTokChallenge,
  creatorExpression,
  markedTikTokCreatorControl,
  openTikTokCreatorPage,
  ownerHandle,
  readTikTokCreatorPage,
  submitTikTokCreatorAction,
  verifyTikTokCreatorPage,
} from "./browser-creator-page";

export type TikTokProfilePatch = {
  name?: string;
  username?: string;
  bio?: string;
  website?: string;
  avatarUploadId?: string;
};

export type TikTokProfileState = {
  name: string;
  username: string;
  bio: string;
  website?: string;
  avatarUrl?: string;
  platformId: string;
};

const USERNAME = /^[\w.]{2,24}$/;
const SAVE = ["Save", "Kaydet"];
const EDIT = ["Edit profile", "Profili düzenle"];

export function parseTikTokProfilePatch(raw: unknown): TikTokProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw denied();
  const patch: TikTokProfilePatch = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.includes("\0")) throw denied();
    if (key === "name" && value.trim() && [...value].length <= 30) patch.name = value.trim();
    else if (key === "username" && USERNAME.test(value) && !value.endsWith("."))
      patch.username = value.toLowerCase();
    else if (key === "bio" && [...value].length <= 80) patch.bio = value;
    else if (key === "website" && value.length <= 250 && (!value || allowedWebsite(value)))
      patch.website = value;
    else if (key === "avatarUploadId" && /^[a-f0-9-]{36}$/i.test(value)) patch.avatarUploadId = value;
    else throw denied();
  }
  if (!Object.keys(patch).length) throw denied();
  return patch;
}

function allowedWebsite(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function profileSnapshot(handle: string, avatarChangedFrom?: string) {
  return creatorExpression(`/@${handle}`, String.raw`
    const title = one(document, '[data-e2e="user-title"]');
    const name = one(document, '[data-e2e="user-subtitle"]');
    if (!title || !name || label(title).replace(/^@/, '').toLowerCase() !== ${json(handle)}) return;
    const bio = one(document, '[data-e2e="user-bio"]');
    const website = one(document, '[data-e2e="user-link"]');
    const avatar = one(document, '[data-e2e="user-avatar"] img,img[data-e2e="user-avatar"]');
    const avatarUrl = avatar?.getAttribute('src') || '';
    const previous = ${json(avatarChangedFrom ?? null)};
    if (previous !== null && (!avatarUrl || avatarUrl.split('?')[0] === previous.split('?')[0])) return;
    return {name:label(name),username:${json(handle)},bio:bio?.textContent?.trim() || '',website:website?.getAttribute('href'),
      avatarUrl,platformId:${json(`web:tiktok:${handle}`)}};
  `);
}

function publicProfile(snapshot: TikTokProfileState): TikTokProfileState {
  return {
    name: snapshot.name,
    username: snapshot.username,
    bio: snapshot.bio,
    platformId: snapshot.platformId,
    website: snapshot.website && allowedWebsite(snapshot.website) ? snapshot.website : undefined,
    avatarUrl: snapshot.avatarUrl && allowedWebsite(snapshot.avatarUrl) ? snapshot.avatarUrl : undefined,
  };
}

export async function readTikTokProfile(ctx: BrowserRecipeContext): Promise<TikTokProfileState> {
  const handle = ownerHandle(ctx);
  await openTikTokCreatorPage(ctx, `/@${handle}`);
  return publicProfile(await readTikTokCreatorPage(ctx, profileSnapshot(handle)));
}

const fieldSelectors = {
  name: 'input[name="nickname"],input[data-e2e="edit-profile-nickname"],input[aria-label="Name"]',
  username: 'input[name="username"],input[data-e2e="edit-profile-username"],input[aria-label="Username"]',
  bio: 'textarea[name="bio"],textarea[data-e2e="edit-profile-bio"],textarea[aria-label="Bio"]',
  website: 'input[name="website"],input[data-e2e="edit-profile-website"],input[aria-label="Website"]',
};

const profileDialog = (path: string, body: string) => creatorExpression(path, String.raw`
  const dialogs = all(document, '[role="dialog"],dialog[open]');
  const editor = dialogs.filter(el => one(el, ${json(fieldSelectors.username)}) && one(el, ${json(fieldSelectors.name)}));
  if (editor.length !== 1 || dialogs.length !== 1) return;
  const root = editor[0];
  const cooldown = all(root, '[role="alert"],[data-e2e="profile-edit-error"]').some(el =>
    /(?:\b(?:7|30)\s*days?\b|(?:7|30)\s*gün|too soon)/i.test(label(el)));
  ${body}
`);

const cooldownError = () =>
  new SocialPlatformError("rejected", undefined, { reasonCode: "TIKTOK_PROFILE_COOLDOWN" });

export async function updateTikTokProfile(ctx: BrowserRecipeContext, rawPatch: unknown) {
  const patch = parseTikTokProfilePatch(rawPatch);
  const hasAvatar = patch.avatarUploadId !== undefined;
  if (ctx.files.length !== Number(hasAvatar) || (hasAvatar && ctx.files[0]?.kind !== "image"))
    throw denied();
  const current = await readTikTokProfile(ctx);
  const path = `/@${current.username}`;
  const edit = creatorExpression(path, `
    const matches = all(document, 'main button,main [role="button"]').filter(el => enabled(el) && ${json(EDIT)}.includes(label(el)));
    if (matches.length !== 1) return;
    return mark(matches[0], 'edit-profile');`);
  await readTikTokCreatorPage<boolean>(ctx, edit);
  await ctx.page.click(markedTikTokCreatorControl("edit-profile"));

  const changed = (Object.keys(fieldSelectors) as (keyof typeof fieldSelectors)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );
  for (const key of changed) {
    const value = patch[key]!;
    const field = profileDialog(path, `
      const input = one(root, ${json(fieldSelectors[key])});
      if (!input || !enabled(input) || (input.maxLength > 0 && ${value.length} > input.maxLength)) {
        return cooldown ? 'cooldown' : 'missing';
      }
      return mark(input, 'profile-field') && 'ready';`);
    const state = await readTikTokCreatorPage<string>(ctx, field);
    if (state === "cooldown") throw cooldownError();
    if (state !== "ready") throw unsupported();
    await ctx.page.fill(markedTikTokCreatorControl("profile-field"), value);
  }
  if (!changed.length && !hasAvatar) return current;

  let uploadAttempted = false;
  try {
    if (hasAvatar) {
      await readTikTokCreatorPage<boolean>(ctx, profileDialog(path, String.raw`
        const inputs = root.querySelectorAll('input[type="file"]');
        if (inputs.length !== 1 || inputs[0].multiple || inputs[0].disabled ||
            !/(^|,)\s*image\//.test(inputs[0].accept)) return;
        return mark(inputs[0], 'profile-avatar');`));
      uploadAttempted = true;
      await ctx.page.setFiles(markedTikTokCreatorControl("profile-avatar"), [ctx.files[0].path]);
    }
    const save = profileDialog(path, `
      const buttons = all(root, 'button,[role="button"]').filter(el => enabled(el) && ${json(SAVE)}.includes(label(el)));
      if (cooldown || buttons.length !== 1) return;
      return mark(buttons[0], 'save-profile');`);
    if (await ctx.page.evaluate<boolean>(profileDialog(path, "return cooldown;"))) throw cooldownError();
    return await submitTikTokCreatorAction(ctx, save, "save-profile", async () => {
      const handle = patch.username ?? current.username;
      const expectedPath = `/@${handle}`;
      if (handle !== current.username) {
        // Require the authenticated navigation identity to change before returning a rebind candidate.
        const changedIdentity = creatorExpression(expectedPath, String.raw`
          const links = all(document, 'a[data-e2e="nav-profile"],[data-e2e="profile-icon"] a[href^="/@"]');
          const paths = new Set(links.map(el => new URL(el.getAttribute('href'),location.origin).pathname.replace(/\/$/, '').toLowerCase()));
          return paths.size === 1 && paths.has(${json(expectedPath)});`);
        if (!(await ctx.waitFor<boolean>(changedIdentity, 12_000))) throw unknown();
        await assertNoTikTokChallenge(ctx);
      } else {
        await verifyTikTokCreatorPage(ctx);
      }
      const proof = profileSnapshot(handle, hasAvatar ? (current.avatarUrl ?? "") : undefined);
      const saved = await ctx.waitFor<TikTokProfileState>(`(() => {
        const profile = ${proof};
        if (!profile || document.querySelector('[role="dialog"],dialog[open]')) return;
        return ${json(changed)}.every(key => (profile[key] ?? '') === ${json(patch)}[key]) ? profile : undefined;
      })()`, 12_000);
      if (!saved) throw unknown();
      await assertNoTikTokChallenge(ctx);
      return publicProfile(saved);
    });
  } catch (error) {
    if (uploadAttempted) throw unknown();
    throw error;
  }
}

const PRIVACY = "/setting";
const privacyFields = ["comments", "duet", "stitch"] as const;
const privacyValues = {
  everyone: ["Everyone", "Herkes"],
  followers: ["Followers", "Takipçiler"],
  friends: ["Friends", "Arkadaşlar"],
  nobody: ["No one", "Nobody", "Hiç kimse", "Only you", "Yalnızca sen"],
};
export type TikTokPrivacyState = {
  privateAccount?: boolean;
} & Partial<Record<(typeof privacyFields)[number], keyof typeof privacyValues>>;

export function parseTikTokPrivacyPatch(raw: unknown): TikTokPrivacyState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw denied();
  const patch: TikTokPrivacyState = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "privateAccount" && typeof value === "boolean") patch.privateAccount = value;
    else if (privacyFields.some((field) => field === key) && typeof value === "string" &&
      Object.hasOwn(privacyValues, value))
      patch[key as (typeof privacyFields)[number]] = value as keyof typeof privacyValues;
    else throw denied();
  }
  if (!Object.keys(patch).length) throw denied();
  return patch;
}

const privacyExpression = (body: string) => creatorExpression(PRIVACY, String.raw`
  const root = one(document, 'main,[role="main"]');
  if (!root) return;
  const privacyNames = ${json(privacyValues)};
  const privateSwitch = one(root, '[data-e2e="private-account"] [role="switch"], [data-e2e="private-account-switch"][role="switch"]');
  const scopes = ${json(privacyFields)};
  const field = key => one(root, '[data-e2e="privacy-' + key + '"][role="combobox"]');
  const choice = control => Object.keys(privacyNames).find(key => privacyNames[key].includes(
    control?.getAttribute('aria-valuetext') || control?.textContent?.trim()));
  const snapshot = () => {
    const result = {};
    const checked = privateSwitch?.getAttribute('aria-checked');
    if (checked === 'true' || checked === 'false') result.privateAccount = checked === 'true';
    for (const key of scopes) {
      const value = choice(field(key));
      if (value) result[key] = value;
    }
    return Object.keys(result).length ? result : undefined;
  };
  ${body}
`);

export async function readTikTokPrivacy(ctx: BrowserRecipeContext): Promise<TikTokPrivacyState> {
  await openTikTokCreatorPage(ctx, PRIVACY);
  return readTikTokCreatorPage(ctx, privacyExpression("return snapshot();"));
}

export async function updateTikTokPrivacy(ctx: BrowserRecipeContext, rawPatch: unknown) {
  const patch = parseTikTokPrivacyPatch(rawPatch);
  let current = await readTikTokPrivacy(ctx);
  const changes = (Object.keys(patch) as (keyof TikTokPrivacyState)[]).filter(key => patch[key] !== current[key]);
  if (changes.some(key => current[key] === undefined)) throw unsupported();
  let applied = false;
  try {
    for (const key of changes) {
      let expression = privacyExpression(`
        if (!privateSwitch || !enabled(privateSwitch)) return;
        return mark(privateSwitch, 'privacy-setting');`);
      if (key !== "privateAccount") {
        await readTikTokCreatorPage<boolean>(ctx, privacyExpression(`
          const control = field(${json(key)});
          if (!control || !enabled(control) || control.getAttribute('aria-expanded') === 'true') return;
          return mark(control, 'privacy-dropdown');`));
        await ctx.page.click(markedTikTokCreatorControl("privacy-dropdown"));
        expression = privacyExpression(`
          const control = field(${json(key)});
          const id = control?.getAttribute('aria-controls');
          const list = id && document.getElementById(id);
          if (!list || list.getAttribute('role') !== 'listbox' || !visible(list)) return;
          const options = all(list, '[role="option"]').filter(el => enabled(el) && ${json(privacyValues[patch[key]!])}.includes(label(el)));
          if (options.length !== 1) return;
          return mark(options[0], 'privacy-setting');`);
      }
      current = await submitTikTokCreatorAction(ctx, expression, "privacy-setting", () =>
        readTikTokCreatorPage<TikTokPrivacyState>(ctx, privacyExpression(`
          const state = snapshot();
          return state?.[${json(key)}] === ${json(patch[key])} ? state : undefined;`)));
      applied = true;
    }
  } catch (error) {
    if (applied) throw unknown();
    throw error;
  }
  return current;
}
