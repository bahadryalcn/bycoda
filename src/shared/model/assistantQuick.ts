export type AssistantQuickNoteAction={kind:"note";title:string;body:string};

/** Match canonical Notes storage before the owner reviews/submits a quick note. */
export function normalizeAssistantQuickNoteAction(action:AssistantQuickNoteAction):AssistantQuickNoteAction{
 return{kind:"note",title:Array.from(action.title.trim()).slice(0,200).join("").trim()||"Untitled",body:action.body.replace(/\r\n?/g,"\n")};
}
