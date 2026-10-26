import type { BrowserPage } from "./social-browser";
import type { XProfilePatch, XProfileState } from "../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../src/integrations/social/adapter";

type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;
const photoTitles = ["Change profile photo", "Profil fotoğrafını değiştir"];
const cancelLabels = ["Cancel", "İptal"];
const submitLabels = ["Submit", "Gönder"];

/** Only fields present in the desktop profile editor; links and names use other surfaces. */
export function parseInstagramProfilePatch(raw: unknown): XProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid profile update.");
  const patch: XProfilePatch = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.includes("\0"))
      throw new Error("Invalid profile field.");
    if (key === "bio" && [...value].length <= 150) patch.bio = value;
    else if (key === "avatarUploadId" && /^[a-f0-9-]{36}$/i.test(value))
      patch.avatarUploadId = value;
    else throw new Error("Unsupported Instagram profile field.");
  }
  if (!Object.keys(patch).length) throw new Error("Choose a profile field to update.");
  return patch;
}

export class InstagramProfileActions {
  constructor(
    private readonly page: BrowserPage,
    private readonly authorize: () => Promise<void>,
    private readonly identity: () => Promise<void>,
    private readonly until: Until,
  ) {}

  private expression(body: string) {
    return `(() => {
      if(location.origin!=='https://www.instagram.com'||location.pathname!=='/accounts/edit/')return;
      const visible=el=>!!el.getClientRects().length;
      const bios=[...document.querySelectorAll('textarea#pepBio')].filter(visible);
      if(bios.length!==1)return;
      const bio=bios[0], main=bio.closest('main,[role="main"]');
      if(!main)return;
      const photos=[...main.querySelectorAll('button[title]')].filter(el=>visible(el)&&${JSON.stringify(photoTitles)}.includes(el.getAttribute('title')));
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
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
    await this.page.goto("https://www.instagram.com/accounts/edit/");
    if (!(await this.until<boolean>(this.expression("return photos.length===1;"), 20_000)))
      throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  private photoExpression(beforePath?: string, expectedPath?: string) {
    return this.expression(`
      if(photos.length!==1)return;
      const images=photos[0].querySelectorAll('img');
      if(images.length!==1)return;
      try{
        const url=new URL(images[0].getAttribute('src'));
        if(url.protocol!=='https:'||url.username||url.password||!url.hostname.endsWith('.fbcdn.net')||!url.pathname.startsWith('/v/t51.2885-19/'))return;
        const previous=${JSON.stringify(beforePath ?? null)}, expected=${JSON.stringify(expectedPath ?? null)};
        if((previous!==null&&url.pathname===previous)||(expected!==null&&url.pathname!==expected))return;
        return url.href;
      }catch{return;}`);
  }
  private async values(): Promise<XProfileState> {
    const value = await this.page.evaluate<string | undefined>(
      this.expression("return bio.value;"),
    );
    if (typeof value !== "string") throw new SocialPlatformError("unknown");
    return {
      name: "",
      bio: value,
      location: "",
      website: "",
      avatarUrl: await this.page.evaluate<string | undefined>(this.photoExpression()),
    };
  }
  private async mark(labels: readonly string[], scope: "main" | "dialog") {
    const found = await this.until<boolean>(
      this.expression(`
      const roots=${scope === "main" ? "[main]" : "dialogs"};
      if(roots.length!==1)return;
      const matches=[...roots[0].querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&${JSON.stringify(labels)}.includes((el.getAttribute('aria-label')||el.textContent||'').trim()));
      if(matches.length!==1)return;
      document.querySelectorAll('[data-bycoda-ig-profile-action]').forEach(el=>el.removeAttribute('data-bycoda-ig-profile-action'));
      matches[0].setAttribute('data-bycoda-ig-profile-action','true');return true;`),
      15_000,
    );
    if (!found) throw new SocialPlatformError("unsupported");
    await this.verify();
    return '[data-bycoda-ig-profile-action="true"]';
  }
  /** Opening the chooser is read-only; synced photos cannot be limited to the reviewed account. */
  private async preparePhoto() {
    await this.verify();
    const ready = await this.page.evaluate<boolean>(
      this.expression(`
      if(photos.length!==1||dialogs.length)return;
      document.querySelectorAll('[data-bycoda-ig-profile-photo]').forEach(el=>el.removeAttribute('data-bycoda-ig-profile-photo'));
      photos[0].setAttribute('data-bycoda-ig-profile-photo','true');return true;`),
    );
    if (!ready) throw new SocialPlatformError("unsupported");
    await this.verify();
    await this.page.click('[data-bycoda-ig-profile-photo="true"]');
    const state = await this.until<"synced" | "ready">(
      this.expression(`
      if(dialogs.length!==1)return;
      const text=dialogs[0].textContent||'';
      if(['Synced profile photo','Manage sync settings','Senkronize profil fotoğrafı','Senkronizasyon ayarlarını yönet'].some(label=>text.includes(label)))return 'synced';
      const buttons=[...dialogs[0].querySelectorAll('button,[role="button"]')].filter(visible);
      const upload=buttons.filter(el=>['Upload Photo','Fotoğraf Yükle'].includes((el.textContent||'').trim()));
      const cancel=buttons.filter(el=>${JSON.stringify(cancelLabels)}.includes((el.textContent||'').trim()));
      const inputs=dialogs[0].querySelectorAll('input[type="file"]');
      if(upload.length!==1||cancel.length!==1||inputs.length!==1||inputs[0].multiple)return;
      const accept=inputs[0].accept.split(',').map(value=>value.trim());
      if(!accept.includes('image/jpeg')||!accept.includes('image/png'))return;
      return 'ready';`),
      15_000,
    );
    if (state !== "ready") throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  async read() {
    await this.open();
    return this.values();
  }
  async update(raw: XProfilePatch, files: { avatar?: string; banner?: string }) {
    const patch = parseInstagramProfilePatch(raw);
    if (files.banner || !!patch.avatarUploadId !== !!files.avatar)
      throw new SocialPlatformError("rejected");
    await this.open();
    let mutationAttempted = false;
    try {
      const before = await this.values();
      // Reject cross-account avatar propagation before changing even a separate text field.
      if (files.avatar) {
        await this.preparePhoto();
        await this.page.click(await this.mark(cancelLabels, "dialog"));
        if (!(await this.until<boolean>(this.expression("return dialogs.length===0;"), 15_000)))
          throw new SocialPlatformError("unsupported");
      }
      if (patch.bio !== undefined && patch.bio !== before.bio) {
        await this.verify();
        await this.page.fill("textarea#pepBio", patch.bio);
        const submit = await this.mark(submitLabels, "main");
        await this.verify();
        mutationAttempted = true;
        await this.page.click(submit);
        const saved = await this.until<boolean>(
          this.expression(`
        const matches=[...main.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&${JSON.stringify(submitLabels)}.includes((el.textContent||'').trim()));
        return matches.length===1&&(matches[0].disabled||matches[0].getAttribute('aria-disabled')==='true');`),
          20_000,
        );
        if (!saved) throw new SocialPlatformError("unknown");
        await this.verify();
        await this.open();
        if ((await this.values()).bio !== patch.bio) throw new SocialPlatformError("unknown");
      }
      let avatarUrl: string | undefined;
      if (files.avatar) {
        await this.preparePhoto();
        const bound = await this.page.evaluate<boolean>(
          this.expression(`
        if(dialogs.length!==1)return;
        const inputs=dialogs[0].querySelectorAll('input[type="file"]');
        if(inputs.length!==1)return;
        document.querySelectorAll('[data-bycoda-ig-profile-file]').forEach(el=>el.removeAttribute('data-bycoda-ig-profile-file'));
        inputs[0].setAttribute('data-bycoda-ig-profile-file','true');return true;`),
        );
        if (!bound) throw new SocialPlatformError("unsupported");
        await this.verify();
        const stillIndependent = await this.page.evaluate<boolean>(
          this.expression(`
        if(dialogs.length!==1)return;
        const text=dialogs[0].textContent||'';
        if(['Synced profile photo','Manage sync settings','Senkronize profil fotoğrafı','Senkronizasyon ayarlarını yönet'].some(label=>text.includes(label)))return;
        const inputs=dialogs[0].querySelectorAll('input[type="file"]');
        return inputs.length===1&&!inputs[0].multiple&&inputs[0].getAttribute('data-bycoda-ig-profile-file')==='true';`),
        );
        if (!stillIndependent) throw new SocialPlatformError("unsupported");
        // File selection itself may apply the photo; it is never retried automatically.
        mutationAttempted = true;
        await this.page.setFiles('[data-bycoda-ig-profile-file="true"]', [files.avatar]);
        const beforePath = before.avatarUrl ? new URL(before.avatarUrl).pathname : undefined;
        const changed = await this.until<string>(
          `(() => {const value=${this.photoExpression(beforePath)};return ![...document.querySelectorAll('[role="dialog"]')].some(el=>el.getClientRects().length)&&value;})()`,
          20_000,
        );
        if (!changed) throw new SocialPlatformError("unknown");
        await this.verify();
        await this.open();
        avatarUrl = await this.until<string>(
          this.photoExpression(beforePath, new URL(changed).pathname),
          20_000,
        );
        if (!avatarUrl) throw new SocialPlatformError("unknown");
      }
      await this.verify();
      const saved = await this.values();
      if (patch.bio !== undefined && saved.bio !== patch.bio)
        throw new SocialPlatformError("unknown");
      return { ...saved, ...(avatarUrl ? { avatarUrl } : {}) };
    } catch (error) {
      // Independent provider writes cannot be rolled back as one transaction. Once
      // either write was attempted, later refusal must not imply nothing changed.
      if (mutationAttempted) throw new SocialPlatformError("unknown");
      throw error;
    }
  }
}
