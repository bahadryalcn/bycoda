import type { BrowserPage } from "./social-browser";
import type { XProfilePatch, XProfileState } from "../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../src/integrations/social/adapter";

type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;
const avatarLabels = ["Profil resmi işlemleri", "Profile picture actions"];
const dialogLabels = ["Profil resmi seç", "Select profile picture"];

/** Page branding currently supports only the live-observed logo editor. */
export function parseFacebookProfilePatch(raw: unknown): XProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid profile update.");
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.avatarUploadId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.avatarUploadId)
  )
    throw new Error("Choose one uploaded Facebook Page logo.");
  return { avatarUploadId: input.avatarUploadId };
}

export class FacebookProfileActions {
  constructor(
    private readonly page: BrowserPage,
    private readonly actor: string,
    private readonly authorize: () => Promise<void>,
    private readonly identity: () => Promise<void>,
    private readonly until: Until,
  ) {
    if (!/^[1-9]\d{0,24}$/.test(actor)) throw new SocialPlatformError("denied");
  }
  private expression(body: string) {
    return `(() => {
      if(location.origin!=='https://www.facebook.com'||location.pathname!=='/profile.php'||new URLSearchParams(location.search).get('id')!==${JSON.stringify(this.actor)})return;
      const visible=el=>!!el.getClientRects().length;
      const avatar=[...document.querySelectorAll('[role="button"][aria-label]')].filter(el=>visible(el)&&${JSON.stringify(avatarLabels)}.includes(el.getAttribute('aria-label')));
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>visible(el)&&${JSON.stringify(dialogLabels)}.includes(el.getAttribute('aria-label')));
      ${body}
    })()`;
  }
  private async verify() {
    await this.authorize();
    await this.identity();
    if (!(await this.page.evaluate<boolean>(this.expression("return true;"))))
      throw new SocialPlatformError("denied");
  }
  private async open() {
    await this.authorize();
    await this.page.goto(`https://www.facebook.com/profile.php?id=${this.actor}`);
    if (!(await this.until<boolean>(this.expression("return avatar.length===1;"), 20_000)))
      throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  private logoExpression(expectedAsset?: string, beforePath?: string) {
    return this.expression(`
      if(avatar.length!==1)return;
      const images=avatar[0].querySelectorAll('svg image');
      if(images.length!==1)return;
      const raw=images[0].getAttribute('href')||images[0].getAttributeNS('http://www.w3.org/1999/xlink','href');
      try{
        const url=new URL(raw);
        if(url.protocol!=='https:'||url.username||url.password||!url.hostname.endsWith('.fbcdn.net')||!url.pathname.startsWith('/v/'))return;
        const expected=${JSON.stringify(expectedAsset ?? null)}, previous=${JSON.stringify(beforePath ?? null)};
        const stem=url.pathname.split('/').at(-1)?.replace(/\\.[a-z0-9]+$/i,'');
        if((expected!==null&&stem!==expected)||(previous!==null&&url.pathname===previous))return;
        return url.href;
      }catch{return;}`);
  }
  private async mark(
    selector: string,
    labels: readonly string[],
    scope: "page" | "menu" | "dialog",
  ) {
    const found = await this.until<boolean>(
      this.expression(`
      const roots=${scope === "dialog" ? "dialogs" : scope === "menu" ? "[...document.querySelectorAll('[role=\"menu\"]')].filter(visible)" : "[document]"};
      if(roots.length!==1)return;
      const matches=[...roots[0].querySelectorAll(${JSON.stringify(selector)})].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&${JSON.stringify(labels)}.includes((el.getAttribute('aria-label')||el.textContent||'').trim()));
      if(matches.length!==1)return;
      document.querySelectorAll('[data-bycoda-fb-profile-action]').forEach(el=>el.removeAttribute('data-bycoda-fb-profile-action'));
      matches[0].setAttribute('data-bycoda-fb-profile-action','true');return true;`),
      15_000,
    );
    if (!found) throw new SocialPlatformError("unsupported");
    await this.verify();
    return '[data-bycoda-fb-profile-action="true"]';
  }
  async read(): Promise<XProfileState> {
    await this.open();
    return {
      name: "",
      bio: "",
      location: "",
      website: "",
      avatarUrl: await this.page.evaluate<string | undefined>(this.logoExpression()),
    };
  }
  async update(
    raw: XProfilePatch,
    files: { avatar?: string; banner?: string },
  ): Promise<XProfileState> {
    parseFacebookProfilePatch(raw);
    if (!files.avatar || files.banner) throw new SocialPlatformError("rejected");
    await this.open();
    const before = await this.page.evaluate<string | undefined>(this.logoExpression());
    await this.page.click(await this.mark('[role="button"][aria-label]', avatarLabels, "page"));
    await this.page.click(
      await this.mark('[role="menuitem"],[role="button"]', dialogLabels, "menu"),
    );
    const file = await this.until<boolean>(
      this.expression(`
      if(dialogs.length!==1)return;
      const inputs=dialogs[0].querySelectorAll('input[type="file"]');
      if(inputs.length!==1||!inputs[0].accept.includes('image/')||inputs[0].multiple)return;
      document.querySelectorAll('[data-bycoda-fb-profile-file]').forEach(el=>el.removeAttribute('data-bycoda-fb-profile-file'));
      inputs[0].setAttribute('data-bycoda-fb-profile-file','true');return true;`),
      15_000,
    );
    if (!file) throw new SocialPlatformError("unsupported");
    await this.verify();
    await this.page.setFiles('[data-bycoda-fb-profile-file="true"]', [files.avatar]);
    const preview = await this.until<string>(
      this.expression(`
      if(dialogs.length!==1)return;
      const images=[...dialogs[0].querySelectorAll('img')];
      if(images.length!==2)return;
      const paths=images.map(img=>{try{const u=new URL(img.getAttribute('src'));return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.fbcdn.net')&&u.pathname.startsWith('/v/')?u.pathname:undefined;}catch{return;}});
      if(!paths[0]||paths[0]!==paths[1])return;return paths[0];`),
      20_000,
    );
    if (!preview) throw new SocialPlatformError("unsupported");
    const save = await this.mark('[role="button"],button', ["Kaydet", "Save"], "dialog");
    await this.verify();
    await this.page.click(save);
    if (!(await this.until<boolean>(this.expression("return dialogs.length===0;"), 20_000)))
      throw new SocialPlatformError("unknown");
    await this.verify();
    await this.open();
    const asset = (path: string) =>
      path
        .split("/")
        .at(-1)
        ?.replace(/\.[a-z0-9]+$/i, "");
    const expectedAsset = asset(preview);
    if (!expectedAsset) throw new SocialPlatformError("unknown");
    const avatarUrl = await this.until<string>(
      this.logoExpression(expectedAsset, before ? new URL(before).pathname : undefined),
      20_000,
    );
    if (
      !avatarUrl ||
      !asset(preview) ||
      asset(new URL(avatarUrl).pathname) !== asset(preview) ||
      (before && new URL(avatarUrl).pathname === new URL(before).pathname)
    )
      throw new SocialPlatformError("unknown");
    await this.verify();
    return { name: "", bio: "", location: "", website: "", avatarUrl };
  }
}
