import type { BrowserPage } from "./social-browser";
import type {
  FacebookBrowserProfilePatch as FacebookProfilePatch,
  FacebookPersonalName as PersonalName,
  FacebookProfileDetail,
  XProfileState,
} from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { createHash } from "node:crypto";
import { hash } from "./core/social-helpers";
import type { SocialService } from "./social";

type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;
const avatarLabels = [
  "Profil resmi işlemleri",
  "Profile picture actions",
  "Change profile picture",
  "Profil resmini değiştir",
];
const dialogLabels = [
  "Profil resmi seç",
  "Select profile picture",
  "Update profile picture",
  "Profil resmini güncelle",
];
const coverLabels = [
  "Edit cover photo",
  "Add cover photo",
  "Kapak fotoğrafını düzenle",
  "Kapak fotoğrafı ekle",
];
const uploadLabels = ["Upload photo", "Upload Photo", "Fotoğraf yükle"];
const saveLabels = ["Save", "Save changes", "Save Changes", "Kaydet", "Değişiklikleri kaydet"];
const buttons = 'button,[role="button"],a';

type FacebookProfileState = XProfileState & { username?: string };
type FacebookDetail = NonNullable<FacebookProfilePatch["detail"]>;
type ActorType = "page" | "member";

/** Called inside the account's exclusive browser session. */
export async function writeFacebookBrowserProfile(
  service: Pick<SocialService, "setting" | "setSetting">,
  accountId: string,
  actor: string,
  patch: FacebookProfilePatch,
  submit: () => Promise<FacebookProfileState>,
  photoDigest?: string,
) {
  const key = `facebook.browser.profile.unconfirmed:${accountId}`;
  const fingerprint = hash(
    JSON.stringify([actor, photoDigest ? [Object.keys(patch)[0], photoDigest] : patch]),
  );
  const pending = new Set<string>(JSON.parse((await service.setting(key)) ?? "[]"));
  if (pending.has(fingerprint)) throw new SocialPlatformError("unknown");
  pending.add(fingerprint);
  await service.setSetting(key, JSON.stringify([...pending]));
  const clear = async () => {
    pending.delete(fingerprint);
    await service.setSetting(key, JSON.stringify([...pending]));
  };
  try {
    const result = await submit();
    await clear();
    return result;
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code !== "unknown") await clear();
    throw error;
  }
}

export function facebookProfilePhotoDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
type SettingsField = "name" | "username";
const settingsLabels = {
  name: ["Name", "Page name", "New Page name", "Ad", "Sayfa adı", "Yeni Sayfa adı"],
  username: ["Username", "Kullanıcı adı"],
};

function profileWebsite(input: unknown) {
  if (typeof input !== "string" || input.length > 2048) return;
  const url = URL.parse(input.trim());
  if (url?.protocol === "https:" && !url.username && !url.password) return url.href;
}

function profileDetail(input: unknown) {
  if (
    typeof input === "string" &&
    input.trim() &&
    [...input.trim()].length <= 100 &&
    !/[\p{Cc}\p{Cf}]/u.test(input)
  )
    return input.trim();
}

/** One field per confirmed browser action. */
export function parseFacebookProfilePatch(
  raw: unknown,
  actorType: ActorType = "page",
): FacebookProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid profile update.");
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).length !== 1) throw new Error("Choose one Facebook profile field.");
  if (actorType === "page" && typeof input.name === "string") {
    const name = input.name.trim();
    if (name && [...name].length <= 75 && !/[\p{Cc}\p{Cf}]/u.test(name)) return { name };
  }
  if (
    actorType === "page" &&
    typeof input.username === "string" &&
    /^[A-Za-z0-9.]{5,50}$/.test(input.username)
  )
    return { username: input.username };
  for (const field of ["avatarUploadId", "bannerUploadId"] as const) {
    const value = input[field];
    if (typeof value === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value))
      return { [field]: value };
  }
  if (actorType === "member") {
    const name = input.personalName as Partial<PersonalName> | undefined;
    if (
      name &&
      Object.keys(name).length === 3 &&
      typeof name.first === "string" &&
      typeof name.middle === "string" &&
      typeof name.last === "string" &&
      name.first.trim() &&
      name.last.trim() &&
      [name.first, name.middle, name.last].every(
        (value) => [...value.trim()].length <= 75 && !/[\p{Cc}\p{Cf}]/u.test(value),
      )
    )
      return {
        personalName: {
          first: name.first.trim(),
          middle: name.middle.trim(),
          last: name.last.trim(),
        },
      };
    if (
      typeof input.bio === "string" &&
      [...input.bio.trim()].length <= 101 &&
      !/[\p{Cc}\p{Cf}]/u.test(input.bio)
    )
      return { bio: input.bio.trim() };
    const website = profileWebsite(input.website);
    if (website) return { website };
    const websiteUpdate = input.websiteUpdate as
      | Partial<NonNullable<FacebookProfilePatch["websiteUpdate"]>>
      | undefined;
    if (websiteUpdate && Object.keys(websiteUpdate).length === 2) {
      const current = profileWebsite(websiteUpdate.current);
      const value = profileWebsite(websiteUpdate.value);
      if (current && value && current !== value) return { websiteUpdate: { current, value } };
    }
    const detail = input.detail as Partial<FacebookDetail> | undefined;
    if (
      detail?.field &&
      Object.hasOwn(detailLabels, detail.field) &&
      Object.keys(detail).every((key) => ["field", "value", "current"].includes(key))
    ) {
      const value = profileDetail(detail.value);
      const current = profileDetail(detail.current);
      if (value && (detail.current === undefined || (current && current !== value)))
        return { detail: { field: detail.field, value, ...(current ? { current } : {}) } };
    }
  }
  throw new Error("Choose a supported Facebook profile field and valid value.");
}

const detailLabels: Record<
  FacebookProfileDetail,
  { add: string[]; input: string[]; section: string }
> = {
  work: {
    add: ["Add a workplace", "İş yeri ekle"],
    input: ["Company", "Şirket"],
    section: "about_work_and_education",
  },
  school: {
    add: ["Add a high school", "Lise ekle"],
    input: ["School", "Okul"],
    section: "about_work_and_education",
  },
  college: {
    add: ["Add a college", "Üniversite ekle"],
    input: ["School", "Okul", "College", "Üniversite"],
    section: "about_work_and_education",
  },
  currentCity: {
    add: ["Add current city", "Yaşadığın şehri ekle"],
    input: ["Current city", "Yaşadığın şehir"],
    section: "about_places",
  },
  hometown: {
    add: ["Add hometown", "Memleket ekle"],
    input: ["Hometown", "Memleket"],
    section: "about_places",
  },
};

export class FacebookProfileActions {
  constructor(
    private readonly page: BrowserPage,
    private readonly actor: string,
    private readonly authorize: () => Promise<void>,
    private readonly identity: () => Promise<void>,
    private readonly until: Until,
    private readonly actorType: ActorType = "page",
  ) {
    if (!/^[1-9]\d{0,24}$/.test(actor)) throw new SocialPlatformError("denied");
  }
  private expression(body: string, section?: string) {
    return `(() => {
      const query=new URLSearchParams(location.search);
      if(location.origin!=='https://www.facebook.com'||location.pathname!=='/profile.php'||query.get('id')!==${JSON.stringify(this.actor)}||
        (query.get('sk')||null)!==${JSON.stringify(section ?? null)})return;
      const visible=el=>!!el.getClientRects().length;
      const avatar=[...document.querySelectorAll('[role="button"][aria-label]')].filter(el=>visible(el)&&${JSON.stringify(avatarLabels)}.includes(el.getAttribute('aria-label')));
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>visible(el)&&${JSON.stringify(dialogLabels)}.includes(el.getAttribute('aria-label')));
      const label=el=>(el.getAttribute('aria-label')||el.textContent||'').trim();
      const enabled=el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true';
      const mark=(elements,key)=>{
        document.querySelectorAll('['+key+']').forEach(el=>el.removeAttribute(key));
        if(elements.length!==1)return false;
        elements[0].setAttribute(key,'true');return true;
      };
      ${body}
    })()`;
  }
  private async noChallenge() {
    const hit = await detectChallenge(this.page);
    if (hit?.kind === "login") throw new SocialPlatformError("expired");
    if (hit) throw needsHumanError(hit);
    const passwordRequired = await this.page.evaluate<boolean>(
      `[...document.querySelectorAll('input[type="password"]')].some(el=>!el.hidden&&!!el.getClientRects().length)`,
    );
    if (passwordRequired) throw new SocialPlatformError("needs_human");
  }
  private async control(expression: string, attribute: string, scope?: string) {
    if (!(await this.until<boolean>(expression, 15_000))) {
      await this.noChallenge();
      throw new SocialPlatformError("unsupported");
    }
    await this.verify(scope);
    if (!(await this.page.evaluate<boolean>(expression)))
      throw new SocialPlatformError("unsupported");
    return `[${attribute}="true"]`;
  }
  private async verify(expression = this.expression("return true;")) {
    await this.authorize();
    await this.noChallenge();
    await this.identity();
    if (!(await this.page.evaluate<boolean>(expression))) throw new SocialPlatformError("denied");
  }
  private async open() {
    await this.authorize();
    await this.page.goto(`https://www.facebook.com/profile.php?id=${this.actor}`);
    await this.noChallenge();
    if (!(await this.until<boolean>(this.expression("return avatar.length===1;"), 20_000)))
      throw new SocialPlatformError("unsupported");
    await this.verify();
  }
  private coverAsset(expected?: string, previous?: string) {
    return this.expression(`
      const covers=[...document.querySelectorAll('img[alt],img[aria-label]')].filter(el=>
        visible(el)&&['Cover photo','Kapak fotoğrafı'].includes(el.getAttribute('aria-label')||el.alt));
      if(covers.length!==1)return;
      try {
        const url=new URL(covers[0].src);
        if(url.protocol!=='https:'||url.username||url.password||!url.hostname.endsWith('.fbcdn.net'))return;
        const file=url.pathname.split('/').at(-1);
        if(file===${JSON.stringify(previous ?? null)}||(${JSON.stringify(expected ?? null)}!==null&&file!==${JSON.stringify(expected ?? null)}))return;
        return url.href;
      } catch {return;}`);
  }
  private async updateCover(file: string): Promise<FacebookProfileState> {
    await this.open();
    const before = await this.page.evaluate<string | undefined>(this.coverAsset());
    const attribute = "data-bycoda-fb-cover";
    const mark = (body: string) => this.control(this.expression(body), attribute);
    await this.page.click(
      await mark(`return mark([...document.querySelectorAll(${JSON.stringify(buttons)})]
      .filter(el=>enabled(el)&&${JSON.stringify(coverLabels)}.includes(label(el))),${JSON.stringify(attribute)});`),
    );
    const upload = await mark(`
      const menus=[...document.querySelectorAll('[role="menu"]')].filter(visible);
      if(menus.length!==1)return;
      const owners=[...menus[0].querySelectorAll('[role="menuitem"],label')].filter(el=>enabled(el)&&${JSON.stringify(uploadLabels)}.includes(label(el)));
      if(owners.length!==1)return;
      const field=owners[0].control||owners[0].querySelector('input[type="file"]');
      return mark(field?.type==='file'&&field.accept.includes('image/')&&!field.multiple?[field]:[],${JSON.stringify(attribute)});`);
    await this.page.setFiles(upload, [file]);
    const filename = (url: string) => new URL(url).pathname.split("/").at(-1);
    const preview = await this.until<string>(
      this.coverAsset(undefined, before ? filename(before) : undefined),
      20_000,
    );
    if (!preview) {
      await this.noChallenge();
      throw new SocialPlatformError("unsupported");
    }
    const save = await mark(`return mark([...document.querySelectorAll(${JSON.stringify(buttons)})]
      .filter(el=>enabled(el)&&${JSON.stringify(saveLabels)}.includes(label(el))),${JSON.stringify(attribute)});`);
    try {
      await this.page.click(save);
      await this.open();
      const bannerUrl = await this.until<string>(this.coverAsset(filename(preview)), 20_000);
      if (!bannerUrl) throw new SocialPlatformError("unknown");
      await this.verify();
      return { name: "", bio: "", location: "", website: "", bannerUrl };
    } catch (error) {
      await this.noChallenge();
      if (error instanceof SocialPlatformError && error.code === "needs_human") throw error;
      throw new SocialPlatformError("unknown");
    }
  }

  private async updatePersonalName(name: PersonalName): Promise<FacebookProfileState> {
    await this.open();
    const origin = "https://accountscenter.facebook.com";
    const path = `/profiles/${this.actor}/name`;
    await this.page.goto(`${origin}${path}/`);
    const verify = async () => {
      await this.authorize();
      await this.noChallenge();
      const cookies = await this.page.cookies([`${origin}/`, "https://www.facebook.com/"]);
      const values = (key: string) =>
        new Set(cookies.filter(({ name }) => name === key).map(({ value }) => value));
      const users = values("c_user"),
        selected = values("i_user");
      if (
        users.size !== 1 ||
        !users.has(this.actor) ||
        values("xs").size !== 1 ||
        (selected.size && (selected.size !== 1 || !selected.has(this.actor)))
      )
        throw new SocialPlatformError("denied");
      if (!(await this.page.evaluate<boolean>(expression("return true;"))))
        throw new SocialPlatformError("denied");
    };
    const fields = {
      first: ["First name", "Ad"],
      middle: ["Middle name", "İkinci ad"],
      last: ["Last name", "Soyadı", "Soyad"],
    };
    const attr = "data-bycoda-fb-personal-name";
    const expression = (script: string) => `(() => {
      if(location.origin!==${JSON.stringify(origin)}||location.pathname.replace(/\\/$/,'')!==${JSON.stringify(path)})return;
      const visible=el=>!!el.getClientRects().length&&!el.disabled&&el.getAttribute('aria-disabled')!=='true';
      const label=el=>(el.getAttribute('aria-label')||el.textContent||'').trim();
      const inputs=[...document.querySelectorAll('input[type="text"],input:not([type])')].filter(el=>visible(el)&&!el.readOnly);
      const fields=${JSON.stringify(fields)};
      const field=key=>inputs.filter(el=>fields[key].includes(el.getAttribute('aria-label'))||[...el.labels||[]].some(el=>fields[key].includes(label(el))));
      const mark=els=>{
        document.querySelectorAll('[${attr}]').forEach(el=>el.removeAttribute('${attr}'));
        if(els.length!==1)return false;
        els[0].setAttribute('${attr}','true');return true;
      };
      ${script}
    })()`;
    const control = async (script: string) => {
      const target = expression(script);
      if (await this.until<boolean>(target, 15_000)) {
        await verify();
        if (await this.page.evaluate<boolean>(target)) return `[${attr}="true"]`;
      }
      await this.noChallenge();
      throw new SocialPlatformError("unsupported");
    };
    for (const field of Object.keys(fields) as (keyof PersonalName)[])
      await this.page.fill(
        await control(`return mark(field(${JSON.stringify(field)}));`),
        name[field],
      );
    const formMatches = `Object.keys(fields).every(key=>field(key).length===1&&field(key)[0].value===${JSON.stringify(name)}[key])`;
    const review = [
      "Review change",
      "Review Change",
      "Değişikliği gözden geçir",
      "Değişikliği Gözden Geçir",
    ];
    await this.page.click(
      await control(
        `return ${formMatches}&&mark([...document.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&${JSON.stringify(review)}.includes(label(el))));`,
      ),
    );
    const fullName = [name.first, name.middle, name.last].filter(Boolean).join(" ");
    const submit = await control(`
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
      if(dialogs.length!==1)return;
      const root=dialogs[0];
      const options=[...root.querySelectorAll('label,[role="radio"],p,span')].filter(el=>visible(el)&&label(el)===${JSON.stringify(fullName)});
      if(!options.length)return;
      const selected=root.querySelector('input[type="radio"]:checked,[role="radio"][aria-checked="true"]');
      if(selected&&!options.some(el=>el.contains(selected)||selected.contains(el)||el.control===selected))return;
      return mark([...root.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&${JSON.stringify([...saveLabels, "Request change", "Değişiklik iste"]).replaceAll("<", "\\u003c")}.includes(label(el))));`);
    try {
      await this.page.click(submit);
      await this.noChallenge();
      await this.page.goto(`${origin}${path}/`);
      if (!(await this.until<boolean>(expression(`return ${formMatches};`), 15_000)))
        throw new SocialPlatformError("unknown");
      await verify();
    } catch (error) {
      await this.noChallenge();
      if (error instanceof SocialPlatformError && error.code === "needs_human") throw error;
      throw new SocialPlatformError("unknown");
    }
    return { name: fullName, bio: "", location: "", website: "" };
  }

  private async updateIntro(
    field: "bio" | "website" | FacebookProfileDetail,
    value: string,
    current?: string,
  ): Promise<FacebookProfileState> {
    const spec =
      field === "bio"
        ? {
            section: undefined,
            add: ["Add bio", "Edit bio", "Biyografi ekle", "Biyografiyi düzenle"],
            input: ["Bio", "Biyografi"],
          }
        : field === "website"
          ? {
              section: "about_contact_and_basic_info",
              add: ["Add a website", "Add website", "İnternet sitesi ekle"],
              input: ["Website", "Website address", "İnternet sitesi"],
            }
          : detailLabels[field];
    const url = `https://www.facebook.com/profile.php?id=${this.actor}${spec.section ? `&sk=${spec.section}` : ""}`;
    await this.authorize();
    await this.page.goto(url);
    const attr = "data-bycoda-fb-intro";
    const scope = this.expression("return true;", spec.section);
    const control = (body: string) =>
      this.control(this.expression(body, spec.section), attr, scope);
    const button = (labels: string[], selector = buttons) =>
      `[...root.querySelectorAll(${JSON.stringify(selector)})].filter(el=>enabled(el)&&${JSON.stringify(labels)}.includes(label(el)))`;
    const matches = `
      const matches=(root,value)=>[...root.querySelectorAll(${JSON.stringify(field === "website" ? "a[href]" : "span,p,a")})].filter(el=>{
        if(!visible(el))return false;
        if(${field !== "website"})return el.textContent.trim()===value;
        const url=new URL(el.href);
        if(url.origin==='https://l.facebook.com'&&url.pathname==='/l.php') {
          try{return new URL(url.searchParams.get('u')).href===value;}catch{return false;}
        }
        return url.href===value;
      });`;
    await this.page.click(
      await control(
        current
          ? `${matches}
        const main=document.querySelector('[role="main"],main');
        if(!main||matches(main,${JSON.stringify(value)}).length)return;
        const rows=new Set(matches(main,${JSON.stringify(current)}).map(el=>el.closest('[role="listitem"],li,[role="group"]')).filter(Boolean));
        if(rows.size!==1)return;
        const [root]=rows;
        return mark(${button(["Edit", "Düzenle", ...(field === "website" ? ["Edit website", "İnternet sitesini düzenle"] : [])])},${JSON.stringify(attr)});`
          : `const root=document;
           return mark(${button(spec.add)},${JSON.stringify(attr)});`,
      ),
    );
    const editor = `
      const editors=[...document.querySelectorAll('textarea,input:not([type]),input[type="text"],input[type="url"]')].filter(el=>
        enabled(el)&&!el.readOnly&&(${JSON.stringify(spec.input)}.includes(el.getAttribute('aria-label'))||${JSON.stringify(spec.input)}.includes(el.placeholder)||
        [...el.labels||[]].some(el=>${JSON.stringify(spec.input)}.includes(label(el)))));
      if(editors.length!==1)return;
      const editor=editors[0];`;
    const input = await control(`${editor}
      if(${JSON.stringify(current ?? null)}!==null){
        let existing=editor.value.trim();
        if(${field === "website"}){try{existing=new URL(existing).href;}catch{return;}}
        if(existing!==${JSON.stringify(current ?? null)})return;
      }
      return mark(editors,${JSON.stringify(attr)});`);
    await this.page.fill(input, value);
    if (field !== "bio" && field !== "website") {
      const result = await control(`${editor}
        const list=document.getElementById(editor.getAttribute('aria-controls'));
        if(!list||list.getAttribute('role')!=='listbox')return;
        const matches=[...list.querySelectorAll('[role="option"]')].filter(el=>enabled(el)&&label(el)===${JSON.stringify(value)});
        return mark(matches,${JSON.stringify(attr)});`);
      await this.page.click(result);
    }
    const save = await control(`${editor}
      if(editor.value!==${JSON.stringify(value)})return;
      const root=editor.closest('[role="dialog"],form')||document;
      return mark(${button(saveLabels)},${JSON.stringify(attr)});`);
    const saved = this.expression(
      `
      const root=document.querySelector('[role="main"],main');
      if(!root)return;
      ${matches}
      return matches(root,${JSON.stringify(value)}).length>0&&(${JSON.stringify(current ?? null)}===null||!matches(root,${JSON.stringify(current ?? null)}).length);`,
      spec.section,
    );
    try {
      await this.page.click(save);
      await this.verify(scope);
      await this.page.goto(url);
      if (!value || !(await this.until<boolean>(saved, 15_000))) {
        if (
          value ||
          !(await this.until<boolean>(
            this.expression(
              `const root=document; return ${button(["Add bio", "Biyografi ekle"])}.length===1;`,
              spec.section,
            ),
            15_000,
          ))
        )
          throw new SocialPlatformError("unknown");
      }
      await this.verify(scope);
    } catch (error) {
      await this.noChallenge();
      if (error instanceof SocialPlatformError && error.code === "needs_human") throw error;
      throw new SocialPlatformError("unknown");
    }
    return {
      name: "",
      bio: field === "bio" ? value : "",
      location: field === "currentCity" ? value : "",
      website: field === "website" ? value : "",
    };
  }
  private settingsExpression(field: SettingsField, body: string) {
    return `(() => {
      const query=new URLSearchParams(location.search);
      if(location.origin!=='https://www.facebook.com'||!/^\\/settings\\/?$/.test(location.pathname)||query.get('tab')!=='profile'||query.get('section')!==${JSON.stringify(field)})return;
      const visible=el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length;
      const usable=el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true';
      const label=el=>(el.getAttribute('aria-label')||el.textContent||'').trim();
      const labels=${JSON.stringify(settingsLabels[field])};
      const inputs=[...document.querySelectorAll('input[type="text"],input:not([type])')].filter(el=>
        usable(el)&&!el.readOnly&&(labels.includes(el.getAttribute('aria-label')||'')||[...el.labels||[]].some(el=>labels.includes(label(el)))));
      const fieldInput=inputs.length===1?inputs[0]:undefined;
      const mark=el=>{
        document.querySelectorAll('[data-bycoda-fb-setting]').forEach(el=>el.removeAttribute('data-bycoda-fb-setting'));
        if(!el)return false;
        el.setAttribute('data-bycoda-fb-setting','true');return true;
      };
      ${body}
    })()`;
  }
  private async updateIdentity(field: SettingsField, value: string): Promise<FacebookProfileState> {
    await this.authorize();
    await this.noChallenge();
    const url = `https://www.facebook.com/settings/?tab=profile&section=${field}&view`;
    await this.page.goto(url);
    const scope = this.settingsExpression(field, "return true;");
    await this.verify(scope);
    const selector = '[data-bycoda-fb-setting="true"]';
    const input = this.settingsExpression(field, "return mark(fieldInput);");
    if (!(await this.until<boolean>(input, 15_000))) {
      await this.noChallenge();
      throw new SocialPlatformError("unsupported");
    }
    await this.verify(scope);
    await this.page.fill(selector, value);
    const button = (labels: string[], inDialog: boolean) =>
      this.settingsExpression(
        field,
        `
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
      if(${inDialog ? "dialogs.length!==1" : "dialogs.length||fieldInput?.value!==" + JSON.stringify(value)})return;
      const root=${inDialog ? "dialogs[0]" : "document"};
      ${inDialog ? `if(![...root.querySelectorAll('span,strong,p,[role="heading"]')].some(el=>visible(el)&&el.textContent.trim()===${JSON.stringify(value)}))return;` : ""}
      const buttons=[...root.querySelectorAll('button,[role="button"]')].filter(el=>usable(el)&&${JSON.stringify(labels)}.includes(label(el)));
      return buttons.length===1&&mark(buttons[0]);`,
      );
    const submit = async (expression: string) => {
      if (!(await this.until<boolean>(expression, 15_000))) {
        await this.noChallenge();
        throw new SocialPlatformError("unsupported");
      }
      await this.verify(scope);
      await this.page.click(selector);
      await this.noChallenge();
    };
    if (field === "name") {
      await submit(
        button(
          [
            "Review Change",
            "Review change",
            "Değişikliği Gözden Geçir",
            "Değişikliği gözden geçir",
          ],
          false,
        ),
      );
      await submit(
        button(["Request Change", "Request change", "Değişiklik İste", "Değişiklik iste"], true),
      );
    } else {
      await submit(
        button(["Save Changes", "Save changes", "Save", "Değişiklikleri kaydet", "Kaydet"], false),
      );
    }
    // A name can be pending Meta review. Only report the new value after a fresh read verifies it.
    await this.authorize();
    await this.page.goto(url);
    await this.verify(scope);
    if (
      !(await this.until<boolean>(
        this.settingsExpression(field, `return fieldInput?.value===${JSON.stringify(value)};`),
        15_000,
      ))
    ) {
      await this.noChallenge();
      throw new SocialPlatformError("unknown");
    }
    await this.verify(scope);
    return {
      name: field === "name" ? value : "",
      bio: "",
      location: "",
      website: "",
      ...(field === "username" ? { username: value } : {}),
    };
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
    if (!found) {
      await this.noChallenge();
      throw new SocialPlatformError("unsupported");
    }
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
    raw: FacebookProfilePatch,
    files: { avatar?: string; banner?: string },
  ): Promise<FacebookProfileState> {
    const patch = parseFacebookProfilePatch(raw, this.actorType);
    if (patch.personalName) return this.updatePersonalName(patch.personalName);
    if (patch.bannerUploadId) {
      if (!files.banner || files.avatar) throw new SocialPlatformError("rejected");
      return this.updateCover(files.banner);
    }
    if (patch.name || patch.username) {
      if (files.avatar || files.banner) throw new SocialPlatformError("rejected");
      return patch.name
        ? this.updateIdentity("name", patch.name)
        : this.updateIdentity("username", patch.username!);
    }
    if (patch.bio !== undefined) return this.updateIntro("bio", patch.bio);
    if (patch.website) return this.updateIntro("website", patch.website);
    if (patch.websiteUpdate)
      return this.updateIntro("website", patch.websiteUpdate.value, patch.websiteUpdate.current);
    if (patch.detail)
      return this.updateIntro(patch.detail.field, patch.detail.value, patch.detail.current);
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
