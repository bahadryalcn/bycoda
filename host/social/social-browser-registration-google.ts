import type { BrowserPage } from "./social-browser";

/**
 * Google account creation for a YouTube signup. Observed live on 2026-11-15 (tr-TR, signed out):
 * channel_switcher redirects to /v3/signin/identifier; the signup flow is
 * /lifecycle/steps/signup/name → birthdaygender → emailsignup (or username, the Gmail choice) →
 * password and verification. Only the owner's name, birth date and existing email are filled;
 * every Next, gender, Gmail address, password, phone and code step stays in the window.
 */
export const GOOGLE_ORIGIN = "https://accounts.google.com";
export const GOOGLE_SIGNUP_URL =
  "https://accounts.google.com/signup/v2/createaccount?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fchannel_switcher&flowName=GlifWebSignIn&flowEntry=SignUp";
export const GOOGLE_FIELD_PATH = "^/lifecycle/steps/signup/(?:name|emailsignup)$";
const BIRTHDAY_PATH = "/lifecycle/steps/signup/birthdaygender";
export const googleSelectors = {
  givenName: 'input[name="firstName"]',
  familyName: 'input[name="lastName"]',
  email: 'input[type="email"][name="Username"]',
} as const;
const MONTH_LABELS = ["Ay", "Month"];

/** The month control is a custom combobox labelled by a sibling; its options carry data-value 1–12. */
const monthHelpers = String.raw`
    const monthLabels=${JSON.stringify(MONTH_LABELS)};
    const shown=el=>!!el&&!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
    const monthCombos=()=>[...document.querySelectorAll('[role="combobox"]')].filter(el=>shown(el)&&(el.getAttribute('aria-labelledby')||'').split(/\s+/).some(id=>monthLabels.includes((document.getElementById(id)?.textContent||'').trim())));
    const monthLists=()=>[...document.querySelectorAll('[role="listbox"]')].filter(el=>monthLabels.includes((el.getAttribute('aria-label')||'').trim())&&el.querySelectorAll('[role="option"]').length===12);`;

/** Probe body for Google pages; `visible`, `blockers` and `empty` come from the caller's scope. */
export const GOOGLE_PROBE = String.raw`
      const path=location.pathname;
      const one=selector=>{const found=[...document.querySelectorAll(selector)].filter(visible);return found.length===1&&!found[0].disabled&&!found[0].readOnly?found[0]:undefined;};
      ${monthHelpers}
      if(/^\/(?:v3\/signin|signin\/v2)\/identifier$/.test(path)&&one('input#identifierId[name="identifier"]')&&!blockers.length)
        return {contract:'google-signin',fields:[],blockers,navigation:'google-signup',google:'signin'};
      if(path==='/lifecycle/steps/signup/name'&&one(${JSON.stringify(googleSelectors.givenName)})&&one(${JSON.stringify(googleSelectors.familyName)}))
        return {contract:'google-name',fields:['givenName','familyName'],blockers,google:'signup'};
      if(path===${JSON.stringify(BIRTHDAY_PATH)}&&one('input#day[name="day"]')&&one('input#year[name="year"]')&&monthCombos().length===1&&monthLists().length===1)
        return {contract:'google-birthdate',fields:['birthdate'],blockers,google:'signup'};
      if(path==='/lifecycle/steps/signup/emailsignup'&&one(${JSON.stringify(googleSelectors.email)}))
        return {contract:'google-email',fields:['email'],blockers,google:'signup'};
      return {...empty,blockers,google:path.startsWith('/lifecycle/steps/signup/')?'signup':'signin'};`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Day and year inputs plus the month combobox; an owner value is never overwritten. */
export async function fillGoogleBirthdate(
  page: BrowserPage,
  birthdate: string,
  beforeAction?: () => Promise<void>,
): Promise<boolean> {
  const [year, month, day] = birthdate.split("-");
  const on = `location.origin===${JSON.stringify(GOOGLE_ORIGIN)}&&location.pathname===${JSON.stringify(BIRTHDAY_PATH)}`;
  for (const [id, wanted] of [
    ["day", String(Number(day))],
    ["year", year],
  ] as const) {
    await beforeAction?.();
    const state = await page.evaluate<"empty" | "same" | undefined>(String.raw`(() => {
      if(!(${on}))return;
      const input=document.querySelector('input#${id}[name="${id}"]');
      if(!input||input.hidden||!input.getClientRects().length||input.disabled||input.readOnly)return;
      if(input.value&&input.value!==${JSON.stringify(wanted)})return;
      input.setAttribute('data-bycoda-registration-field','${id}');
      return input.value?'same':'empty';
    })()`);
    if (!state) return false;
    if (state === "empty") await page.fill(`[data-bycoda-registration-field="${id}"]`, wanted);
    const kept = await page.evaluate<boolean>(
      `(${on})&&document.querySelector('[data-bycoda-registration-field="${id}"]')?.value===${JSON.stringify(wanted)}`,
    );
    if (!kept) return false;
  }
  const wantedMonth = String(Number(month));
  const monthState = String.raw`(() => {
    if(!(${on}))return;
    ${monthHelpers}
    const combos=monthCombos(),lists=monthLists();
    if(combos.length!==1||lists.length!==1)return;
    const selected=[...lists[0].querySelectorAll('[role="option"][aria-selected="true"]')].map(el=>el.getAttribute('data-value'));
    if(selected.length>1||(selected.length===1&&selected[0]!==${JSON.stringify(wantedMonth)}))return;
    combos[0].setAttribute('data-bycoda-registration-date','month');
    return {same:selected.length===1,open:shown(lists[0])};
  })()`;
  await beforeAction?.();
  const state = await page.evaluate<{ same: boolean; open: boolean } | undefined>(monthState);
  if (!state) return false;
  if (state.same) return true;
  if (!state.open) await page.click('[data-bycoda-registration-date="month"]');
  let marked = false;
  for (let attempt = 0; attempt < 20 && !marked; attempt++) {
    marked = await page.evaluate<boolean>(String.raw`(() => {
      if(!(${on}))return false;
      ${monthHelpers}
      const lists=monthLists().filter(shown);
      if(lists.length!==1)return false;
      const options=[...lists[0].querySelectorAll('[role="option"]')].filter(el=>shown(el)&&el.getAttribute('data-value')===${JSON.stringify(wantedMonth)});
      if(options.length!==1)return false;
      document.querySelectorAll('[data-bycoda-registration-date-option]').forEach(el=>el.removeAttribute('data-bycoda-registration-date-option'));
      options[0].setAttribute('data-bycoda-registration-date-option','true');return true;
    })()`);
    if (!marked) await sleep(100);
  }
  if (!marked) return false;
  await beforeAction?.();
  await page.click('[data-bycoda-registration-date-option="true"]');
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = await page.evaluate<{ same: boolean } | undefined>(monthState);
    if (after?.same) return true;
    if (!after) return false;
    await sleep(100);
  }
  return false;
}
