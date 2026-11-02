import type { AssistantRequest, AssistantResponse } from "../../../shared/model/host-contracts/assistant";
export const SPOKEN_LANGUAGES={tr:"tr-TR",en:"en-US",de:"de-DE",fr:"fr-FR",es:"es-ES",pt:"pt-PT",zh:"zh-CN",ja:"ja-JP"} as const;
export type SpokenLanguage=typeof SPOKEN_LANGUAGES[keyof typeof SPOKEN_LANGUAGES];
type RecordRequest=Extract<AssistantRequest,{op:"voice.language.record"}>;
const aliases:Record<string,keyof typeof SPOKEN_LANGUAGES>={turkish:"tr",english:"en",german:"de",french:"fr",spanish:"es",portuguese:"pt",chinese:"zh",japanese:"ja"};
/** Actual ASR language is preferred. UI locale and assistant/tool text are never inputs. */
export function acceptedVoiceLanguage(text:string,asrLanguage?:string):SpokenLanguage|undefined{
  if(asrLanguage){const raw=asrLanguage.trim().toLocaleLowerCase();const code=aliases[raw]??raw.split(/[-_]/)[0];if(Object.prototype.hasOwnProperty.call(SPOKEN_LANGUAGES,code))return SPOKEN_LANGUAGES[code as keyof typeof SPOKEN_LANGUAGES];}
  if((text.match(/[\u3040-\u30ff]/g)??[]).length>=2)return "ja-JP";
  if((text.match(/\p{Script=Han}/gu)??[]).length>=4&&(text.match(/[的是我请你在了这]/g)??[]).length>=2)return "zh-CN";
  const words=text.toLocaleLowerCase().normalize("NFC").match(/[\p{L}’']+/gu)??[];
  const dictionary:Record<string,readonly string[]>={tr:["merhaba","lütfen","teşekkür","sözümü","kesme","nasılsın","bugün","istiyorum","yapmanı","durdur","notlarımı","işleri","bunu"],en:["hello","thanks","please","would","could","this","that","your","with","don't","never","stop","all","job","work"],de:["hallo","bitte","danke","nicht","möchte","aufgabe","guten","morgen","arbeiten","diese","heute"],fr:["bonjour","merci","veuillez","pas","cette","travail","aujourd'hui","je","voudrais","vous","plaît"],es:["hola","gracias","por","favor","quiero","trabajo","esta","hoy","tarea","buenos","días"],pt:["olá","obrigado","obrigada","por","favor","quero","trabalho","esta","hoje","tarefa","bom","dia"]};
  const strong=new Set(["merhaba","hello","hallo","bonjour","hola","olá","obrigado","obrigada","gracias"]);
  const scores=Object.entries(dictionary).map(([code,vocabulary])=>({code,score:[...new Set(words)].reduce((sum,word)=>sum+(vocabulary.includes(word)?strong.has(word)?5:2:0),0)})).sort((a,b)=>b.score-a.score);
  if(scores[0].score>=4&&scores[0].score-scores[1].score>=3)return SPOKEN_LANGUAGES[scores[0].code as keyof typeof SPOKEN_LANGUAGES];
  return undefined; // Ambiguous words/names preserve the prior authoritative hint.
}
const KEY="bycoda.voice.language-pending.v1";
/** Best-effort metadata delivery; retries keep the original accepted timestamp and ID. */
export class VoiceSpokenLanguageWrites{
  private pending?:RecordRequest;private saving?:Promise<void>;
  constructor(private request:(input:AssistantRequest)=>Promise<AssistantResponse>){try{const value=JSON.parse(localStorage.getItem(KEY)??"null");if(value&&Object.values(SPOKEN_LANGUAGES).includes(value.language)&&typeof value.requestId==="string"&&value.requestId.length<=200&&Number.isSafeInteger(value.observedAt)&&value.observedAt>=0)this.pending={op:"voice.language.record",language:value.language,requestId:value.requestId,observedAt:value.observedAt};}catch{/* Invalid drafts cannot choose a language. */}}
  record(text:string,asrLanguage?:string,observedAt=Date.now()){
    const language=acceptedVoiceLanguage(text,asrLanguage);if(!language)return this.retry();
    this.pending={op:"voice.language.record",language,requestId:crypto.randomUUID(),observedAt};
    localStorage.setItem(KEY,JSON.stringify(this.pending));return this.retry();
  }
  retry():Promise<void>{
    if(this.saving)return this.saving;
    this.saving=(async()=>{while(this.pending){const current=this.pending;await this.request(current);if(this.pending===current){this.pending=undefined;localStorage.removeItem(KEY);}}})().finally(()=>{this.saving=undefined;});return this.saving;
  }
}
