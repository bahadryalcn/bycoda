import type { BrowserPage } from "./social-browser";
import type { BrowserIdentity, BrowserRecipeContext } from "./social-browser-recipe";

/** Public Profile Manager's current snapPosterForm and SDS control hooks. */
export const snapchatUploaderSelectors = {
  fileInput: '[data-testid="app.profileManager.snapPoster.uploadCard"] input[type="file"]',
  submit: '[data-testid="app.profileMgr.snapPoster.postSnap"]',
  spotlightDescription: 'textarea[maxlength="160"]',
} as const;

export type SnapchatPublishDestination = "spotlight" | "story";
export type SnapchatDestinationSelection = {
  target: SnapchatPublishDestination;
  profileId: string;
  name: string;
};

const identityPrefix = "web:snapchat:public_profile:";
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const literal = (value: unknown) => JSON.stringify(value);
const unsupported = () =>
  new Error("Snapchat Public Profile uploader controls could not be verified.");
const mismatch = () =>
  new Error("The selected Snapchat Public Profile or publishing destination changed.");

const originGuard = String.raw`
  if (!['https://my.snapchat.com','https://profile.snapchat.com'].includes(location.origin)) return;
  if (!document.querySelector('[data-testid="app.profileManager.snapPoster.uploadCard"] input[type="file"]')) return;
  const visible = el => !!el && !!el.getClientRects().length;
`;

/**
 * The platform picker supplies a stable Profile UUID, while its trigger renders
 * only displayName. A unique option-to-trigger match proves that mapping; an
 * account label, generic signed-in username or first available profile cannot.
 */
export async function readSnapchatPublicProfileIdentity(
  page: BrowserPage,
): Promise<BrowserIdentity | undefined> {
  const ready = await page.evaluate<
    { name: string; expanded: boolean } | undefined
  >(String.raw`(() => {
    ${originGuard}
    const pickers=[...document.querySelectorAll('[data-testid="profile-selection-dropdown"]')].filter(visible);
    if(pickers.length!==1)return;
    const controls=[...pickers[0].querySelectorAll('button[aria-expanded]')].filter(visible);
    if(controls.length!==1 || controls[0].disabled)return;
    const name=(controls[0].textContent||'').trim();if(!name||name.length>200)return;
    controls[0].setAttribute('data-bycoda-snap-profile-picker','true');
    return {name,expanded:controls[0].getAttribute('aria-expanded')==='true'};
  })()`);
  if (!ready) return;
  const selector = '[data-bycoda-snap-profile-picker="true"]';
  if (!ready.expanded) await page.click(selector);
  try {
    const selected = await page.evaluate<
      { id: string; name: string } | undefined
    >(String.raw`(() => {
      ${originGuard}
      const trigger=document.querySelector('[data-bycoda-snap-profile-picker="true"]');
      if(!trigger || trigger.getAttribute('aria-expanded')!=='true'||(trigger.textContent||'').trim()!==${literal(ready.name)})return;
      const options=[...document.querySelectorAll('[data-testid^="profile-selection-dropdown-option-"]')].filter(el=>visible(el)&&el.matches('div[data-testid]'));
      const rows=options.map(el=>({id:el.getAttribute('data-testid').slice('profile-selection-dropdown-option-'.length),name:(el.textContent||'').trim()}))
        .filter(row=>/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(row.id));
      const matching=rows.filter(row=>row.name===${literal(ready.name)});
      return matching.length===1?matching[0]:undefined;
    })()`);
    if (!selected || !uuid.test(selected.id)) return;
    return {
      platformId: identityPrefix + selected.id.toLowerCase(),
      name: selected.name,
      accountType: "public_profile",
    };
  } finally {
    // Preserve a picker the owner had already opened; close only our own read.
    if (!ready.expanded) await page.click(selector).catch(() => undefined);
  }
}

function destinationControlsExpression(target: SnapchatPublishDestination): string {
  const key = target === "story" ? "publicStory" : "spotlight";
  return String.raw`(() => {
    ${originGuard}
    const ids=['spotlight','publicStory','publicProfile'];
    const controls=ids.map(id=>document.getElementById(id));
    if(controls.some(el=>!visible(el)||!el.matches('input[type="checkbox"]')||el.disabled))return;
    if(controls.some(el=>document.querySelectorAll('[id="'+el.id+'"]').length!==1))return;
    controls.forEach(el=>el.setAttribute('data-bycoda-snap-destination',el.id));
    return controls.map(el=>({id:el.id,checked:el.checked,wanted:el.id===${literal(key)}}));
  })()`;
}

function profileControlsExpression(selection: SnapchatDestinationSelection, mark: boolean): string {
  const key = selection.target === "story" ? "publicStory" : "spotlight";
  return String.raw`(() => {
    ${originGuard}
    const ids=['spotlight','publicStory','publicProfile'];
    if(!ids.every(id=>{const el=document.getElementById(id);return visible(el)&&el.matches('input[type="checkbox"]')&&el.checked===(id===${literal(key)});}))return;
    const checkbox=document.getElementById(${literal(key)});
    let section=checkbox.parentElement,select;
    while(section && !section.matches('form,body')){
      const checkboxes=[...section.querySelectorAll('input[type="checkbox"]')].filter(el=>ids.includes(el.id));
      const candidates=[...section.querySelectorAll('.sds-dropdown-input-multiple')].filter(visible);
      if(checkboxes.length===1 && candidates.length===1){select=candidates[0];break;}
      section=section.parentElement;
    }
    if(!select || select.classList.contains('sds-dropdown-input-disabled'))return;
    if(${selection.target === "story"}){
      const durations=[...section.querySelectorAll('.sds-dropdown-input-selection-item')].filter(el=>visible(el)&&!el.closest('.sds-dropdown-input-multiple'));
      if(durations.length!==1||!['24 hours','24 saat'].includes((durations[0].textContent||'').trim()))return;
    }
    const items=[...select.querySelectorAll('.sds-dropdown-input-selection-item')].filter(visible);
    const names=items.map(el=>(el.querySelector('.sds-dropdown-input-selection-item-content')?.textContent||'').trim());
    if(names.some(name=>!name)||names.length>1||names.some(name=>name!==${literal(selection.name)}))return;
    const selector=select.querySelector('.sds-dropdown-input-selector');if(!visible(selector))return;
    if(${mark})selector.setAttribute('data-bycoda-snap-destination-profiles','true');
    return {selected:names.length===1};
  })()`;
}

/** Select one reviewed destination and one exact profile; never accept creator terms. */
export async function selectSnapchatPublishDestination(
  ctx: BrowserRecipeContext,
  target: SnapchatPublishDestination,
): Promise<SnapchatDestinationSelection> {
  if (target !== "spotlight" && target !== "story") throw unsupported();
  if (ctx.account.accountType !== "public_profile") throw mismatch();
  const profileId = ctx.account.platformId.startsWith(identityPrefix)
    ? ctx.account.platformId.slice(identityPrefix.length)
    : "";
  if (!uuid.test(profileId)) throw mismatch();
  await ctx.verifyIdentity();
  const identity = await readSnapchatPublicProfileIdentity(ctx.page);
  if (identity?.platformId !== ctx.account.platformId) throw mismatch();
  const selection: SnapchatDestinationSelection = { target, profileId, name: identity.name };
  const controls = await ctx.page.evaluate<
    { id: string; checked: boolean; wanted: boolean }[] | undefined
  >(destinationControlsExpression(target));
  if (!controls) throw unsupported();
  // The current uploader automatically enables Saved Story after upload. That
  // would be a second publication, so explicitly clear every unreviewed target.
  for (const control of controls.filter((item) => item.checked && !item.wanted))
    await ctx.page.click(`[data-bycoda-snap-destination="${control.id}"]`);
  for (const control of controls.filter((item) => !item.checked && item.wanted))
    await ctx.page.click(`[data-bycoda-snap-destination="${control.id}"]`);
  const profiles = await ctx.page.evaluate<{ selected: boolean } | undefined>(
    profileControlsExpression(selection, true),
  );
  if (!profiles) throw mismatch();
  if (!profiles.selected) {
    await ctx.page.click('[data-bycoda-snap-destination-profiles="true"]');
    const option = await ctx.page.evaluate<boolean>(String.raw`(() => {
      ${originGuard}
      const items=[...document.querySelectorAll('.sds-dropdown-input-item-option')].filter(visible);
      const matching=items.filter(el=>(el.querySelector('.sds-dropdown-input-item-option-content')?.textContent||'').trim()===${literal(selection.name)});
      if(matching.length!==1 || matching[0].classList.contains('sds-dropdown-input-item-option-disabled'))return false;
      matching[0].setAttribute('data-bycoda-snap-profile-option','true');return true;
    })()`);
    if (!option) throw mismatch();
    await ctx.page.click('[data-bycoda-snap-profile-option="true"]');
    // rc-select multiple menus remain open after selection. Re-reading identity
    // and selecting the same profile must not leave an overlay over Post.
    await ctx.page.click('[data-bycoda-snap-destination-profiles="true"]');
  }
  await verifySnapchatPublishDestination(ctx, selection);
  return selection;
}

/** Re-run immediately before the final external click, after filling other fields. */
export async function verifySnapchatPublishDestination(
  ctx: BrowserRecipeContext,
  selection: SnapchatDestinationSelection,
): Promise<void> {
  if (
    (selection.target !== "story" && selection.target !== "spotlight") ||
    !uuid.test(selection.profileId) ||
    identityPrefix + selection.profileId.toLowerCase() !== ctx.account.platformId
  )
    throw mismatch();
  await ctx.verifyIdentity();
  const identity = await readSnapchatPublicProfileIdentity(ctx.page);
  if (identity?.platformId !== ctx.account.platformId || identity.name !== selection.name)
    throw mismatch();
  const profiles = await ctx.page.evaluate<{ selected: boolean } | undefined>(
    profileControlsExpression(selection, false),
  );
  if (!profiles?.selected) throw mismatch();
}

/**
 * Current PostProfileMedia returns EmptyResponse even on acceptance. This is
 * deliberately not a SocialSendResult: it contains no durable published Snap ID.
 * Keep a submitted job unknown unless a separate exact persisted read proves it.
 */
export function snapchatPostingAcknowledgement(
  body: string,
): "acceptedWithoutId" | "rejected" | undefined {
  if (body.length > 2_000_000) return;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const response = value as {
    errors?: unknown;
    data?: { postProfileMedia?: { __typename?: unknown } };
  };
  if (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length))
    return "rejected";
  const result = response.data?.postProfileMedia;
  if (result?.__typename === "FailedPostProfileMediaOutput") return "rejected";
  if (result?.__typename === "EmptyResponse") return "acceptedWithoutId";
}
