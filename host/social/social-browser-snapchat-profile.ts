import type { SocialAccount } from "../../src/features/social/model/social";
import type {
  SnapchatMonetizationStatus,
  SnapchatProfilePatch,
  SnapchatProfileState,
} from "../../src/integrations/social/snapchat-profile";
import { needsHumanError } from "./browser/challenge";
import type { BrowserPage } from "./social-browser";
import { denied, json, unknown, unsupported } from "./social-browser-publishing-shared";
import { snapchatProtectedScreen } from "./social-browser-snapchat-guard";
import {
  SNAPCHAT_MONETIZATION_PROBE,
  UNKNOWN_SNAPCHAT_MONETIZATION,
} from "./social-browser-snapchat-monetization";

export const SNAPCHAT_PROFILE_MANAGER = "https://my.snapchat.com";
const profilePrefix = "web:snapchat:public_profile:";
const memberPrefix = "web:snapchat:";
const assetId = /^[\w.-]{8,160}$/;
const profileUuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
type EditableField = "name" | "bio" | "website" | "category";
type Until = <T>(expression: string, timeout: number) => Promise<T | undefined>;

const profileFields = {
  name: 'input[name="displayName"][type="text"],input[name="name"][type="text"],input[aria-label="Public Profile name"][type="text"]',
  bio: 'textarea[name="bio"],textarea[aria-label="Bio"]',
  website: 'input:is([name="website"],[name="websiteUrl"],[aria-label="Website"])[type="url"]',
  category: 'select[name="category"],select[aria-label="Category"]',
} as const;

export function parseSnapchatProfilePatch(raw: unknown): SnapchatProfilePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw denied();
  const patch: SnapchatProfilePatch = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || /[\0\r]/.test(value)) throw denied();
    const text = value.trim();
    if (key === "name" && text.length > 0 && text.length <= 100) patch.name = text;
    else if (key === "bio" && text.length <= 500) patch.bio = text;
    else if (key === "website" && text.length <= 2048) {
      const url = text ? URL.parse(text) : undefined;
      if (text && (!url || url.protocol !== "https:" || url.username || url.password))
        throw denied();
      patch.website = url?.href ?? "";
    } else if (key === "category" && text.length <= 100) patch.category = text;
    else if (key === "avatarUploadId" && /^[a-f\d-]{36}$/i.test(text)) patch.avatarUploadId = text;
    else throw denied();
  }
  if (!Object.keys(patch).length) throw denied();
  return patch;
}

/** Identity is pinned to a single rendered management scope on Snap's origins. */
export class SnapchatProfileActions {
  constructor(
    private readonly page: BrowserPage,
    private readonly account: Pick<SocialAccount, "accountType" | "platformId">,
    private readonly authorize: () => Promise<void>,
    private readonly until: Until,
    private readonly beforeMutation: () => Promise<void>,
  ) {}

  // shortcut: management hooks are fixture-tested, re-check on the first owner-visible run.
  private expression(body: string, pinnedProfileId?: string | null) {
    return String.raw`(() => {
      if(!['https://my.snapchat.com','https://profile.snapchat.com'].includes(location.origin))return;
      const visible=el=>!!el&&!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
      const only=(scope,selector)=>{const matches=[...scope.querySelectorAll(selector)].filter(visible);return matches.length===1?matches[0]:undefined;};
      const root=only(document,'[data-testid="public-profile-manager"],main[aria-label="Public Profile Manager"]');
      if(!root)return;
      const profileId=root.getAttribute('data-profile-id')||undefined;
      const owner=root.getAttribute('data-owner-username')?.toLowerCase();
      const username=root.getAttribute('data-profile-username')?.toLowerCase();
      const member=${json(this.account.accountType === "member")};
      const expected=${json(this.account.platformId.slice((this.account.accountType === "member" ? memberPrefix : profilePrefix).length))};
      const namespace=${json(this.account.platformId.startsWith(this.account.accountType === "member" ? memberPrefix : profilePrefix))};
      const pinned=${pinnedProfileId === undefined ? "undefined" : json(pinnedProfileId)};
      if(!namespace||(pinned!==undefined&&(profileId??null)!==pinned)||(member ? !owner||owner!==expected :
        (new RegExp(${json(profileUuid.source)},'i').test(expected) ? profileId?.toLowerCase()!==expected :
         !/^[a-z][\w.-]{1,30}$/.test(expected)||username!==expected)))return;
      const editor=only(root,'form[data-testid="public-profile-form"],form[aria-label="Edit Public Profile"],form[aria-label="Create Public Profile"]');
      const text=el=>(el?.textContent||'').trim();
      const label=el=>(el.getAttribute('aria-label')||text(el)||(el.type==='submit'?el.value:'')||'').trim();
      const editable=el=>!!el&&!el.matches(':disabled,[readonly],[aria-disabled="true"]');
      const link=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url:undefined;}catch{return;}};
      const agreement=editor&&([...editor.querySelectorAll('input[type="checkbox"]')].some(el=>visible(el)&&!el.checked)||
        [...editor.querySelectorAll('a[href]')].some(el=>visible(el)&&/terms|agreement|koşullar|sözleşme/i.test(text(el))));
      const sameOrigin=value=>{try{const url=new URL(value||location.pathname,location.origin);return url.origin===location.origin&&!url.username&&!url.password;}catch{return false;}};
      ${body}
    })()`;
  }

  private async guard(): Promise<void> {
    await this.authorize();
    const hit = await snapchatProtectedScreen(this.page);
    if (hit) throw needsHumanError(hit);
  }

  private async open(): Promise<void> {
    await this.authorize();
    await this.page.goto(SNAPCHAT_PROFILE_MANAGER);
    await this.guard();
  }

  private async state(): Promise<SnapchatProfileState | undefined> {
    return await this.until<SnapchatProfileState>(
      this.expression(String.raw`
      const hasPublicProfile=!!(profileId&&/^[\w.-]{2,160}$/.test(profileId));
      const empty=only(root,'[data-testid="no-public-profile"]');
      if(!hasPublicProfile&&(profileId||!member||!empty))return;
      if(hasPublicProfile&&empty)return;
      if(!hasPublicProfile)return {hasPublicProfile:false};
      const metadata={};
      for(const field of ${json(Object.keys(profileFields))}) {
        const shown=only(root,'[data-testid="profile-'+field+'"]');
        const value=shown&&!editor?.contains(shown)?text(shown):undefined;
        if(typeof value!=='string'||value.length>2048)continue;
        if(field==='website')metadata[field]=value?link(value)?.href: '';
        else metadata[field]=value.trim();
      }
      const image=only(root,'img[data-testid="profile-avatar"],img[aria-label="Public Profile photo"]');
      const avatar=image&&!editor?.contains(image)&&link(image.getAttribute('src'));
      if(avatar&&/(^|\.)(snapchat\.com|sc-cdn\.net|snap-dev\.net)$/.test(avatar.hostname))metadata.avatarUrl=avatar.origin+avatar.pathname;
      return {hasPublicProfile,profileId:hasPublicProfile?profileId:undefined,...metadata};
    `),
      8_000,
    );
  }

  async read(): Promise<SnapchatProfileState> {
    await this.open();
    const state = await this.state();
    await this.guard();
    if (!state) throw unsupported();
    return state;
  }

  async monetization(): Promise<SnapchatMonetizationStatus> {
    await this.open();
    const selected = await this.state();
    if (!selected?.profileId) {
      await this.guard();
      return UNKNOWN_SNAPCHAT_MONETIZATION;
    }
    await this.guard();
    const tab = await this.page.evaluate<boolean>(
      this.expression(
        `
      const buttons=[...root.querySelectorAll('button[type="button"],[role="tab"]:not(button)')]
        .filter(el=>visible(el)&&editable(el)&&['Insights','İstatistikler'].includes(label(el)));
      if(buttons.length!==1||buttons[0].getAttribute('aria-selected')==='true')return false;
      document.querySelectorAll('[data-bycoda-snap-insights]').forEach(el=>el.removeAttribute('data-bycoda-snap-insights'));
      buttons[0].setAttribute('data-bycoda-snap-insights','true');return true;
    `,
        selected.profileId,
      ),
    );
    if (tab) await this.page.click('[data-bycoda-snap-insights="true"]');
    const status = await this.page.evaluate<SnapchatMonetizationStatus | undefined>(
      this.expression(SNAPCHAT_MONETIZATION_PROBE, selected.profileId),
    );
    await this.guard();
    return status ?? UNKNOWN_SNAPCHAT_MONETIZATION;
  }

  private async mark(
    pinnedProfileId: string | null,
    scope: "root" | "editor",
    selector: string,
    labels: readonly string[] = [],
  ) {
    await this.guard();
    const found = await this.page.evaluate<"found" | "agreement" | undefined>(
      this.expression(
        `
      if(agreement)return 'agreement';
      const scope=${scope};if(!scope)return false;
      if(scope===editor&&!sameOrigin(editor.getAttribute('action')))return;
      const labels=${json(labels)};
      const options=[...scope.querySelectorAll(${json(selector)})].filter(el=>visible(el)&&editable(el)&&(!labels.length||labels.includes(label(el))));
      if(options.length!==1)return false;
      if(scope===editor&&'form' in options[0]&&options[0].form!==editor)return;
      if(options[0].hasAttribute('formaction')&&!sameOrigin(options[0].getAttribute('formaction')))return;
      document.querySelectorAll('[data-bycoda-snap-profile-control]').forEach(el=>el.removeAttribute('data-bycoda-snap-profile-control'));
      options[0].setAttribute('data-bycoda-snap-profile-control','true');return 'found';
    `,
        pinnedProfileId,
      ),
    );
    if (found === "agreement")
      throw needsHumanError({ kind: "verification", url: SNAPCHAT_PROFILE_MANAGER });
    if (found !== "found") throw unsupported();
    return '[data-bycoda-snap-profile-control="true"]';
  }

  private async ensureEditor(pinnedProfileId: string | null) {
    const create = pinnedProfileId === null;
    const isEditor = this.expression("return !!editor;", pinnedProfileId);
    if (await this.page.evaluate<boolean>(isEditor)) return;
    const button = await this.mark(
      pinnedProfileId,
      "root",
      'button[type="button"],button:not([type]):not(form button)',
      create
        ? ["Add Public Profile", "Create Public Profile", "Herkese Açık Profil Oluştur"]
        : ["Edit Public Profile", "Herkese Açık Profili Düzenle"],
    );
    await this.page.click(button);
    if (!(await this.until<boolean>(isEditor, 12_000))) {
      await this.guard();
      throw unsupported();
    }
  }

  private async fill(
    pinnedProfileId: string | null,
    field: EditableField,
    value: string,
  ): Promise<void> {
    const target = await this.mark(pinnedProfileId, "editor", profileFields[field]);
    if (field !== "category") {
      await this.page.fill(target, value);
      if (
        await this.page.evaluate<boolean>(
          this.expression(
            `return editor&&only(editor,${json(target)})?.value===${json(value)};`,
            pinnedProfileId,
          ),
        )
      )
        return;
    } else {
      const selected = await this.page.evaluate<boolean>(
        this.expression(
          `
        const select=only(editor,${json(target)});if(!editable(select))return false;
        const matching=[...select.options].filter(el=>!el.disabled&&!el.closest('optgroup[disabled]')&&text(el)===${json(value)});
        if(matching.length!==1)return false;
        select.value=matching[0].value;
        select.dispatchEvent(new Event('input',{bubbles:true}));
        select.dispatchEvent(new Event('change',{bubbles:true}));
        return select.selectedOptions.length===1&&text(select.selectedOptions[0])===${json(value)};
      `,
          pinnedProfileId,
        ),
      );
      if (selected) return;
    }
    throw denied();
  }

  private async save(patch: SnapchatProfilePatch, baseline: SnapchatProfileState, avatar?: string) {
    const create = !baseline.hasPublicProfile;
    const pinnedProfileId = baseline.profileId ?? null;
    await this.ensureEditor(pinnedProfileId);
    const fields = Object.keys(profileFields) as EditableField[];
    for (const field of fields) {
      const value = patch[field];
      if (value !== undefined && value !== baseline[field])
        await this.fill(pinnedProfileId, field, value);
    }
    const file = avatar
      ? await this.mark(pinnedProfileId, "editor", 'input[type="file"][accept*="image"]')
      : undefined;
    let attempted = false;
    try {
      if (file && avatar) {
        await this.beforeMutation();
        await this.mark(pinnedProfileId, "editor", 'input[type="file"][accept*="image"]');
        attempted = true;
        await this.page.setFiles(file, [avatar]);
      }
      const submit = await this.mark(
        pinnedProfileId,
        "editor",
        'button[type="submit"],input[type="submit"]',
        create
          ? ["Create Public Profile", "Herkese Açık Profil Oluştur"]
          : ["Save", "Save Changes", "Kaydet"],
      );
      const staged = this.expression(
        `
        const button=editor&&only(editor,${json(submit)});
        if(!editable(button)||agreement||button.form!==editor||!sameOrigin(editor.getAttribute('action'))||
          !sameOrigin(button.getAttribute('formaction')))return false;
        const selectors=${json(profileFields)};
        return Object.entries(${json(patch)}).every(([field,value])=>{
          if(field==='avatarUploadId')return true;
          const input=only(editor,selectors[field]);
          return input&&((field==='category'?text(input.selectedOptions[0]):input.value)===value);
        });
      `,
        pinnedProfileId,
      );
      if (!(await this.page.evaluate<boolean>(staged))) throw denied();
      if (!attempted) {
        await this.beforeMutation();
        await this.guard();
        if (!(await this.page.evaluate<boolean>(staged))) throw denied();
      }
      attempted = true;
      await this.page.click(submit);
      await this.open();
      const observed = await this.state();
      await this.guard();
      if (
        !observed?.hasPublicProfile ||
        (baseline.profileId && observed.profileId !== baseline.profileId) ||
        fields.some((field) => patch[field] !== undefined && patch[field] !== observed[field]) ||
        (avatar && (!observed.avatarUrl || baseline.avatarUrl === observed.avatarUrl))
      )
        throw unknown();
      return observed;
    } catch (error) {
      if (attempted) throw unknown();
      throw error;
    }
  }

  async update(patch: SnapchatProfilePatch, avatar?: string): Promise<SnapchatProfileState> {
    const baseline = await this.read();
    if (!baseline.hasPublicProfile) throw denied();
    if (
      !avatar &&
      Object.entries(patch).every(([field, value]) => baseline[field as EditableField] === value)
    )
      return baseline;
    return this.save(patch, baseline, avatar);
  }

  async create(patch: SnapchatProfilePatch, avatar?: string): Promise<SnapchatProfileState> {
    if (this.account.accountType !== "member" || !patch.name) throw denied();
    const baseline = await this.read();
    if (baseline.hasPublicProfile) throw denied();
    return this.save(patch, baseline, avatar);
  }

  async deleteStory(storyId: string): Promise<{ storyId: string; deleted: true }> {
    if (this.account.accountType !== "public_profile" || !assetId.test(storyId)) throw denied();
    const { profileId } = await this.read();
    if (!profileId) throw denied();
    await this.guard();
    const row = this.expression(
      `
      const listing=only(root,'[data-testid="public-story-list"],[aria-label="Public Stories"]');if(!listing)return;
      const id=${json(storyId)};
      const rows=[...listing.querySelectorAll('[data-public-story-id]')].filter(el=>visible(el)&&el.getAttribute('data-public-story-id')===id);
      if(rows.length!==1)return rows.length===0&&listing.getAttribute('aria-busy')==='false'&&listing.getAttribute('data-complete')==='true'?'absent':undefined;
      const button=only(rows[0],'button[data-testid="delete-public-story"][aria-haspopup="dialog"],button[aria-label="Delete Public Story"][aria-haspopup="dialog"]');
      if(!editable(button))return;
      if(button.form&&button.type!=='button')return;
      document.querySelectorAll('[data-bycoda-snap-story-action]').forEach(el=>el.removeAttribute('data-bycoda-snap-story-action'));
      button.setAttribute('data-bycoda-snap-story-action',id);return 'present';
    `,
      profileId,
    );
    if ((await this.page.evaluate<string>(row)) !== "present") throw unsupported();
    const target = `[data-bycoda-snap-story-action=${json(storyId)}]`;
    await this.page.click(target);
    await this.guard();
    const confirmation = this.expression(
      `
      const dialog=only(root,'[role="dialog"][data-public-story-id]');
      if(dialog?.getAttribute('data-public-story-id')!==${json(storyId)})return false;
      const button=only(dialog,'button[data-testid="confirm-delete-public-story"],button[aria-label="Delete Public Story"]');
      if(!editable(button)||button.form)return false;
      document.querySelectorAll('[data-bycoda-snap-story-confirm]').forEach(el=>el.removeAttribute('data-bycoda-snap-story-confirm'));
      button.setAttribute('data-bycoda-snap-story-confirm',${json(storyId)});return true;
    `,
      profileId,
    );
    if (!(await this.page.evaluate<boolean>(confirmation))) throw unsupported();
    await this.beforeMutation();
    await this.guard();
    if (!(await this.page.evaluate<boolean>(confirmation))) throw denied();
    try {
      await this.page.click(`[data-bycoda-snap-story-confirm=${json(storyId)}]`);
      await this.open();
      if ((await this.page.evaluate<string>(row)) !== "absent") throw unknown();
      await this.guard();
      return { storyId, deleted: true };
    } catch {
      throw unknown();
    }
  }
}
