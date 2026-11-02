import type {AssistantQuickNoteAction} from "../../../shared/model/assistantQuick";
import {normalizeAssistantQuickNoteAction} from "../../../shared/model/assistantQuick";
import {t} from "../../../shared/i18n";
import {TextField} from "../../../shared/ui/TextField";
import {TextareaField} from "../../../shared/ui/TextareaField";
import styles from "./AssistantView.module.css";
export function AssistantQuickNoteFields({value,onChange,disabled=false}:{value:AssistantQuickNoteAction;onChange:(value:AssistantQuickNoteAction)=>void;disabled?:boolean}){
 const update=(patch:Partial<AssistantQuickNoteAction>)=>{if(!disabled)onChange({...value,...patch});};
 return <div className={styles.quickNoteFields}>
  <TextField label={t("Note title")} value={value.title} maxLength={200} disabled={disabled} onChange={event=>update({title:event.currentTarget.value})}/>
  <TextareaField label={t("Note content")} value={value.body} maxLength={100000} minRows={3} maxRows={10} disabled={disabled} onChange={event=>update({body:event.currentTarget.value})}/>
  <p className={styles.muted}>{t("Saved title")}: {normalizeAssistantQuickNoteAction(value).title}</p>
 </div>;
}
