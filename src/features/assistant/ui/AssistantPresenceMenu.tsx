import {useEffect,useRef,useState} from "react";
import {isTauri} from "@tauri-apps/api/core";
import {t,useLocale} from "../../../shared/i18n";
import {Button} from "../../../shared/ui/Button";
import {DropdownMenu,type DropdownMenuItem} from "../../../shared/ui/DropdownMenu";
import {AssistantPresenceIndicator} from "./AssistantPresenceIndicator";
import {assistantPresencePresentation} from "../model/assistantPresencePresentation";
import {canSetAssistantPresence,emptyAssistantPresence,nativeAssistantPresencePort,type AssistantPresenceChoice,type AssistantPresencePort,type AssistantPresenceView} from "../model/assistantPresence";

export function AssistantPresenceMenu({port=nativeAssistantPresencePort}:{port?:AssistantPresencePort}){
 useLocale();
 const supported=port!==nativeAssistantPresencePort||isTauri();
 const [view,setView]=useState(emptyAssistantPresence),[token,setToken]=useState<string|null|undefined>(undefined),[localError,setLocalError]=useState(false),[busy,setBusy]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null),active=useRef(true),inflight=useRef(false),latest=useRef(view);latest.current=view;
 function accept(next:AssistantPresenceView){if(active.current){if(next.revision>latest.current.revision&&!next.pending&&!next.writeError)setLocalError(false);setView(current=>next.revision>=current.revision?next:current);}}
 useEffect(()=>{if(!supported)return;active.current=true;let release:(()=>void)|undefined;void port.read().then(accept,()=>{if(active.current)setLocalError(true);});void port.subscribe(accept).then(stop=>{if(active.current)release=stop;else stop();},()=>{if(active.current)setLocalError(true);});return()=>{active.current=false;release?.();};},[port,supported]);
 async function open(){if(inflight.current)return;setToken(latest.current.sourceToken);setLocalError(false);inflight.current=true;setBusy(true);try{const next=await port.refresh();if(active.current){accept(next);setToken(next.sourceToken);}}catch{if(active.current)setLocalError(true);}finally{inflight.current=false;if(active.current)setBusy(false);}}
 async function change(state:AssistantPresenceChoice){const captured=token;if(!captured||inflight.current)return;inflight.current=true;setBusy(true);try{const next=await port.set(captured,state);if(active.current){accept(next);setLocalError(false);if(next.writeError)setToken(captured);}}catch{if(active.current){setLocalError(true);setToken(captured);}}finally{inflight.current=false;if(active.current)setBusy(false);}}
 if(!supported||view.status&&!view.status.setupComplete)return null;
 const error=localError||view.statusError||view.writeError;
 const state=assistantPresencePresentation(view.status?.state,Boolean(error||view.pending||busy)).state;
 const label=t(view.pending||busy?"Updating availability...":assistantPresencePresentation(state).label);
 const items:DropdownMenuItem[]=[{kind:"group",id:"presence",label:t("Availability"),items:(["present","away","dnd"] as const).map(choice=>({kind:"item",id:choice,label:t(assistantPresencePresentation(choice).label),icon:<AssistantPresenceIndicator state={choice} markOnly/>,checked:state===choice,selectionRole:"radio",disabled:busy||localError||!canSetAssistantPresence(view,token??null)}))}];
 if(error)items.push({kind:"item",id:"failure",label:t("Availability change was not confirmed."),disabled:true});
 if(view.writeError&&view.retry)items.push({kind:"item",id:"retry",label:t("Retry"),disabled:view.pending||busy||token!==view.sourceToken});
 items.push({kind:"sep"},{kind:"item",id:"refresh",label:t("Refresh"),disabled:busy||view.pending||view.writeError});
 return <div className="flex shrink-0 items-center px-1" data-assistant-presence>
  <Button ref={trigger} size="sm" variant="ghost" disabled={busy||view.pending} label={t("Availability: {p0}",{p0:label})} tooltip={error?t("Availability change was not confirmed."):t("Availability: {p0}",{p0:label})} aria-haspopup="menu" aria-expanded={token!==undefined} onClick={()=>token!==undefined?setToken(undefined):void open()}>
   <AssistantPresenceIndicator state={state} label={label} className="max-w-24"/>
  </Button>
  {error&&<span className="sr-only" role="alert">{t("Availability change was not confirmed.")}</span>}
  {token!==undefined&&<DropdownMenu anchor={trigger} returnFocusRef={trigger} label={t("Availability")} items={items} onClose={()=>setToken(undefined)} onPick={id=>{if(id==="refresh")void open();else if(id==="retry"&&view.retry)void change(view.retry);else if(id==="present"||id==="away"||id==="dnd")void change(id);}}/>}
 </div>;
}
