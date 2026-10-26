import type { BrowserPage } from "./social-browser";
import type { XProfilePatch, XProfileState } from "../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../src/integrations/social/adapter";

const fields = {
  name: "displayName",
  bio: "description",
  location: "location",
  website: "url",
} as const;
export function parseXProfilePatch(raw: unknown): XProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid profile update.");
  const input = raw as Record<string, unknown>,
    result: XProfilePatch = {};
  const limits = {
    name: 50,
    bio: 160,
    location: 30,
    website: 100,
    avatarUploadId: 36,
    bannerUploadId: 36,
  };
  for (const [key, value] of Object.entries(input)) {
    if (
      !Object.hasOwn(limits, key) ||
      typeof value !== "string" ||
      value.includes("\0") ||
      [...value].length > limits[key as keyof typeof limits]
    )
      throw new Error("Invalid profile field.");
    if (key === "name" && !value.trim()) throw new Error("Profile name is required.");
    if (key.endsWith("UploadId") && !/^[a-f0-9-]{36}$/i.test(value))
      throw new Error("Invalid image upload ID.");
    if (key === "website" && value) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Use a public HTTPS website URL.");
    }
    (result as Record<string, string>)[key] = value;
  }
  if (!Object.keys(result).length) throw new Error("Choose a profile field to update.");
  return result;
}
type Verify = () => Promise<void>;
type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;
async function markButton(page: BrowserPage, until: Until, labels: readonly string[]) {
  const marked = await until<boolean>(
    `(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(el => el.getClientRects().length && ${JSON.stringify(labels)}.includes(el.textContent.trim()));
    if (buttons.length !== 1) return false;
    document.querySelectorAll('[data-bycoda-profile-apply]').forEach(el => el.removeAttribute('data-bycoda-profile-apply'));
    buttons[0].setAttribute('data-bycoda-profile-apply', 'true'); return true;
  })()`,
    15000,
  );
  if (!marked) throw new SocialPlatformError("unsupported");
  await page.click('[data-bycoda-profile-apply="true"]');
}
export class XProfileActions {
  constructor(
    private page: BrowserPage,
    private verify: Verify,
    private until: Until,
  ) {}
  private async open() {
    await this.verify();
    await this.page.goto("https://x.com/settings/profile");
    const ready = await this.until<boolean>(
      `!!document.querySelector('input[name="displayName"]') && !!document.querySelector('[data-testid="Profile_Save_Button"]')`,
      20000,
    );
    if (!ready) throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  private async values(): Promise<XProfileState> {
    const value = await this.page.evaluate<XProfileState>(`(() => {
      const read = name => document.querySelector('[name="' + name + '"]')?.value;
      return { name: read('displayName'), bio: read('description'), location: read('location'), website: read('url') };
    })()`);
    parseXProfilePatch(value);
    return value;
  }
  async read() {
    await this.open();
    return this.values();
  }
  private async images(previous?: XProfileState, files?: { avatar?: string; banner?: string }) {
    await this.verify();
    const path = await this.page.evaluate<string>(
      `document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')`,
    );
    if (!/^\/[A-Za-z0-9_]{1,15}$/.test(path ?? "")) throw new SocialPlatformError("denied");
    await this.page.goto(`https://x.com${path}`);
    await this.verify();
    const result = await this.until<Pick<XProfileState, "avatarUrl" | "bannerUrl">>(
      `(() => {
      if (location.pathname.toLowerCase() !== ${JSON.stringify(path.toLowerCase())} || !document.querySelector('[data-testid="UserName"]')) return null;
      const avatarUrl = document.querySelector('a[href$="/photo"] img')?.getAttribute('src');
      const bannerUrl = document.querySelector('a[href$="/header_photo"] img')?.getAttribute('src');
      const valid = (value, kind) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/profile_' + kind + '/'); } catch { return false; } };
      if (${!!files?.avatar} && (!valid(avatarUrl, 'images') || avatarUrl === ${JSON.stringify(previous?.avatarUrl ?? "")})) return null;
      if (${!!files?.banner} && (!valid(bannerUrl, 'banners') || bannerUrl === ${JSON.stringify(previous?.bannerUrl ?? "")})) return null;
      return { avatarUrl, bannerUrl };
    })()`,
      20000,
    );
    if (!result) throw new SocialPlatformError("unknown");
    return result;
  }
  async update(patch: XProfilePatch, files: { avatar?: string; banner?: string }) {
    const before = files.avatar || files.banner ? await this.images() : undefined;
    await this.open();
    for (const [field, name] of Object.entries(fields)) {
      const value = patch[field as keyof typeof fields];
      if (value !== undefined) await this.page.fill(`[name="${name}"]`, value);
    }
    for (const kind of ["banner", "avatar"] as const)
      if (files[kind]) {
        // The two file inputs have the same test ID; bind only the explicitly named image slot.
        const bound = await this.page.evaluate<boolean>(`(() => {
        const labels = ${JSON.stringify(kind === "avatar" ? ["Add avatar photo", "Profil fotoğrafı ekle"] : ["Add banner photo", "Afiş fotoğrafı ekle", "Başlık fotoğrafı ekle"])};
        const buttons = [...document.querySelectorAll('button[aria-label]')].filter(el => el.getClientRects().length && labels.includes(el.getAttribute('aria-label')));
        if (buttons.length !== 1) return false;
        const inputs = buttons[0].parentElement?.querySelectorAll('input[type="file"]');
        if (inputs?.length !== 1) return false;
        const input = inputs[0];
        document.querySelectorAll('[data-bycoda-profile-image]').forEach(el => el.removeAttribute('data-bycoda-profile-image'));
        input.setAttribute('data-bycoda-profile-image', ${JSON.stringify(kind)}); return true;
      })()`);
        if (!bound) throw new SocialPlatformError("unsupported");
        await this.verify();
        await this.page.setFiles(`[data-bycoda-profile-image="${kind}"]`, [files[kind]!]);
        await this.verify();
        await markButton(this.page, this.until, ["Apply", "Uygula"]);
      }
    await this.verify();
    await this.page.click('[data-testid="Profile_Save_Button"]');
    const closed = await this.until<boolean>(
      `!document.querySelector('[data-testid="Profile_Save_Button"]')`,
      20000,
    );
    if (!closed) throw new SocialPlatformError("unknown");
    const images = before
      ? await this.images({ name: "", bio: "", location: "", website: "", ...before }, files)
      : {};
    // Reopen the form; optimistic values in the editor are not save evidence.
    await this.open();
    const saved = await this.values();
    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      if (patch[field] !== undefined && saved[field] !== patch[field])
        throw new SocialPlatformError("unknown");
    }
    await this.verify();
    return { ...saved, ...images };
  }
  async follow(handle: string) {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error("Enter an exact X username.");
    await this.verify();
    await this.page.goto(`https://x.com/${handle}`);
    const target = await this.until<{ id: string; following: boolean }>(
      `(() => {
      if (location.pathname.toLowerCase() !== ${JSON.stringify(`/${handle.toLowerCase()}`)}) return null;
      const root = document.querySelector('[data-testid="primaryColumn"]');
      const userName = root?.querySelector('[data-testid="UserName"]')?.textContent ?? '';
      if (!new RegExp(${JSON.stringify(`(?:^|[^A-Za-z0-9_])@${handle}(?![A-Za-z0-9_])`)}, 'i').test(userName)) return null;
      const controls = [...root.querySelectorAll('button[data-testid]')].filter(el => /^\\d+-(follow|unfollow)$/.test(el.dataset.testid) && el.getAttribute('aria-label')?.toLowerCase().endsWith(${JSON.stringify(`@${handle.toLowerCase()}`)}));
      if (controls.length !== 1) return null;
      const [id, state] = controls[0].dataset.testid.split('-'); return { id, following: state === 'unfollow' };
    })()`,
      20000,
    );
    if (!target || !/^\d{1,25}$/.test(target.id)) throw new SocialPlatformError("unsupported");
    if (target.following) return { handle, platformId: target.id, following: true, changed: false };
    await this.verify();
    await this.page.click(`[data-testid="${target.id}-follow"]`);
    const saved = await this.until<boolean>(
      `!!document.querySelector('[data-testid="${target.id}-unfollow"]')`,
      15000,
    );
    if (!saved) throw new SocialPlatformError("unknown");
    await this.verify();
    return { handle, platformId: target.id, following: true, changed: true };
  }
}
