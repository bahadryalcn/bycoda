import type { SocialRegistrationField } from "../../src/features/social/model/socialBrowser";

export const SNAPCHAT_SIGNUP_ORIGIN = "https://accounts.snapchat.com";
export const SNAPCHAT_SIGNUP_PATH = "^/(?:accounts|v2)/signup/?$";
export const snapchatSignupSelectors: Partial<Record<SocialRegistrationField, string>> = {
  givenName:
    'form input:is([name="firstName"],[name="first_name"],[autocomplete="given-name"])[type="text"]',
  familyName:
    'form input:is([name="lastName"],[name="last_name"],[autocomplete="family-name"])[type="text"]',
  displayName: 'form input:is([name="displayName"],[autocomplete="name"])[type="text"]',
  username: 'form input:is([name="username"],[autocomplete="username"])[type="text"]',
  email: 'form input:is([name="email"],[autocomplete="email"])[type="email"]',
  phone: 'form input:is([name="phoneNumber"],[name="phone"],[autocomplete="tel"])[type="tel"]',
  birthdate:
    'form input:is([name="birthday"],[name="birthdate"],[autocomplete="bday"])[type="date"]',
};

// shortcut: the route is public, but these form contracts use fixtures until owner-visible acceptance.
// Unknown controls, split birthdays, agreement, and phone/email mode changes are owner-assisted.
export const SNAPCHAT_SIGNUP_PROBE = String.raw`
  const headings=all('h1,h2,[role="heading"],[role="dialog"]').filter(visible)
    .map(el=>(el.textContent||'').replace(/\s+/g,' ').trim());
  if(headings.some(text=>/^(?:Unusual activity|Suspicious login|Şüpheli giriş)/i.test(text)))blockers.push('challenge');
  if(all('iframe').some(el=>visible(el)&&/turnstile/i.test(el.getAttribute('src')||''))||
    headings.some(text=>/^(?:Are you a robot\?|Robot değilim|Prove your humanity)$/i.test(text)))blockers.push('challenge');
  if(headings.some(text=>/^(?:Verify (?:your )?(?:phone|email)|We sent (?:you )?a code|Check your (?:email|phone)|Doğrulama kodu)/i.test(text)) ||
    /^\/(?:accounts|v2)\/(?:verify|two-factor|challenge)(?:[/-]|$)/i.test(location.pathname))blockers.push('verification');
  if(!new RegExp(${JSON.stringify(SNAPCHAT_SIGNUP_PATH)}).test(location.pathname) ||
    blockers.includes('challenge') || blockers.includes('verification'))return {...empty,
      blockers:['challenge','verification','password'].filter(step=>blockers.includes(step))};
  const submit=all('form button[type="submit"],form input[type="submit"]').filter(el=>visible(el)&&
    /^(?:Sign Up(?: & Accept)?|Create Account|Kaydol(?: ve Kabul Et)?)$/i.test((el.textContent||el.value||'').trim()));
  if(submit.length!==1)return {...empty,blockers};
  const form=submit[0].form;
  if(!form||form!==submit[0].closest('form'))return {...empty,blockers};
  const sameOrigin=value=>{try{const url=new URL(value||location.pathname,location.origin);return url.origin===location.origin&&!url.username&&!url.password;}catch{return false;}};
  if(!sameOrigin(form.getAttribute('action'))||!sameOrigin(submit[0].getAttribute('formaction')))return {...empty,blockers};
  if(inputs.some(el=>(el.type==='password'&&el.form!==form)||el.autocomplete==='current-password'))return {...empty,blockers:['password']};
  const fields=Object.entries(${JSON.stringify(snapchatSignupSelectors)}).filter(([field,selector])=>{
    const matching=all(selector).filter(el=>visible(el)&&!el.matches(':disabled,[readonly],[aria-disabled="true"]')&&!el.closest('[hidden],[aria-hidden="true"]'));
    return matching.length===1 && matching[0].form===form &&
      (field!==markedField||matching[0].getAttribute('data-bycoda-registration-field')===field);
  }).map(([field])=>field);
  return {contract:'snapchat-signup',fields,blockers:[...blockers,'terms']};
`;
