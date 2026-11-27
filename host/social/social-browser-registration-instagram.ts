/** Labels observed on Instagram's Meta Account signup in English and Turkish. */
export const INSTAGRAM_SIGNUP_PATH = "^/accounts/emailsignup/?$";
export const INSTAGRAM_SIGNUP_FIELD = "data-bycoda-instagram-registration";

const variants = [
  {
    contact: "Mobile number or email",
    name: "Full name",
    username: "Username",
    password: "Password",
    submit: "Submit",
  },
  {
    contact: "Cep telefonu numarası veya e-posta",
    name: "Tam adı",
    username: "Kullanıcı adı",
    password: "Şifre",
    submit: "Gönder",
  },
];

/** Shares the registration probe's visible controls and security checkpoints. */
export const INSTAGRAM_SIGNUP_PROBE = String.raw`
  if(location.pathname==='/accounts/suspended/'&&
    inputs.filter(el=>el.type==='tel'&&el.autocomplete==='tel'&&!el.disabled&&!el.readOnly).length===1)
    return {...empty,blockers,instagramPhoneVerification:true};
  if (!new RegExp(${JSON.stringify(INSTAGRAM_SIGNUP_PATH)}).test(location.pathname)) return {...empty,blockers};
  if (blockers.includes('challenge')) return {...empty,blockers};
  if (blockers.includes('verification'))
    return {...empty,blockers:['verification', ...blockers.filter(kind=>kind!=='verification')]};
  if (all('[role="dialog"],[role="alertdialog"]').some(visible)) return {...empty,blockers};
  const text=value=>(value||'').replace(/\s+/g,' ').trim();
  const labelled=(input,label)=>[...(input.labels||[])].some(el=>visible(el)&&text(el.textContent)===label);
  const find=(type,label)=>inputs.filter(el=>!el.disabled&&!el.readOnly&&el.type===type&&labelled(el,label));
  const matches=[];
  for(const variant of ${JSON.stringify(variants)}){
    const email=find('text',variant.contact);
    const displayName=find('text',variant.name);
    const username=find('search',variant.username).filter(el=>el.getAttribute('aria-label')===variant.username);
    const password=find('password',variant.password);
    const submit=all('button,[role="button"]').filter(el=>visible(el)&&text(el.textContent)===variant.submit);
    if([email,displayName,username,password,submit].every(list=>list.length===1))
      matches.push({email:email[0],displayName:displayName[0],username:username[0]});
  }
  if(matches.length!==1)return {...empty,blockers};
  const fields=Object.keys(matches[0]);
  if(markedField&&fields.includes(markedField)){
    all('[${INSTAGRAM_SIGNUP_FIELD}]').forEach(el=>el.removeAttribute('${INSTAGRAM_SIGNUP_FIELD}'));
    matches[0][markedField].setAttribute('${INSTAGRAM_SIGNUP_FIELD}',markedField);
  }
  return {contract:'instagram-profile',fields,blockers:[...blockers,'terms']};
`;
