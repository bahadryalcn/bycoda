import type { BrowserPage } from "./social-browser";
import type { XProfilePatch, XProfileState } from "../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../src/integrations/social/adapter";

type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;
const fields = { name: "#organization-name-field", bio: "#organization-tagline-field" } as const;
const logoInput = "#organization-logo-field";
const saveButton = "#org-page-edit-modal-banner__save-button";

/** Only fields observed on the organization admin Info editor are supported. */
export function parseLinkedInProfilePatch(raw: unknown): XProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid profile update.");
  const patch: XProfilePatch = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.includes("\0"))
      throw new Error("Invalid profile field.");
    if (key === "name" && value.trim() && [...value].length <= 100) patch.name = value;
    else if (key === "bio" && [...value].length <= 120) patch.bio = value;
    else if (key === "avatarUploadId" && /^[a-f0-9-]{36}$/i.test(value))
      patch.avatarUploadId = value;
    else throw new Error("Unsupported LinkedIn Page profile field.");
  }
  if (!Object.keys(patch).length) throw new Error("Choose a profile field to update.");
  return patch;
}

export class LinkedInProfileActions {
  private readonly company: string;
  constructor(
    private readonly page: BrowserPage,
    platformId: string,
    private readonly authorize: () => Promise<void>,
    private readonly until: Until,
  ) {
    const company = /^web:linkedin:company:([1-9]\d*)$/.exec(platformId)?.[1];
    if (!company) throw new SocialPlatformError("denied");
    this.company = company;
  }
  private expression(body: string) {
    return `(() => {
      if(location.origin!=='https://www.linkedin.com'||!new RegExp(${JSON.stringify(`^/company/${this.company}/admin/edit/?$`)}).test(location.pathname))return;
      const name=document.querySelector('#organization-name-field');
      const tagline=document.querySelector('#organization-tagline-field');
      const slug=document.querySelector('#organization-public-url-field');
      const logo=document.querySelector('#organization-logo-field');
      const save=document.querySelector('#org-page-edit-modal-banner__save-button');
      if(!name||!tagline||!slug||!logo||!name.getClientRects().length||!tagline.getClientRects().length||
        document.querySelectorAll('#organization-name-field').length!==1||document.querySelectorAll('#organization-logo-field').length!==1)return;
      ${body}
    })()`;
  }
  private async verify() {
    await this.authorize();
    if (!(await this.page.evaluate<boolean>(this.expression("return true;"))))
      throw new SocialPlatformError("denied");
  }
  private async open() {
    await this.authorize();
    await this.page.goto(
      `https://www.linkedin.com/company/${this.company}/admin/edit/?editPageActiveTab=info`,
    );
    if (!(await this.until<boolean>(this.expression("return true;"), 20_000)))
      throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  private async values(): Promise<XProfileState> {
    const value = await this.page.evaluate<XProfileState | undefined>(
      this.expression(`
      return {name:name.value,bio:tagline.value,location:'',website:''};`),
    );
    if (!value || typeof value.name !== "string" || typeof value.bio !== "string")
      throw new SocialPlatformError("unknown");
    return value;
  }
  private logoExpression() {
    return this.expression(`
      const container=logo.closest('.org-logo-input__container');
      const images=container?.querySelectorAll('img');
      if(images?.length!==1)return;
      try { const url=new URL(images[0].getAttribute('src'),location.origin);
        if(url.protocol!=='https:'||url.username||url.password||url.hostname!=='media.licdn.com'||!url.pathname.startsWith('/dms/image/')||!url.pathname.includes('/company-logo_'))return;
        return url.href;
      }catch{return;}`);
  }
  async read() {
    await this.open();
    return {
      ...(await this.values()),
      avatarUrl: await this.page.evaluate<string | undefined>(this.logoExpression()),
    };
  }
  async update(raw: XProfilePatch, files: { avatar?: string; banner?: string }) {
    const patch = parseLinkedInProfilePatch(raw);
    if (files.banner || !!patch.avatarUploadId !== !!files.avatar)
      throw new SocialPlatformError("rejected");
    await this.open();
    const before = files.avatar
      ? await this.page.evaluate<string | undefined>(this.logoExpression())
      : undefined;
    for (const [field, selector] of Object.entries(fields)) {
      const value = patch[field as keyof typeof fields];
      if (value !== undefined) {
        await this.verify();
        await this.page.fill(selector, value);
      }
    }
    if (files.avatar) {
      await this.verify();
      await this.page.setFiles(logoInput, [files.avatar]);
    }
    await this.verify();
    const ready = await this.until<boolean>(
      this.expression(
        "return !!save&&document.querySelectorAll('#org-page-edit-modal-banner__save-button').length===1&&!save.disabled&&save.getAttribute('aria-disabled')!=='true';",
      ),
      20_000,
    );
    if (!ready) throw new SocialPlatformError("unsupported");
    await this.verify();
    await this.page.click(saveButton);
    const saved = await this.until<boolean>(
      this.expression(`
      return !!save&&document.querySelectorAll('#org-page-edit-modal-banner__save-button').length===1&&save.disabled&&[...document.querySelectorAll('p')].some(el=>el.getClientRects().length&&['Değişiklikler kaydedildi.','Changes saved.','Changes saved'].includes(el.textContent.trim()));`),
      20_000,
    );
    if (!saved) throw new SocialPlatformError("unknown");
    await this.verify();
    await this.open();
    const value = await this.values();
    if (
      (patch.name !== undefined && value.name !== patch.name) ||
      (patch.bio !== undefined && value.bio !== patch.bio)
    )
      throw new SocialPlatformError("unknown");
    const avatarUrl = files.avatar
      ? await this.until<string>(this.logoExpression(), 20_000)
      : undefined;
    if (
      files.avatar &&
      (!avatarUrl || (before && new URL(avatarUrl).pathname === new URL(before).pathname))
    )
      throw new SocialPlatformError("unknown");
    await this.verify();
    return { ...value, ...(avatarUrl ? { avatarUrl } : {}) };
  }
}
