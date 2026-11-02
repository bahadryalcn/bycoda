import {AssistantVoiceContextSchema,AssistantVoiceDisclosureSchema,type AssistantVoiceContext,type AssistantVoiceDisclosure} from "../src/shared/model/assistantVoiceContext";
import type {VoiceToolFamily} from "./voice-tools";
export type VoiceDisclosureSource={threadId?:string;projectId:string;sessionId?:string;family:VoiceToolFamily;action:string};
type Ports={authorized:()=>Promise<boolean>;begin(input:{contextId:string;requestId:string}):Promise<{id:string;contextId:string}>;finish(id:string,input:VoiceDisclosureSource&{threadId:string;result:unknown}):Promise<{voiceContext:AssistantVoiceContext;voiceDisclosure:AssistantVoiceDisclosure}>;fail(id:string):Promise<void>};

/** Request-local proof follows the original owner and the actual issued grant. */
export class HostVoiceToolDisclosure{
 private ticket?:{id:string;contextId:string};private requestId?:string;private source?:VoiceDisclosureSource;private complete=false;private sent=false;
 constructor(private readonly ports:Ports,private readonly serialized:(value:unknown)=>string|undefined=()=>undefined){}
 private async check(){if(!await this.ports.authorized())throw new Error("Native owner authority revoked before voice disclosure.");}
 async begin(contextId:string,requestId:string){
  if(this.ticket)throw new Error("Voice disclosure already started.");
  await this.check();this.requestId=requestId;this.ticket=await this.ports.begin({contextId,requestId});await this.check();
  if(this.ticket.contextId!==contextId)throw new Error("Voice disclosure context changed.");
 }
 bind(source:VoiceDisclosureSource){if(this.source)throw new Error("Voice disclosure source is already captured.");if(this.ticket&&!source.threadId)throw new Error("Voice disclosure requires its exact conversation.");this.source=structuredClone(source);}
 async body(value:unknown):Promise<string>{
  const inline=this.serialized(value);
  if(!this.ticket)return inline===undefined?JSON.stringify({result:value}):`{"result":${inline}}`;
  const original=inline??JSON.stringify(value??null);
  if(this.complete||!this.source?.threadId)throw new Error("Voice disclosure is not bound to a current result.");
  await this.check();
  const proof=await this.ports.finish(this.ticket.id,{...this.source,threadId:this.source.threadId,result:value});
  const voiceContext=AssistantVoiceContextSchema.parse(proof.voiceContext),voiceDisclosure=AssistantVoiceDisclosureSchema.parse(proof.voiceDisclosure);
  if(voiceContext.id!==this.ticket.contextId)throw new Error("Voice disclosure result belongs to another context.");
  if(voiceDisclosure.contextId!==this.ticket.contextId||voiceDisclosure.requestId!==this.requestId)throw new Error("Voice disclosure result belongs to another request.");
  await this.check();this.complete=true;
  return `{"result":{"value":${original},"voiceContext":${JSON.stringify(voiceContext)},"voiceDisclosure":${JSON.stringify(voiceDisclosure)}}}`;
 }
 markSent(){if(!this.complete)throw new Error("Voice disclosure has not been prepared.");this.sent=true;}
 async fail(){if(this.ticket&&!this.sent)await this.ports.fail(this.ticket.id);}
}
