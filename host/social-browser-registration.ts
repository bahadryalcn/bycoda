import type { SocialPlatform } from "../src/features/social/model/social";
import type { BrowserPage } from "./social-browser";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  SocialRegistrationField,
  SocialRegistrationProfile,
  SocialRegistrationBlocker,
  SocialRegistrationProgress,
} from "../src/features/social/model/socialBrowser";

export type RegistrationField = SocialRegistrationField;
export type RegistrationProfile = SocialRegistrationProfile;
export type RegistrationBlocker = SocialRegistrationBlocker;
export type RegistrationProgress = SocialRegistrationProgress;

export type LinkedInPageRegistrationSnapshot = {
  administrator: { id: string; name: string };
  fields: {
    displayName: string;
    username: string;
    industry: string;
    organizationSize: string;
    organizationType: string;
  };
  details: { label: string; value: string }[];
  terms: { text: string; url: string };
  submitLabel: string;
  agreementChecked: boolean;
  controls: { id: string; value: string }[];
};
type Contract =
  | "linkedin-person"
  | "linkedin-page"
  | "linkedin-page-navigation"
  | "youtube-channel-list"
  | "youtube-channel-confirmation"
  | "facebook-page"
  | "facebook-page-navigation"
  | "tiktok-start"
  | "tiktok-method"
  | "tiktok-email-method"
  | "tiktok-email";
type Probe = {
  contract?: Contract;
  fields: RegistrationField[];
  blockers: RegistrationBlocker[];
  navigation?:
    | "signup"
    | "email-method"
    | "email-form"
    | "facebook-page"
    | "linkedin-page"
    | "youtube-channel";
};
const literal = JSON.stringify;
const supported = new Set<SocialPlatform>([
  "linkedin",
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
]);
const origins = {
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
  tiktok: "https://www.tiktok.com",
  facebook: "https://www.facebook.com",
  youtube: "https://www.youtube.com",
} as const;
const fields: Record<RegistrationField, string> = {
  email: 'form.join-form input#email-address[name="email-address"][type="email"]',
  givenName: 'form.join-form input#first-name[name="first-name"][type="text"]',
  familyName: 'form.join-form input#last-name[name="last-name"][type="text"]',
  // These fields are not used until an observed platform contract selects them.
  displayName: "",
  username: "",
  birthdate: "",
  category: "",
};
const tiktokEmail =
  'input[type="text"][name="email"][autocomplete="email"][placeholder="Email address"]';
const linkedInPageFields = {
  displayName: 'input[id="single-line-text-form-component-urn-li-fsu-pageCreationFormItem-NAME"]',
  username:
    'input[id="single-line-text-form-component-urn-li-fsu-pageCreationFormItem-UNIVERSAL-NAME"]',
  category:
    'input[id="single-typeahead-entity-form-component-urn-li-fsu-pageCreationFormItem-INDUSTRY"][role="combobox"][aria-autocomplete="list"]',
} as const;
function fieldSelector(contract: Contract, field: RegistrationField): string {
  if (contract === "linkedin-page")
    return field === "displayName" || field === "username" ? linkedInPageFields[field] : "";
  if (contract === "facebook-page" && field === "displayName") return 'label input[type="text"]';
  return contract === "tiktok-email"
    ? field === "email"
      ? tiktokEmail
      : ""
    : contract === "linkedin-person"
      ? fields[field]
      : "";
}
function result(
  status: RegistrationProgress["status"],
  step: RegistrationProgress["step"],
  message: string,
  details: Partial<RegistrationProgress> = {},
): RegistrationProgress {
  return {
    status,
    step,
    message,
    blockers: [],
    requiredFields: [],
    filledFields: [],
    canAdvance: false,
    ...details,
  };
}

/** Only nonsecret owner-supplied fields are accepted. Runtime checking is intentional:
 * the owner RPC must not accidentally turn this into a password/code transport. */
export function parseRegistrationProfile(raw: unknown): RegistrationProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Registration needs a profile object.");
  const profile = raw as Record<string, unknown>;
  const allowed = ["accountKind", ...Object.keys(fields)];
  if (Object.keys(profile).some((key) => !allowed.includes(key)))
    throw new Error("Only nonsecret registration profile fields are accepted.");
  if (
    profile.accountKind !== undefined &&
    !["brand", "person"].includes(String(profile.accountKind))
  )
    throw new Error("Choose a brand or personal registration.");
  const parsed: RegistrationProfile = {};
  if (profile.accountKind) parsed.accountKind = profile.accountKind as "brand" | "person";
  for (const key of Object.keys(fields) as RegistrationField[]) {
    const value = profile[key];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > (key === "email" ? 254 : 100) ||
      [...value].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("Invalid registration profile field.");
    parsed[key] = value.trim();
  }
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email))
    throw new Error("Enter a valid registration email address.");
  if (parsed.username && !/^[A-Za-z0-9._-]{2,64}$/.test(parsed.username))
    throw new Error("Enter the intended public username without @.");
  if (parsed.birthdate) {
    const date = new Date(`${parsed.birthdate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.birthdate) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== parsed.birthdate ||
      date.getTime() > Date.now()
    )
      throw new Error("Use the owner's actual birth date in YYYY-MM-DD format.");
  }
  return parsed;
}

function probeExpression(
  platform: keyof typeof origins,
  accountKind?: RegistrationProfile["accountKind"],
): string {
  return String.raw`(() => {
    const empty={fields:[],blockers:[]};
    const googleAuth=${literal(platform)}==='youtube'&&location.origin==='https://accounts.google.com';
    if(location.origin!==${literal(origins[platform])}&&!googleAuth)return empty;
    const visible=el=>!!el&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length;
    const inputs=[...document.querySelectorAll('input')].filter(visible);
    const blockers=[];
    if(inputs.some(el=>el.type==='password'||/^(new-password|current-password)$/.test(el.autocomplete)))blockers.push('password');
    if(inputs.some(el=>el.autocomplete==='one-time-code'||/^(verificationCode|verification-code|security_code|confirmation_code|otp|otp-code)$/i.test(el.name)||/^(Verification code|Confirmation code|Security code|Doğrulama kodu)$/i.test(el.getAttribute('aria-label')||'')||el.getAttribute('placeholder')==='Enter 6-digit code'))blockers.push('verification');
    if([...document.querySelectorAll('iframe')].some(el=>visible(el)&&/captcha|arkoselabs|hcaptcha|recaptcha/i.test(el.getAttribute('src')||''))||[...document.querySelectorAll('[role="dialog"],h1,h2')].filter(visible).some(el=>/^(Verify (?:you are|you're) human|Complete the security check|Security verification|Güvenlik doğrulaması)$/i.test(el.textContent.trim())))blockers.push('challenge');
    if(googleAuth)return {...empty,blockers};
    const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
    if(${literal(platform)}==='linkedin'&&${literal(accountKind !== "person")}){
      const pageFields=${literal(linkedInPageFields)},visibleOne=selector=>[...document.querySelectorAll(selector)].filter(visible).length===1;
      if(location.pathname==='/company/setup/new/'&&Object.values(pageFields).every(visibleOne)&&visibleOne('select[id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-SIZE"]')&&visibleOne('select[id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-TYPE"]'))return {contract:'linkedin-page',fields:['displayName','username','category'],blockers:[...blockers,'terms']};
      const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/^(Şirket Sayfası Oluştur|Create a Company Page)$/i.test(normalize(el.textContent))).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&url.pathname==='/company/setup/new/'&&!url.username&&!url.password&&!url.hash&&!url.search;}catch{return false;}});
      if(location.pathname!=='/company/setup/new/'&&links.length===1)return {contract:'linkedin-page-navigation',fields:[],blockers,navigation:'linkedin-page'};
      return {...empty,blockers};
    }
    if(${literal(platform)}==='youtube'){
      const headings=[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(el=>visible(el)&&/^(Tüm kanallar|All channels)$/i.test(normalize(el.textContent)));
      const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/^(Kanal oluştur|Create a channel)$/i.test(normalize(el.textContent))).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&url.pathname==='/create_channel'&&!url.username&&!url.password&&!url.hash&&[...url.searchParams.keys()].every(key=>key==='channel_creation_token')&&url.searchParams.getAll('channel_creation_token').length<=1;}catch{return false;}});
      if(/^\/(account|channel_switcher)\/?$/.test(location.pathname)&&headings.length===1&&links.length===1)return {contract:'youtube-channel-list',fields:[],blockers,navigation:'youtube-channel'};
      const dialogs=[...document.querySelectorAll('[role="dialog"],tp-yt-paper-dialog')].filter(visible);
      if(dialogs.some(el=>/Nasıl görüneceksiniz\?|How you(?:’|')ll appear/i.test(normalize(el.textContent))&&[...el.querySelectorAll('button,[role="button"]')].some(button=>visible(button)&&/^(Kanal oluştur|Create channel)$/i.test(normalize(button.textContent)))))return {contract:'youtube-channel-confirmation',fields:[],blockers:[...blockers,'terms']};
      return {...empty,blockers};
    }
    if(${literal(platform)}==='facebook'&&/^\/pages\/creation\/?$/.test(location.pathname)){
      const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
      const headings=[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(el=>visible(el)&&normalize(el.textContent)==='Bir Sayfa Oluştur');
      const names=[...document.querySelectorAll('label input[type="text"]')].filter(el=>visible(el)&&normalize(el.closest('label')?.textContent).startsWith('Sayfa adı (zorunlu)'));
      const categories=[...document.querySelectorAll('input[type="search"][role="combobox"][aria-label="Kategori (zorunlu)"]')].filter(visible);
      const submits=[...document.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&normalize(el.getAttribute('aria-label')||el.textContent)==='Sayfa Oluştur');
      const terms=[...document.querySelectorAll('a[href]')].some(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return visible(el)&&url.origin===location.origin&&url.pathname==='/policies_center/pages_groups_events/';}catch{return false;}});
      if(headings.length===1&&names.length===1&&categories.length===1&&submits.length===1&&terms)
        return {contract:'facebook-page',fields:['displayName','category'],blockers:[...blockers,'terms']};
    }
    if(${literal(platform)}==='facebook'&&/^\/(?:r\.php|login(?:\.php)?\/?)?$/.test(location.pathname))
      return {contract:'facebook-page-navigation',fields:[],blockers,navigation:'facebook-page'};
    if(${literal(platform)}==='linkedin'&&/^\/signup\/?$/.test(location.pathname)){
      const forms=[...document.querySelectorAll('form.join-form')].filter(visible);
      if(forms.length!==1)return {...empty,blockers};
      const form=forms[0],action=new URL(form.getAttribute('action')||'',location.origin);
      if(action.origin!==location.origin||action.pathname!=='/signup/api/cors/createAccount'||form.getAttribute('method')?.toLowerCase()!=='post')return {...empty,blockers};
      const submit=form.querySelector('button#join-form-submit[type="submit"]');
      if(!visible(submit)||!/^(Agree & Join|Continue|Kabul Et ve Katıl|Devam Et)$/i.test((submit.textContent||submit.value||'').trim()))return {...empty,blockers};
      const keys=Object.entries(${literal(fields)}).filter(([key,selector])=>selector&&[...document.querySelectorAll(selector)].filter(visible).length===1).map(([key])=>key);
      // Both Agree & Join and Continue accept LinkedIn's agreements on this form.
      blockers.push('terms');
      return {contract:'linkedin-person',fields:keys,blockers};
    }
    if(${literal(platform)}==='tiktok'&&/^\/login\/?$/.test(location.pathname)){
      const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/^(Sign up|Kaydol)$/i.test((el.textContent||'').trim())).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&url.pathname==='/signup';}catch{return false;}});
      if(links.length===1)return {contract:'tiktok-start',fields:[],blockers,navigation:'signup'};
    }
    if(${literal(platform)}==='tiktok'&&/^\/signup\/?$/.test(location.pathname)){
      const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/^(Use phone or email|Telefon veya e-posta kullan)$/i.test((el.textContent||'').trim())).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&/^\/signup\/phone-or-email(?:\/phone)?\/?$/.test(url.pathname);}catch{return false;}});
      if(links.length===1)return {contract:'tiktok-method',fields:[],blockers,navigation:'email-method'};
    }
    if(${literal(platform)}==='tiktok'&&/^\/signup\/phone-or-email\/phone\/?$/.test(location.pathname)){
      const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el)&&/^(Sign up with email|E-posta ile kaydol)$/i.test((el.textContent||'').trim())).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&/^\/signup\/phone-or-email\/email\/?$/.test(url.pathname);}catch{return false;}});
      if(links.length===1)return {contract:'tiktok-email-method',fields:[],blockers,navigation:'email-form'};
    }
    if(${literal(platform)}==='tiktok'&&/^\/signup\/phone-or-email\/email\/?$/.test(location.pathname)){
      const email=[...document.querySelectorAll(${literal(tiktokEmail)})].filter(visible);
      const passwords=inputs.filter(el=>el.type==='password'&&el.autocomplete==='new-password');
      const codes=inputs.filter(el=>el.type==='text'&&el.getAttribute('placeholder')==='Enter 6-digit code');
      const buttons=[...document.querySelectorAll('button')].filter(visible);
      const send=buttons.filter(el=>el.type==='button'&&el.textContent.trim()==='Send code');
      const submit=buttons.filter(el=>el.type==='submit'&&el.textContent.trim()==='Next');
      if(email.length===1&&passwords.length===1&&codes.length===1&&send.length===1&&submit.length===1)
        return {contract:'tiktok-email',fields:['email','birthdate'],blockers};
    }
    return {...empty,blockers};
  })()`;
}

async function fillTikTokBirthdate(
  page: BrowserPage,
  birthdate: string,
  beforeAction?: () => Promise<void>,
): Promise<boolean> {
  const [year, month, day] = birthdate.split("-");
  const requested = {
    Month: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][Number(month) - 1],
    Day: String(Number(day)),
    Year: year,
  };
  for (const part of ["Month", "Day", "Year"] as const) {
    await beforeAction?.();
    const state = await page.evaluate<
      { expanded: boolean; same: boolean } | undefined
    >(String.raw`(() => {
      if(location.origin!=='https://www.tiktok.com'||!/^\/signup\/phone-or-email\/email\/?$/.test(location.pathname))return;
      const controls=[...document.querySelectorAll('[role="combobox"]')].filter(el=>!el.hidden&&!!el.getClientRects().length&&el.getAttribute('aria-label')===${literal(`${part}. Double-tap for more options`)});
      if(controls.length!==1)return;const control=controls[0],value=control.textContent.trim();
      const expanded=control.getAttribute('aria-expanded')==='true',controlsId=control.getAttribute('aria-controls');
      if(expanded?controlsId!==${literal(`${part}-options-list-container`)}:!!controlsId&&controlsId!==${literal(`${part}-options-list-container`)})return;
      if(control.getAttribute('aria-disabled')==='true'||(value!==${literal(part)}&&value!==${literal(requested[part])}))return;
      document.querySelectorAll('[data-bycoda-registration-date]').forEach(el=>el.removeAttribute('data-bycoda-registration-date'));
      control.setAttribute('data-bycoda-registration-date',${literal(part)});
      return {expanded,same:value===${literal(requested[part])}};
    })()`);
    if (!state) return false;
    if (state.same) continue;
    const selector = `[data-bycoda-registration-date=${literal(part)}]`;
    if (!state.expanded) {
      await beforeAction?.();
      await page.click(selector);
    }
    let selected = false;
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        selected = await page.evaluate<boolean>(String.raw`(() => {
          if(location.origin!=='https://www.tiktok.com'||!/^\/signup\/phone-or-email\/email\/?$/.test(location.pathname))return false;
          const control=document.querySelector(${literal(selector)});
          if(!control||control.getAttribute('aria-expanded')!=='true'||control.getAttribute('aria-controls')!==${literal(`${part}-options-list-container`)})return false;
          const lists=[...document.querySelectorAll(${literal(`#${part}-options-list-container[role="listbox"]`)})].filter(el=>!el.hidden&&!!el.getClientRects().length);
          if(lists.length!==1)return false;
          const options=[...lists[0].querySelectorAll('[role="option"]')].filter(el=>!el.hidden&&!!el.getClientRects().length&&el.id.startsWith(${literal(`${part}-options-item-`)})&&el.textContent.trim()===${literal(requested[part])}&&el.getAttribute('aria-disabled')!=='true');
          if(options.length!==1)return false;
          document.querySelectorAll('[data-bycoda-registration-date-option]').forEach(el=>el.removeAttribute('data-bycoda-registration-date-option'));
          options[0].setAttribute('data-bycoda-registration-date-option','true');return true;
        })()`);
        if (selected) break;
        await sleep(100);
      }
      if (!selected) return false;
      await beforeAction?.();
      const unchanged = await page.evaluate<boolean>(String.raw`(() => {
        if(location.origin!=='https://www.tiktok.com'||!/^\/signup\/phone-or-email\/email\/?$/.test(location.pathname))return false;
        const control=document.querySelector(${literal(selector)}),option=document.querySelector('[data-bycoda-registration-date-option="true"]');
        return !!control&&!!option&&control.getAttribute('aria-expanded')==='true'&&control.getAttribute('aria-controls')===${literal(`${part}-options-list-container`)}&&(control.textContent.trim()===${literal(part)}||control.textContent.trim()===${literal(requested[part])})&&option.textContent.trim()===${literal(requested[part])}&&option.getAttribute('role')==='option'&&option.parentElement?.id===${literal(`${part}-options-list-container`)};
      })()`);
      if (!unchanged) return false;
      await page.click('[data-bycoda-registration-date-option="true"]');
      const retained = await page.evaluate<boolean>(String.raw`(() => {
        if(location.origin!=='https://www.tiktok.com'||!/^\/signup\/phone-or-email\/email\/?$/.test(location.pathname))return false;
        const control=document.querySelector(${literal(selector)});
        return !!control&&control.getAttribute('aria-label')===${literal(`${part}. Double-tap for more options`)}&&control.textContent.trim()===${literal(requested[part])};
      })()`);
      if (!retained) return false;
    } finally {
      if (!state.expanded) {
        const expanded = await page.evaluate<boolean>(
          `document.querySelector(${literal(selector)})?.getAttribute('aria-expanded')==='true'`,
        );
        if (expanded) {
          try {
            await beforeAction?.();
            await page.click(selector);
          } catch {
            // Cancellation must not cause a cleanup click in an inactive workflow.
          }
        }
      }
    }
  }
  return true;
}

function facebookCategoryState(category: string, mark = false): string {
  return String.raw`(() => {
    if(location.origin!=='https://www.facebook.com'||!/^\/pages\/creation\/?$/.test(location.pathname))return;
    const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
    const visible=el=>!!el&&!el.hidden&&!!el.getClientRects().length;
    const inputs=[...document.querySelectorAll('input[type="search"][role="combobox"][aria-label="Kategori (zorunlu)"]')].filter(el=>visible(el)&&!el.disabled&&!el.readOnly);
    if(inputs.length!==1)return;const input=inputs[0];
    const lists=[...document.querySelectorAll('[role="list"][aria-label="Seçilen değerler"]')].filter(visible);
    if(lists.length>1)return;
    const selected=lists.length?[...lists[0].querySelectorAll('button,[role="button"]')].filter(visible):[];
    if(lists.length&&!selected.length&&lists[0].children.length)return;
    const desired=${literal(category + " Kaldır")};
    if(selected.length>1||selected.some(el=>normalize(el.getAttribute('aria-label')||el.textContent)!==desired))return {state:'changed'};
    if(selected.length===1)return {state:input.value?'changed':'same'};
    if(input.value&&input.value!==${literal(category)})return {state:'changed'};
    if(${mark}){
      document.querySelectorAll('[data-bycoda-registration-category]').forEach(el=>el.removeAttribute('data-bycoda-registration-category'));
      input.setAttribute('data-bycoda-registration-category','true');
    }
    return {state:'empty',query:input.value?'same':'empty'};
  })()`;
}

async function fillFacebookCategory(
  page: BrowserPage,
  category: string,
  beforeAction?: () => Promise<void>,
): Promise<boolean> {
  await beforeAction?.();
  const previous = await page.evaluate<{ state: string; query?: string } | undefined>(
    facebookCategoryState(category, true),
  );
  if (!previous || previous.state === "changed") return false;
  if (previous.state === "same") return true;
  if (previous.query === "empty") {
    await beforeAction?.();
    const current = await page.evaluate<{ state: string; query?: string } | undefined>(
      facebookCategoryState(category, true),
    );
    if (!current || current.state === "changed") return false;
    if (current.state === "same") return true;
    if (current.query === "empty")
      await page.fill('[data-bycoda-registration-category="true"]', category);
  }
  let option = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await page.evaluate<{ state: string; query?: string } | undefined>(
      facebookCategoryState(category),
    );
    if (!current || current.state === "changed") return false;
    if (current.state === "same") return true;
    option = await page.evaluate<boolean>(String.raw`(() => {
      if(location.origin!=='https://www.facebook.com'||!/^\/pages\/creation\/?$/.test(location.pathname))return false;
      const visible=el=>!el.hidden&&!!el.getClientRects().length;
      const lists=[...document.querySelectorAll('ul[role="listbox"]')].filter(visible);
      if(lists.length!==1)return false;
      const options=[...lists[0].querySelectorAll('li[role="option"]')].filter(el=>visible(el)&&(el.textContent||'').replace(/\s+/g,' ').trim()===${literal(category)}&&el.getAttribute('aria-disabled')!=='true');
      if(options.length!==1)return false;
      document.querySelectorAll('[data-bycoda-registration-category-option]').forEach(el=>el.removeAttribute('data-bycoda-registration-category-option'));
      options[0].setAttribute('data-bycoda-registration-category-option','true');return true;
    })()`);
    if (option) break;
    await sleep(100);
  }
  if (!option) return false;
  await beforeAction?.();
  const unchanged = await page.evaluate<{ state: string; query?: string } | undefined>(
    facebookCategoryState(category),
  );
  if (unchanged?.state === "same") return true;
  if (unchanged?.state !== "empty" || unchanged.query !== "same") return false;
  await page.click('[data-bycoda-registration-category-option="true"]');
  for (let attempt = 0; attempt < 20; attempt++) {
    const selected = await page.evaluate<{ state: string } | undefined>(
      facebookCategoryState(category),
    );
    if (selected?.state === "same") return true;
    if (!selected || selected.state === "changed") return false;
    await sleep(100);
  }
  return false;
}

function linkedInIndustryExpression(category: string, mark = false): string {
  return String.raw`(() => {
    if(location.origin!=='https://www.linkedin.com'||location.pathname!=='/company/setup/new/')return;
    const visible=el=>!!el&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length;
    const inputs=[...document.querySelectorAll(${literal(linkedInPageFields.category)})].filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&el.getAttribute('aria-autocomplete')==='list');
    if(inputs.length!==1)return;
    const input=inputs[0],desired=${literal(category)},controls=input.getAttribute('aria-controls');
    if(input.value&&input.value!==desired)return {state:'changed'};
    if(!input.value)return {state:'empty'};
    if(input.getAttribute('aria-expanded')==='false'&&!controls)return {state:'same'};
    if(input.getAttribute('aria-expanded')!=='true'||!controls)return;
    const list=document.getElementById(controls);
    if(!visible(list)||list.getAttribute('role')!=='listbox')return;
    const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
    const options=[...list.querySelectorAll('div[role="option"]')].filter(el=>visible(el)&&el.getAttribute('aria-disabled')!=='true'&&el.id.startsWith('basic-result-')&&normalize(el.textContent)===desired);
    if(options.length!==1)return;
    if(${mark}){
      document.querySelectorAll('[data-bycoda-linkedin-industry]').forEach(el=>el.removeAttribute('data-bycoda-linkedin-industry'));
      options[0].setAttribute('data-bycoda-linkedin-industry','true');
    }
    return {state:'option'};
  })()`;
}

async function fillLinkedInIndustry(
  page: BrowserPage,
  category: string,
  beforeAction?: () => Promise<void>,
): Promise<boolean> {
  let current = await page.evaluate<{ state: string } | undefined>(
    linkedInIndustryExpression(category),
  );
  if (!current || current.state === "changed") return false;
  if (current.state === "same") return true;
  if (current.state === "empty") {
    await beforeAction?.();
    current = await page.evaluate<{ state: string } | undefined>(
      linkedInIndustryExpression(category),
    );
    if (!current || !["empty", "same"].includes(current.state)) return false;
    if (current.state === "same") return true;
    await page.fill(linkedInPageFields.category, category);
  }
  let found = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await page.evaluate<{ state: string } | undefined>(
      linkedInIndustryExpression(category),
    );
    if (state?.state === "option") {
      found = true;
      break;
    }
    if (state?.state === "changed") return false;
    await sleep(100);
  }
  if (!found) return false;
  await beforeAction?.();
  const marked = await page.evaluate<{ state: string } | undefined>(
    linkedInIndustryExpression(category, true),
  );
  if (marked?.state !== "option") return false;
  await beforeAction?.();
  const rechecked = await page.evaluate<{ state: string } | undefined>(
    linkedInIndustryExpression(category, true),
  );
  if (rechecked?.state !== "option") return false;
  await page.click('[data-bycoda-linkedin-industry="true"]');
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await page.evaluate<{ state: string } | undefined>(
      linkedInIndustryExpression(category),
    );
    if (state?.state === "same") return true;
    if (state?.state === "changed") return false;
    await sleep(100);
  }
  return false;
}

function progress(
  platform: SocialPlatform,
  profile: RegistrationProfile,
  probe: Probe,
): RegistrationProgress {
  if (probe.blockers.includes("challenge"))
    return result(
      "awaiting_owner",
      "challenge",
      "Complete the platform's verification in its browser window, then resume this step.",
      { blockers: probe.blockers },
    );
  if (
    probe.blockers.length &&
    !probe.contract &&
    (platform === "youtube" || (platform === "linkedin" && profile.accountKind !== "person"))
  )
    return result(
      "awaiting_owner",
      probe.blockers[0],
      "Sign in with the intended Page or channel administrator in the platform window, then resume. No new account has been created.",
      { blockers: probe.blockers },
    );
  if (probe.contract === "youtube-channel-confirmation")
    return result(
      "awaiting_owner",
      "terms",
      "Verify the displayed Google administrator and existing channels before creating a channel. The final creation accepts YouTube's terms and must be completed in the platform window; creation remains unverified.",
      { blockers: probe.blockers },
    );
  if (
    (platform === "youtube" && probe.contract !== "youtube-channel-list") ||
    (platform === "facebook" &&
      !["facebook-page", "facebook-page-navigation"].includes(probe.contract ?? "")) ||
    (platform === "linkedin" &&
      profile.accountKind !== "person" &&
      probe.contract !== "linkedin-page-navigation" &&
      probe.contract !== "linkedin-page")
  )
    return result(
      "needs_fields",
      "admin_setup",
      "A brand uses an owner-administered Page or channel. Do not create a company as a person's member account.",
    );
  if (!probe.contract)
    return result(
      probe.blockers.length ? "awaiting_owner" : "unsupported",
      probe.blockers[0] ?? "unknown",
      "The current signup layout cannot be safely advanced. Review the open platform window.",
      { blockers: probe.blockers },
    );
  const requiredFields = probe.fields.filter((key) => !profile[key]);
  if (requiredFields.length)
    return result(
      "needs_fields",
      "profile",
      "Provide the missing nonsecret owner registration fields.",
      { blockers: probe.blockers, requiredFields },
    );
  if (probe.contract === "linkedin-page")
    return result(
      "needs_fields",
      "admin_setup",
      "The Page name and public username can be prepared. Verify the industry and choose the organization size and type in the platform window. The authority checkbox and final Create page action remain untouched; creation is unverified.",
      { blockers: probe.blockers },
    );
  if (probe.navigation)
    return result(
      "ready",
      "method",
      "The observed signup navigation can advance without submitting an account form.",
      { canAdvance: true },
    );
  if (probe.blockers.length)
    return result(
      "awaiting_owner",
      probe.blockers[0],
      "This step requires a password, verification or agreement action in the platform window. Resume afterwards; registration remains unverified.",
      { blockers: probe.blockers },
    );
  return result(
    "ready",
    "method",
    "The observed signup navigation can advance without submitting an account form.",
    { canAdvance: !!probe.navigation },
  );
}

/** Reads only structure and the presence of boundary controls, never their values. */
export async function inspectSocialRegistration(
  page: BrowserPage,
  platform: SocialPlatform,
  rawProfile: RegistrationProfile = {},
): Promise<RegistrationProgress> {
  const profile = parseRegistrationProfile(rawProfile);
  if (!supported.has(platform)) return progress(platform, profile, { fields: [], blockers: [] });
  const probe = await page.evaluate<Probe>(
    probeExpression(platform as keyof typeof origins, profile.accountKind),
  );
  return progress(platform, profile, probe);
}

/** One explicit resume fills verified nonsecret fields and performs at most one
 * nonbinding navigation. It never submits signup, accepts terms or enters secrets. */
export async function advanceSocialRegistration(
  page: BrowserPage,
  platform: SocialPlatform,
  rawProfile: RegistrationProfile,
  options: { beforeAction?: () => Promise<void> } = {},
): Promise<RegistrationProgress> {
  return prepareRegistrationStep(page, platform, rawProfile, options, true);
}

async function prepareRegistrationStep(
  page: BrowserPage,
  platform: SocialPlatform,
  rawProfile: RegistrationProfile,
  options: { beforeAction?: () => Promise<void> },
  allowNavigation: boolean,
): Promise<RegistrationProgress> {
  const profile = parseRegistrationProfile(rawProfile);
  if (!supported.has(platform)) return progress(platform, profile, { fields: [], blockers: [] });
  const selected = platform as keyof typeof origins;
  const probe = await page.evaluate<Probe>(probeExpression(selected, profile.accountKind));
  if (!probe.contract || probe.blockers.includes("challenge"))
    return progress(platform, profile, probe);
  const filledFields: RegistrationField[] = [];
  const fieldPath =
    probe.contract === "linkedin-page"
      ? "^/company/setup/new/$"
      : selected === "tiktok"
        ? "^/signup/phone-or-email/email/?$"
        : selected === "facebook"
          ? "^/pages/creation/?$"
          : "^/signup/?$";
  for (const key of probe.fields) {
    if (!profile[key]) continue;
    if (key === "category" && probe.contract === "linkedin-page") {
      if (!(await fillLinkedInIndustry(page, profile.category!, options.beforeAction)))
        return result(
          "changed",
          "profile",
          "The exact LinkedIn industry option or an existing owner selection changed. Review it in the platform window.",
          { filledFields },
        );
      filledFields.push(key);
      continue;
    }
    if (key === "birthdate" && probe.contract === "tiktok-email") {
      if (!(await fillTikTokBirthdate(page, profile.birthdate!, options.beforeAction)))
        return result(
          "changed",
          "birthdate",
          "The birthday control or an existing owner selection changed. Review it before resuming.",
          { filledFields },
        );
      filledFields.push(key);
      continue;
    }
    if (key === "category" && probe.contract === "facebook-page") {
      if (!(await fillFacebookCategory(page, profile.category!, options.beforeAction)))
        return result(
          "changed",
          "profile",
          "The Page category or an existing owner choice changed. Review it before resuming.",
          { filledFields },
        );
      filledFields.push(key);
      continue;
    }
    const selector = fieldSelector(probe.contract, key);
    if (!selector) continue;
    await options.beforeAction?.();
    const marked = await page.evaluate<"empty" | "same" | "changed" | undefined>(String.raw`(() => {
      if(location.origin!==${literal(origins[selected])}||!new RegExp(${literal(fieldPath)}).test(location.pathname))return;
      const matches=[...document.querySelectorAll(${literal(selector)})].filter(el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length&&!el.disabled&&!el.readOnly);
      if(${literal(probe.contract)}==='facebook-page'){
        for(let index=matches.length-1;index>=0;index--)if(!(matches[index].closest('label')?.textContent||'').replace(/\s+/g,' ').trim().startsWith('Sayfa adı (zorunlu)'))matches.splice(index,1);
      }
      if(matches.length!==1)return;const input=matches[0];
      if(input.type==='password'||input.autocomplete==='one-time-code'||/password|verification|confirmation|security_code|otp/i.test(input.name))return;
      if(input.value&&input.value!==${literal(profile[key])})return 'changed';
      document.querySelectorAll('[data-bycoda-registration-field]').forEach(el=>el.removeAttribute('data-bycoda-registration-field'));
      input.setAttribute('data-bycoda-registration-field',${literal(key)});
      return input.value?'same':'empty';
    })()`);
    if (!marked || marked === "changed")
      return result(
        "changed",
        "profile",
        "The signup field or an existing owner value changed. Review it before resuming.",
        { filledFields },
      );
    if (marked === "empty") {
      await options.beforeAction?.();
      const unchanged = await page.evaluate<"empty" | "same" | undefined>(String.raw`(() => {
        if(location.origin!==${literal(origins[selected])}||!new RegExp(${literal(fieldPath)}).test(location.pathname))return;
        const input=document.querySelector('[data-bycoda-registration-field="${key}"]');
        if(!input||!input.matches(${literal(selector)})||input.hidden||!input.getClientRects().length||input.disabled||input.readOnly||input.type==='password'||input.autocomplete==='one-time-code')return;
        return input.value===${literal(profile[key])}?'same':input.value?undefined:'empty';
      })()`);
      if (!unchanged)
        return result(
          "changed",
          "profile",
          "The signup field or an existing owner value changed. Review it before resuming.",
          { filledFields },
        );
      if (unchanged === "empty")
        await page.fill(`[data-bycoda-registration-field=${literal(key)}]`, profile[key]!);
    }
    const persisted = await page.evaluate<boolean>(String.raw`(() => {
      if(location.origin!==${literal(origins[selected])})return false;
      const input=document.querySelector('[data-bycoda-registration-field="${key}"]');
      return !!input&&input.type!=='password'&&input.autocomplete!=='one-time-code'&&input.value===${literal(profile[key])};
    })()`);
    if (!persisted)
      return result(
        "changed",
        "profile",
        "The platform did not retain the prepared field. Review the open form.",
        { filledFields },
      );
    filledFields.push(key);
  }
  const fresh = await page.evaluate<Probe>(probeExpression(selected, profile.accountKind));
  const state = progress(platform, profile, fresh);
  if (!state.canAdvance || !fresh.navigation) return { ...state, filledFields };
  if (!allowNavigation)
    return result(
      "changed",
      "method",
      "The signup layout changed while preparing fields. Review it before resuming.",
      { filledFields },
    );
  if (fresh.navigation === "linkedin-page" || fresh.navigation === "youtube-channel") {
    await options.beforeAction?.();
    const current = await page.evaluate<Probe>(probeExpression(selected, profile.accountKind));
    if (
      current.contract !== fresh.contract ||
      current.navigation !== fresh.navigation ||
      current.blockers.length
    )
      return result(
        "changed",
        "admin_setup",
        "The administrator navigation changed. Review the platform window.",
        { filledFields },
      );
    const marked = await page.evaluate<boolean>(String.raw`(() => {
      if(location.origin!==${literal(origins[selected])})return false;
      const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
      const label=${literal(fresh.navigation === "linkedin-page" ? "^(Şirket Sayfası Oluştur|Create a Company Page)$" : "^(Kanal oluştur|Create a channel)$")};
      const path=${literal(fresh.navigation === "linkedin-page" ? "/company/setup/new/" : "/create_channel")};
      const links=[...document.querySelectorAll('a[href]')].filter(el=>!el.hidden&&!!el.getClientRects().length&&new RegExp(label,'i').test(normalize(el.textContent))).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&url.pathname===path&&!url.username&&!url.password&&!url.hash&&(path==='/create_channel'?[...url.searchParams.keys()].every(key=>key==='channel_creation_token')&&url.searchParams.getAll('channel_creation_token').length<=1:!url.search);}catch{return false;}});
      if(links.length!==1)return false;
      document.querySelectorAll('[data-bycoda-registration-navigation]').forEach(el=>el.removeAttribute('data-bycoda-registration-navigation'));
      links[0].setAttribute('data-bycoda-registration-navigation','true');return true;
    })()`);
    if (!marked)
      return result(
        "changed",
        "admin_setup",
        "The Page or channel link changed. Review the platform window.",
        { filledFields },
      );
    await options.beforeAction?.();
    await page.click('[data-bycoda-registration-navigation="true"]');
    const after = await page.evaluate<Probe>(probeExpression(selected, profile.accountKind));
    return { ...progress(platform, profile, after), filledFields };
  }
  if (fresh.navigation === "facebook-page") {
    await options.beforeAction?.();
    const current = await page.evaluate<Probe>(probeExpression("facebook"));
    if (current.contract !== "facebook-page-navigation" || current.blockers.includes("challenge"))
      return result(
        "changed",
        "admin_setup",
        "The Facebook administrator setup page changed. Review the platform window.",
        { filledFields },
      );
    await options.beforeAction?.();
    await page.goto("https://www.facebook.com/pages/creation/");
    const after = await page.evaluate<Probe>(probeExpression("facebook"));
    if (after.contract !== "facebook-page")
      return result(
        "needs_fields",
        "admin_setup",
        "Sign in with the intended Page administrator in the platform window, then resume. Page creation remains unverified.",
        { filledFields, blockers: after.blockers },
      );
    return prepareRegistrationStep(page, platform, profile, options, false);
  }
  await options.beforeAction?.();
  const marked = await page.evaluate<boolean>(String.raw`(() => {
    if(location.origin!==${literal(origins[selected])})return false;
    const desired=${literal(fresh.navigation === "signup" ? "^/signup/?$" : fresh.navigation === "email-method" ? "^/signup/phone-or-email(?:/phone)?/?$" : "^/signup/phone-or-email/email/?$")};
    const label=${literal(fresh.navigation === "signup" ? "^(Sign up|Kaydol)$" : fresh.navigation === "email-method" ? "^(Use phone or email|Telefon veya e-posta kullan)$" : "^(Sign up with email|E-posta ile kaydol)$")};
    const links=[...document.querySelectorAll('a[href]')].filter(el=>!el.hidden&&!!el.getClientRects().length&&new RegExp(label,'i').test((el.textContent||'').trim())).filter(el=>{try{const url=new URL(el.getAttribute('href'),location.origin);return url.origin===location.origin&&new RegExp(desired).test(url.pathname);}catch{return false;}});
    if(links.length!==1)return false;
    document.querySelectorAll('[data-bycoda-registration-navigation]').forEach(el=>el.removeAttribute('data-bycoda-registration-navigation'));
    links[0].setAttribute('data-bycoda-registration-navigation','true');return true;
  })()`);
  if (!marked)
    return result(
      "changed",
      "method",
      "The signup navigation changed. Review the platform window.",
      { filledFields },
    );
  await options.beforeAction?.();
  await page.click('[data-bycoda-registration-navigation="true"]');
  const after = await page.evaluate<Probe>(probeExpression(selected, profile.accountKind));
  if (after.fields.length) return prepareRegistrationStep(page, platform, profile, options, false);
  return { ...progress(platform, profile, after), filledFields };
}

const linkedInTermsId = "urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS-0";
const linkedInCreateLabel = /^(Sayfayı oluştur|Create page)$/i;
const linkedInFinalControls = [
  [
    "displayName",
    "Page name",
    "single-line-text-form-component-urn-li-fsu-pageCreationFormItem-NAME",
    "INPUT",
  ],
  [
    "username",
    "Username",
    "single-line-text-form-component-urn-li-fsu-pageCreationFormItem-UNIVERSAL-NAME",
    "INPUT",
  ],
  [
    "website",
    "Website",
    "single-line-text-form-component-urn-li-fsu-pageCreationFormItem-WEBSITE",
    "INPUT",
  ],
  [
    "industry",
    "Industry",
    "single-typeahead-entity-form-component-urn-li-fsu-pageCreationFormItem-INDUSTRY",
    "INPUT",
  ],
  [
    "organizationSize",
    "Organization size",
    "text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-SIZE",
    "SELECT",
  ],
  [
    "organizationType",
    "Organization type",
    "text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-TYPE",
    "SELECT",
  ],
  [
    "tagline",
    "Tagline",
    "multiline-text-form-component-urn-li-fsu-pageCreationFormItem-TAGLINE",
    "TEXTAREA",
  ],
] as const;
const linkedInLogoId = "media-upload-form-component-urn-li-fsu-pageCreationFormItem-LOGO";

async function registrationUntil<T>(page: BrowserPage, expression: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await page.evaluate<T | undefined>(expression);
    if (value !== undefined && value !== false && value !== null) return value as T;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("The exact registration layout or result could not be verified.");
}

/** The signed-in administrator is read only from the opened native Me profile card. */
async function linkedInRegistrationAdministrator(
  page: BrowserPage,
  beforeAction?: () => Promise<void>,
  timeoutMs = 15_000,
) {
  await beforeAction?.();
  const marked = await page.evaluate<boolean>(`(() => {
    if(location.origin!=='https://www.linkedin.com')return false;
    const visible=el=>!!el.getClientRects().length;
    const buttons=[...document.querySelectorAll('.global-nav__me button')].filter(visible);
    if(buttons.length!==1)return false;
    document.querySelectorAll('[data-bycoda-registration-admin]').forEach(el=>el.removeAttribute('data-bycoda-registration-admin'));
    buttons[0].setAttribute('data-bycoda-registration-admin','true');return true;
  })()`);
  if (!marked) throw new Error("The current LinkedIn administrator cannot be verified.");
  const selector = '[data-bycoda-registration-admin="true"]';
  let opened = false;
  try {
    const expanded = await page.evaluate<boolean>(
      `document.querySelector('${selector}')?.getAttribute('aria-expanded')==='true'`,
    );
    if (!expanded) {
      await beforeAction?.();
      await page.click(selector);
      opened = true;
    }
    return await registrationUntil<{ id: string; name: string }>(
      page,
      `(() => {
      if(location.origin!=='https://www.linkedin.com')return;
      const links=[...document.querySelectorAll('.global-nav__me-content header a[href]')].filter(el=>el.getClientRects().length);
      if(links.length!==1)return;
      try{const url=new URL(links[0].getAttribute('href'),location.origin),slug=/^\\/in\\/([A-Za-z0-9_%.-]{1,100})\\/?$/.exec(url.pathname)?.[1];
        const name=(links[0].textContent||'').replace(/\\s+/g,' ').trim();
        if(url.origin!=='https://www.linkedin.com'||!slug||!name||name.length>200)return;
        return {id:'web:linkedin:in:'+slug.toLowerCase(),name};
      }catch{return;}
    })()`,
      timeoutMs,
    );
  } finally {
    if (opened) {
      await beforeAction?.();
      const expanded = await page.evaluate<boolean>(
        `document.querySelector('${selector}')?.getAttribute('aria-expanded')==='true'`,
      );
      if (expanded) await page.click(selector);
    }
  }
}

/** Reads one existing numeric organization resource; it never creates, edits or connects it. */
export async function readExistingLinkedInPageRegistration(
  page: BrowserPage,
  resourceId: string,
  beforeAction: () => Promise<void>,
  timeoutMs = 20_000,
): Promise<{
  resourceId: string;
  resourceUrl: string;
  administrator: { id: string; name: string };
  fields: { displayName: string; username: string };
}> {
  if (typeof resourceId !== "string" || !/^[1-9]\d{0,19}$/.test(resourceId))
    throw new Error("Enter the existing LinkedIn Page's numeric ID.");
  await beforeAction();
  await page.goto(
    `https://www.linkedin.com/company/${resourceId}/admin/edit/?editPageActiveTab=info`,
  );
  const expression = `(() => {
    if(location.origin!=='https://www.linkedin.com'||!new RegExp(${literal(`^/company/${resourceId}/admin/edit/?$`)}).test(location.pathname))return;
    const visible=el=>!!el&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length;
    const names=[...document.querySelectorAll('#organization-name-field')].filter(visible);
    const slugs=[...document.querySelectorAll('#organization-public-url-field')].filter(visible);
    if(names.length!==1||slugs.length!==1||names[0].tagName!=='INPUT'||slugs[0].tagName!=='INPUT'||names[0].type!=='text'||slugs[0].type!=='text')return;
    const displayName=names[0].value, username=slugs[0].value;
    if(!displayName.trim()||displayName.length>100||displayName.includes('\\0')||!username.trim()||username.length>100||username.includes('\\0'))return;
    return {displayName,username};
  })()`;
  const fields = await registrationUntil<{ displayName: string; username: string }>(
    page,
    expression,
    timeoutMs,
  );
  await beforeAction();
  const administrator = await linkedInRegistrationAdministrator(page, beforeAction, timeoutMs);
  await beforeAction();
  const fresh = await page.evaluate<{ displayName: string; username: string } | undefined>(
    expression,
  );
  if (!fresh || JSON.stringify(fresh) !== JSON.stringify(fields))
    throw new Error("The existing Page changed while its identity was being read.");
  await beforeAction();
  return {
    resourceId,
    resourceUrl: `https://www.linkedin.com/company/${resourceId}/`,
    administrator,
    fields,
  };
}

/** Whitelisted nonsecret final form fields only. No hidden, password or code value is read. */
export async function reviewLinkedInPageRegistration(
  page: BrowserPage,
  profile: RegistrationProfile,
  options: { beforeAction?: () => Promise<void>; checked?: boolean } = {},
): Promise<LinkedInPageRegistrationSnapshot> {
  await options.beforeAction?.();
  const administrator = await linkedInRegistrationAdministrator(page, options.beforeAction);
  const form = await page.evaluate<
    Omit<LinkedInPageRegistrationSnapshot, "administrator"> | undefined
  >(`(() => {
    if(location.origin!=='https://www.linkedin.com'||location.pathname!=='/company/setup/new/')return;
    const visible=el=>!!el&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length;
    const inputs=[...document.querySelectorAll('input')].filter(visible);
    if(inputs.some(el=>el.type==='password'||el.autocomplete==='one-time-code'||/verification|confirmation_code|security_code|otp/i.test(el.name)))return;
    if([...document.querySelectorAll('iframe')].some(el=>visible(el)&&/captcha|arkoselabs|hcaptcha|recaptcha/i.test(el.getAttribute('src')||'')))return;
    if([...document.querySelectorAll('[role="dialog"],h1,h2')].filter(visible).some(el=>/^(Verify (?:you are|you're) human|Complete the security check|Security verification|Güvenlik doğrulaması)$/i.test(el.textContent.trim())))return;
    const specs=${literal(linkedInFinalControls)},termId=${literal(linkedInTermsId)},logoId=${literal(linkedInLogoId)};
    const names=[...document.querySelectorAll('[id]')].filter(el=>el.id===specs[0][2]&&visible(el));
    if(names.length!==1)return;
    const form=names[0].closest('form');if(!form)return;
    const allowed=new Set([...specs.map(row=>row[2]),termId,logoId]);
    const all=[...form.querySelectorAll('input,select,textarea')];
    if(all.some(el=>!allowed.has(el.id)))return;
    const checkbox=[...form.querySelectorAll('input')].filter(el=>el.id===termId);
    if(checkbox.length!==1||checkbox[0].type!=='checkbox'||checkbox[0].name!=='urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS'||(${literal(options.checked ?? null)}!==null&&checkbox[0].checked!==${literal(options.checked ?? null)})||checkbox[0].disabled)return;
    const labels=[...form.querySelectorAll('label')].filter(el=>el.htmlFor===termId&&visible(el));
    if(labels.length!==1)return;
    const text=(labels[0].textContent||'').replace(/\\s+/g,' ').trim();if(!text||text.length>3000)return;
    const links=[...form.querySelectorAll('a[href]')].filter(el=>visible(el)&&el.getAttribute('href')==='https://legal.linkedin.com/linkedin-pages-terms');
    if(links.length!==1)return;
    const logo=[...form.querySelectorAll('input')].filter(el=>el.id===logoId);
    if(logo.length>1||logo.some(el=>el.type!=='file'||el.files?.length))return;
    if([...form.querySelectorAll('img')].some(el=>visible(el)&&el.getAttribute('src')))return;
    const values={},controls=[],details=[];
    for(const [key,label,id,tag]of specs){
      const matches=all.filter(el=>el.id===id);
      if(matches.length!==1||matches[0].tagName!==tag||!visible(matches[0])||matches[0].disabled||matches[0].getAttribute('aria-invalid')==='true')return;
      const el=matches[0];if(el.tagName==='INPUT'&&!['text','url','search'].includes(el.type))return;
      const value=el.value;if(typeof value!=='string'||value.length>4096)return;
      if(el.tagName==='SELECT'&&(!value||el.selectedIndex<0))return;
      const display=el.tagName==='SELECT'?el.options[el.selectedIndex].textContent.trim():value.trim();
      values[key]=display;controls.push({id,value});details.push({label,value:display});
    }
    if(!values.displayName||!values.username||!values.industry)return;
    const buttons=[...form.querySelectorAll('button')].filter(el=>visible(el)&&/^(Sayfayı oluştur|Create page)$/i.test((el.textContent||'').replace(/\\s+/g,' ').trim()));
    if(buttons.length!==1)return;
    return {fields:{displayName:values.displayName,username:values.username,industry:values.industry,organizationSize:values.organizationSize,organizationType:values.organizationType},details,terms:{text,url:'https://legal.linkedin.com/linkedin-pages-terms'},submitLabel:buttons[0].textContent.replace(/\\s+/g,' ').trim(),agreementChecked:checkbox[0].checked,controls};
  })()`);
  if (!form || !linkedInCreateLabel.test(form.submitLabel))
    throw new Error(
      "The exact LinkedIn Page form cannot be reviewed. Complete missing selections or unsupported fields in the platform window.",
    );
  if (
    (profile.displayName && profile.displayName !== form.fields.displayName) ||
    (profile.username && profile.username !== form.fields.username) ||
    (profile.category && profile.category !== form.fields.industry)
  )
    throw new Error("The intended Page fields changed. Prepare and review the form again.");
  return { administrator, ...form };
}

export async function submitLinkedInPageRegistration(
  page: BrowserPage,
  profile: RegistrationProfile,
  reviewed: LinkedInPageRegistrationSnapshot,
  options: { beforeAction?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<{ resourceId: string; resourceUrl: string }> {
  const verify = async (checked = reviewed.agreementChecked) => {
    const current = await reviewLinkedInPageRegistration(page, profile, {
      beforeAction: options.beforeAction,
      checked,
    });
    if (
      JSON.stringify({ ...current, agreementChecked: reviewed.agreementChecked }) !==
      JSON.stringify(reviewed)
    )
      throw new Error(
        "The approved Page form, administrator or terms changed. No further submission action is permitted.",
      );
  };
  await verify();
  if (!reviewed.agreementChecked) {
    await options.beforeAction?.();
    await page.click(`[id=${literal(linkedInTermsId)}]`);
  }
  await verify(true);
  await options.beforeAction?.();
  const marked = await registrationUntil<boolean>(
    page,
    `(() => {
    if(location.origin!=='https://www.linkedin.com'||location.pathname!=='/company/setup/new/')return false;
    const input=document.getElementById(${literal(linkedInTermsId)}),form=input?.closest('form');
    if(!input?.checked||!form)return false;
    const expected=${literal(reviewed.controls)},allowed=new Set([...expected.map(row=>row.id),${literal(linkedInTermsId)},${literal(linkedInLogoId)}]);
    if([...form.querySelectorAll('input,select,textarea')].some(el=>!allowed.has(el.id)))return false;
    if(expected.some(row=>{const controls=[...form.querySelectorAll('[id]')].filter(el=>el.id===row.id);return controls.length!==1||controls[0].value!==row.value;}))return false;
    const label=[...form.querySelectorAll('label')].find(el=>el.htmlFor===${literal(linkedInTermsId)});
    if((label?.textContent||'').replace(/\\s+/g,' ').trim()!==${literal(reviewed.terms.text)})return false;
    if(![...form.querySelectorAll('a[href]')].some(el=>el.getAttribute('href')===${literal(reviewed.terms.url)}))return false;
    if([...form.querySelectorAll('input[type="file"]')].some(el=>el.files?.length)||[...form.querySelectorAll('img')].some(el=>el.getClientRects().length&&el.getAttribute('src')))return false;
    const buttons=[...form.querySelectorAll('button')].filter(el=>el.getClientRects().length&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&(el.textContent||'').replace(/\\s+/g,' ').trim()===${literal(reviewed.submitLabel)});
    if(buttons.length!==1)return false;
    document.querySelectorAll('[data-bycoda-registration-create]').forEach(el=>el.removeAttribute('data-bycoda-registration-create'));
    buttons[0].setAttribute('data-bycoda-registration-create','true');return true;
  })()`,
  );
  if (!marked) throw new Error("The approved Create page action is not ready.");
  await options.beforeAction?.();
  await page.click('[data-bycoda-registration-create="true"]');
  const resourceId = await registrationUntil<string>(
    page,
    `(() => {
    if(location.origin!=='https://www.linkedin.com')return;
    return /^\\/company\\/([1-9]\\d*)\\/admin\\/dashboard\\/?$/.exec(location.pathname)?.[1];
  })()`,
    options.timeoutMs ?? 20_000,
  );
  await options.beforeAction?.();
  await page.goto(
    `https://www.linkedin.com/company/${resourceId}/admin/edit/?editPageActiveTab=info`,
  );
  const saved = await registrationUntil<boolean>(
    page,
    `(() => {
    if(location.origin!=='https://www.linkedin.com'||!new RegExp(${literal(`^/company/${resourceId}/admin/edit/?$`)}).test(location.pathname))return;
    const names=document.querySelectorAll('#organization-name-field'),slugs=document.querySelectorAll('#organization-public-url-field');
    if(names.length!==1||slugs.length!==1)return;
    return names[0].value===${literal(reviewed.fields.displayName)}&&slugs[0].value===${literal(reviewed.fields.username)}||undefined;
  })()`,
    options.timeoutMs ?? 20_000,
  );
  if (!saved) throw new Error("The newly created Page could not be verified.");
  const administrator = await linkedInRegistrationAdministrator(page, options.beforeAction);
  if (JSON.stringify(administrator) !== JSON.stringify(reviewed.administrator))
    throw new Error(
      "The Page administrator changed after submission; creation remains unverified.",
    );
  await options.beforeAction?.();
  return { resourceId, resourceUrl: `https://www.linkedin.com/company/${resourceId}/` };
}
