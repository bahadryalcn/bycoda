import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function canonicalControlOrigin(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Web control origin must be an explicit HTTP(S) origin");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback)
    throw new Error(
      "Remote web control requires HTTPS; use a trusted Tailscale/reverse-proxy HTTPS origin",
    );
  return url.origin;
}

/** The existing bearer-authenticated RPC switch remains the only dispatcher.
 * Never infer authority from an attacker-controlled Host or Forwarded header. */
export class WebControl {
  readonly origin: string;
  constructor(origin: string) {
    this.origin = canonicalControlOrigin(origin);
  }
  acceptsRpc(request: IncomingMessage) {
    return (
      request.url === "/control/rpc" &&
      request.method === "POST" &&
      request.headers.origin === this.origin &&
      request.headers.host === new URL(this.origin).host &&
      request.headers["sec-fetch-site"] !== "cross-site" &&
      request.headers["content-type"]?.split(";")[0].trim() === "application/json"
    );
  }
  handle(request: IncomingMessage, response: ServerResponse) {
    if (request.url !== "/control" && request.url !== "/control/") return false;
    if (request.method !== "GET" || request.headers.host !== new URL(this.origin).host) {
      response.writeHead(403).end("Unsupported web control origin");
      return true;
    }
    const nonce = randomBytes(18).toString("base64");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    response.end(controlPage(nonce));
    return true;
  }
}

function controlPage(nonce: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>bycoda host control</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#14171c;color:#eef0f4;font:16px system-ui}main{max-width:1100px;margin:auto;padding:20px}h1{font-size:24px}input,select,textarea,button{font:inherit;background:#222833;color:inherit;border:1px solid #4a5669;border-radius:7px;padding:10px}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}input,textarea{max-width:100%}textarea{width:100%;min-height:100px}nav,.row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}section{border:1px solid #39414f;border-radius:10px;padding:16px;margin:14px 0}#transcript{max-height:50vh;overflow:auto}.block{border-bottom:1px solid #39414f;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere}#error{color:#ffb4a8;white-space:pre-wrap}#frame{max-width:100%;cursor:crosshair}label{display:block;margin:8px 0}small{color:#b6c0d0}select{max-width:100%}[hidden]{display:none!important}@media(max-width:600px){main{padding:10px}.row>*{flex:1 1 140px}section{padding:10px}}</style>
<main><h1>bycoda host control</h1><p id="error" role="status" aria-live="polite"></p>
<section id="login"><label>Paired device credential <input id="credential" type="password" autocomplete="off" spellcheck="false" size="44"></label><button id="connect">Connect</button><p><small>Use a device credential from the host pairing workflow. It stays only in this page's memory. Remote access requires HTTPS.</small></p></section>
<div id="workspace" hidden><nav><button id="logout">Disconnect</button><button id="refresh">Refresh</button><button id="recover" hidden>Check uncertain command</button></nav>
<section><label>Project <select id="project"></select></label><label>Session <select id="sessions"></select></label><div class="row"><label>Provider <select id="provider"></select></label><label>Model <select id="model"></select></label><button id="start">New session</button></div></section>
<section><p id="status"></p><div id="transcript"></div><div id="questions"></div><label>Message<textarea id="prompt" maxlength="256000"></textarea></label><div class="row"><button id="send">Send</button><button id="stop">Stop current turn</button><button id="older">Earlier messages</button></div></section>
<section><h2>Shared host browser</h2><p><small>Ephemeral host Chromium. Authenticated devices share its view; one device holds a 30-second control lease. Requires Playwright and Chromium on the host.</small></p><div class="row"><button id="claim">Claim control</button><button id="release">Release control</button><button id="closeBrowser">Close browser</button></div><div class="row"><input id="url" aria-label="Browser URL" placeholder="http://localhost:3000"><button id="openBrowser">Open URL</button><button id="frameButton">Refresh frame</button></div><p id="browserStatus"></p><img id="frame" alt="Shared browser screenshot"><div class="row"><input id="browserText" aria-label="Browser input text" maxlength="4096"><button id="typeText">Type text</button><button id="enterKey">Enter</button><button id="scrollDown">Scroll down</button></div></section>
<section><h2>Host diagnostics</h2><button id="diagnostics">Sample resource usage</button><pre id="resources"></pre></section></div></main>
<script nonce="${nonce}">${CONTROL_SCRIPT}</script></html>`;
}

export const CONTROL_SCRIPT = String.raw`
const $=id=>document.getElementById(id);let token='',environment,projectId='',sessionId='',snapshot,before,leaseId='',timer,catalogTimer,reading=false,models={},uncertain;
const showError=e=>{$('error').textContent=e?.message||String(e||'')};
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n};
const option=(select,id,text)=>{const n=el('option',text);n.value=id;select.append(n)};
async function rpc(method,params={}){
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),20000);try{
 const res=await fetch('/control/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({version:1,environmentId:environment?.environmentId,method,params}),signal:abort.signal,credentials:'omit',cache:'no-store'});
 if(res.status===401){disconnect();throw Error('Credential invalid or revoked; pair again')}
 const reader=res.body.getReader();let chunks=[],bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4*1024*1024){await reader.cancel();throw Error('Host response exceeds web transfer budget')}chunks.push(part.value)}
 const joined=new Uint8Array(bytes);let offset=0;for(const c of chunks){joined.set(c,offset);offset+=c.length}const data=JSON.parse(new TextDecoder().decode(joined));if(!res.ok||data.error)throw Error(data.error||'Host request failed');return data.result;
 }finally{clearTimeout(timeout)}
}
function disconnect(){clearTimeout(timer);clearTimeout(catalogTimer);token='';environment=undefined;leaseId='';snapshot=undefined;sessionId='';$('credential').value='';$('workspace').hidden=true;$('login').hidden=false;$('transcript').replaceChildren();$('questions').replaceChildren();$('frame').removeAttribute('src')}
async function command(params){const commandId=crypto.randomUUID();try{return await rpc('commands.dispatch',{...params,commandId})}catch(e){uncertain=commandId;$('recover').hidden=false;throw Error(e.message+'\nCommand '+commandId+' may have been accepted. Check its status before sending again.')}}
function providerModels(){const select=$('model'),previous=select.value;select.replaceChildren();for(const m of models[$('provider').value]||[])option(select,m.id,m.name||m.id);if(Array.from(select.options).some(o=>o.value===previous))select.value=previous}
async function loadModels(selected){const catalog=await rpc('models.list',{projectId:selected,progressive:true});if(!token||selected!==projectId)return;models=catalog.models||{};providerModels();if(catalog.pending?.length)catalogTimer=setTimeout(()=>void loadModels(selected).catch(showError),1000)}
async function project(){clearTimeout(catalogTimer);projectId=$('project').value;snapshot=undefined;sessionId='';models={};providerModels();$('sessions').replaceChildren();void loadModels(projectId).catch(showError);await listSessions()}
async function listSessions(){const list=await rpc('sessions.list',{projectId});const previous=sessionId;$('sessions').replaceChildren();for(const s of list)option($('sessions'),s.id,(s.needsInput?'⚠ ':'')+(s.title||s.id)+' · '+s.status);if(list.some(s=>s.id===previous))$('sessions').value=previous;sessionId=$('sessions').value;await readSession(true)}
async function readSession(force=false){if(!sessionId||reading||!token)return;reading=true;const selected=sessionId;try{
 if(!force&&snapshot){const sync=await rpc('sessions.sync',{sessionId:selected,revision:snapshot.revision,lazyHistory:true,loadedBlockIds:snapshot.session.blocks.map(b=>b.id)});if(selected!==sessionId)return;if(sync.kind==='unchanged')return;if(sync.kind==='delta'&&sync.partial&&sync.base===snapshot.revision&&sync.blockIds.length<=256&&new TextEncoder().encode(JSON.stringify(sync)).length<=2*1024*1024){const blocks=new Map(snapshot.session.blocks.map(b=>[b.id,b]));for(const b of sync.blocks)blocks.set(b.id,b);if(sync.blockIds.every(id=>blocks.has(id))){snapshot={...sync.value,session:{...sync.value.session,blocks:sync.blockIds.map(id=>blocks.get(id))}};before=snapshot.history?.before;render();return}}}
 const page=await rpc('sessions.page',{sessionId:selected,preview:true});if(selected!==sessionId)return;if(page.sync.kind!=='snapshot')throw Error('History requires desktop transfer; use desktop for this session');snapshot=page.sync.value;before=page.before;render();
 }finally{reading=false}}
function render(){const s=snapshot.session;$('status').textContent=snapshot.status+' · '+(s.title||sessionId);$('transcript').replaceChildren();for(const b of s.blocks){if(b.internal)continue;const row=el('div',(b.role||b.kind||'')+'\n'+(b.text||b.output||''));row.className='block';if(b.remoteContent)row.append(el('small','\n[Large content preview; open desktop for full block]'));if(b.approval&&!b.approval.decided){for(const decision of ['allow','deny']){const btn=el('button',decision);btn.onclick=()=>action(btn,async()=>{await command({type:'approve',sessionId,runId:snapshot.runId,requestId:b.approval.requestId,decision});await readSession(true)});row.append(btn)}}$('transcript').append(row)}
 $('older').disabled=before===undefined;$('stop').disabled=!snapshot.runId;$('questions').replaceChildren();const pending=s.pendingQuestion;if(pending){const answers={},custom={};for(const q of pending.questions){const field=el('fieldset','');field.append(el('legend',q.prompt));for(const o of q.options){const label=el('label','');const input=document.createElement('input');input.type=q.multiSelect?'checkbox':'radio';input.name=q.id;input.onchange=()=>{answers[q.id]=Array.from(field.querySelectorAll('input:checked')).map(i=>i.value)};input.value=o.id;label.append(input,document.createTextNode(' '+o.label));field.append(label)}if(q.allowCustom){const input=document.createElement('input');input.placeholder='Custom answer';input.oninput=()=>custom[q.id]=input.value;field.append(input)}$('questions').append(field)}const submit=el('button','Answer questions');submit.onclick=()=>action(submit,async()=>{await command({type:'answer',sessionId,runId:snapshot.runId,requestId:pending.requestId,reply:{kind:'answered',answers,custom}});await readSession(true)});$('questions').append(submit)} }
async function action(button,fn){button.disabled=true;showError('');try{await fn()}catch(e){showError(e)}finally{button.disabled=false}}
function bind(id,fn){$(id).onclick=()=>action($(id),fn)}
function schedule(){clearTimeout(timer);if(!token)return;timer=setTimeout(async()=>{try{if(!document.hidden)await readSession()}catch(e){showError(e)}finally{schedule()}},3000)}
bind('connect',async()=>{token=$('credential').value.trim();$('credential').value='';if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Enter a valid paired device credential');environment=await rpc('environment.describe',{supportedProviders:['codex','claude','cursor','grok','opencode','pi','omp','fx','hermes','antigravity','acp']});$('provider').replaceChildren();for(const p of environment.providers)option($('provider'),p,p);const projects=await rpc('projects.list');$('project').replaceChildren();for(const p of projects)option($('project'),p.id,p.name||p.cwd);$('login').hidden=true;$('workspace').hidden=false;await project();schedule()});
bind('logout',async()=>disconnect());bind('refresh',listSessions);$('project').onchange=()=>action($('refresh'),project);$('provider').onchange=providerModels;$('sessions').onchange=()=>{sessionId=$('sessions').value;snapshot=undefined;action($('refresh'),()=>readSession(true))};
bind('start',async()=>{if(!$('model').value)throw Error('Choose an available model');const r=await command({type:'create',projectId,harness:$('provider').value,model:$('model').value,runtimeMode:'supervised'});sessionId=r.sessionId;await listSessions()});
bind('send',async()=>{if(!sessionId)throw Error('Choose a session');const text=$('prompt').value;await command({type:'send',sessionId,text});if($('prompt').value===text)$('prompt').value='';await readSession(true)});
bind('stop',async()=>{await command({type:'cancel',sessionId,runId:snapshot.runId});await readSession(true)});
bind('recover',async()=>{const result=await rpc('commands.status',{commandId:uncertain});showError(result?'Accepted: '+JSON.stringify(result):'No receipt found. Verify the session before retrying.');if(result){uncertain=undefined;$('recover').hidden=true}});
bind('older',async()=>{const page=await rpc('sessions.page',{sessionId,before,revision:snapshot.revision,preview:true});if(page.sync.kind!=='snapshot')throw Error('Use desktop for this history transfer');snapshot=page.sync.value;before=page.before;render()});
async function browser(method,params={}){const result=await rpc(method,{...params,leaseId});if(result.leaseId)leaseId=result.leaseId;else if(method==='browser.release'||method==='browser.close')leaseId='';$('browserStatus').textContent=(result.open?'Open: '+result.url:'Closed')+(result.controlling?' · Your device controls':'');return result}
bind('claim',()=>browser('browser.claim'));bind('release',()=>browser('browser.release'));bind('closeBrowser',async()=>{await browser('browser.close');$('frame').removeAttribute('src')});
async function frame(){const result=await browser('browser.frame');$('frame').src='data:'+result.mimeType+';base64,'+result.data}
bind('openBrowser',async()=>{await browser('browser.open',{url:$('url').value});await frame()});bind('frameButton',frame);bind('typeText',async()=>{await browser('browser.input',{kind:'text',text:$('browserText').value});$('browserText').value='';await frame()});bind('enterKey',async()=>{await browser('browser.input',{kind:'key',key:'Enter'});await frame()});bind('scrollDown',async()=>{await browser('browser.input',{kind:'scroll',y:500});await frame()});
$('frame').onclick=e=>action($('frameButton'),async()=>{const box=e.target.getBoundingClientRect();await browser('browser.input',{kind:'click',x:(e.clientX-box.left)*1280/box.width,y:(e.clientY-box.top)*720/box.height});await frame()});
bind('diagnostics',async()=>{const result=await rpc('resources.read');const sample=result.samples.at(-1);$('resources').textContent=JSON.stringify(sample,null,2)+'\nNode process only; provider child processes excluded. On-demand sampling.'});
addEventListener('pagehide',disconnect);
`;
