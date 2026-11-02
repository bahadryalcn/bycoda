import { useEffect,useState } from "react";
import { t } from "../../../shared/i18n";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import { assistantPresenceState } from "../model/assistantBriefing";
import {AssistantPresenceIndicator} from "./AssistantPresenceIndicator";
import styles from "./AssistantPresenceIndicator.module.css";

function label(state:string){
 switch(state){case 'present':return t("Here");case 'idle':return t("Idle");case 'away':return t("Away");case 'locked':return t("Locked");case 'dnd':return t("Do not disturb");default:return t("Unknown");}
}
export function AssistantPresenceStatus({snapshot,details=false,compact=false,unconfirmed=false}:{snapshot:Pick<AssistantSnapshot,'presence'|'automaticPresence'|'effectivePresence'>;details?:boolean;compact?:boolean;unconfirmed?:boolean}){
 const [,refresh]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>refresh(value=>value+1),15000);return()=>clearInterval(timer);},[]);
 const state=assistantPresenceState(snapshot,Date.now());
 const effective=unconfirmed?'unknown':state.effective;
 if(compact)return <span role="status" aria-label={t("Current availability: {p0}",{p0:label(effective)})}><AssistantPresenceIndicator state={effective}/></span>;
 return <div className={styles.status}>
  <span role="status" aria-label={t("Current availability: {p0}",{p0:label(effective)})}><span className="sr-only">{t("Current availability: {p0}",{p0:""})}</span><AssistantPresenceIndicator state={effective}/></span>
  {details&&<><span className={styles.details}>{t("Computer presence: {p0}",{p0:label(state.detected)})}</span>
   <p className={styles.details}>{t("Automatic activity comes from this computer. Your Away or Do not disturb choice takes priority.")}</p></>}
 </div>;
}
