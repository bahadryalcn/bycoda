import { beforeEach,expect,it,vi } from "vitest";
const voice=vi.hoisted(()=>({request:vi.fn(),preview:vi.fn(),active:false,listeners:new Set<()=>void>()}));
vi.mock('./assistantClient',()=>({assistantRequest:voice.request}));
vi.mock('./assistantHostRead',()=>({captureAssistantHostRead:async()=>({environmentId:'speech-fixture',snapshot:async()=>(await voice.request({op:'snapshot',limit:100})).snapshot})}));
vi.mock('../../voice/model/voiceSettings',()=>({loadVoiceSettings:()=>({mode:'local'})}));
vi.mock('../../voice/model/voicePreview',()=>({previewVoice:voice.preview}));
vi.mock('../../voice/model/voiceActivity',()=>({isVoiceConversationActive:()=>voice.active,subscribeVoiceConversationActivity:(fn:()=>void)=>{voice.listeners.add(fn);return()=>voice.listeners.delete(fn);}}));
import { listenAssistantBriefing } from './assistantBriefingSpeech';
let snapshot:any;
beforeEach(()=>{
 voice.active=false;voice.listeners.clear();voice.preview.mockReset().mockResolvedValue(undefined);
 snapshot={profile:{name:'Arif',setupComplete:true,voiceSetupComplete:true,language:'tr'},briefing:{id:'brief',text:'Retained safe summary'},memory:[]};
 voice.request.mockReset().mockImplementation(async()=>({snapshot}));
});
it('uses fresh exact briefing text with the existing output-only completion port',async()=>{
 const controller=new AbortController();await listenAssistantBriefing('brief',controller.signal,()=>{});
 expect(voice.preview).toHaveBeenCalledTimes(1);const args=voice.preview.mock.calls[0];
 expect(args[1]).toBe('tr');expect(args[2]).toBe('Arif');expect(args[5]).toBe('Retained safe summary');expect(args[7]).toEqual({complete:true});
 expect(voice.listeners.size).toBe(0);expect(args[3].aborted).toBe(true);
});
it('refuses stale briefings, incomplete setup and newly forbidden text before creating output',async()=>{
 snapshot.briefing.id='replacement';await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{})).rejects.toThrow('briefing changed');
 snapshot.briefing.id='brief';snapshot.profile.voiceSetupComplete=false;await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{})).rejects.toThrow('Set up voice');
 snapshot.profile.voiceSetupComplete=true;snapshot.memory=[{kind:'rule',active:true,forbiddenTerms:['retained']}];
 await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{})).rejects.toThrow('current rule');expect(voice.preview).not.toHaveBeenCalled();
});
it('cancels playback when an actual voice conversation starts and does not open another output while it is active',async()=>{
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 voice.preview.mockImplementation(async(_settings,_language,_name,signal:AbortSignal)=>{entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));});
 const playing=listenAssistantBriefing('brief',new AbortController().signal,()=>{});await started;
 voice.active=true;for(const listener of voice.listeners)listener();
 await expect(playing).rejects.toThrow('Voice became active');
 await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{})).rejects.toThrow('Finish the voice');
 expect(voice.preview).toHaveBeenCalledTimes(1);
});
it('uses accepted spoken language for Auto, preserves a fixed choice and refuses unknown language',async()=>{
 snapshot.profile.language='auto';snapshot.lastSpokenLanguage='tr';await listenAssistantBriefing('brief',new AbortController().signal,()=>{});
 expect(voice.preview.mock.calls[0][1]).toBe('auto');expect(voice.preview.mock.calls[0][7]).toEqual({complete:true,languageHint:'tr'});
 snapshot.profile.language='de';await listenAssistantBriefing('brief',new AbortController().signal,()=>{});expect(voice.preview.mock.calls[1][1]).toBe('de');
 snapshot.profile.language='auto';snapshot.lastSpokenLanguage=null;
 await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{})).rejects.toThrow('Speak once or choose a language');expect(voice.preview).toHaveBeenCalledTimes(2);
});
it('refuses output if project visibility is revoked while refreshing the briefing',async()=>{
 let allowed=true;voice.request.mockImplementation(async()=>{allowed=false;return{snapshot};});
 await expect(listenAssistantBriefing('brief',new AbortController().signal,()=>{},()=>allowed)).rejects.toThrow('current project scope');
 expect(voice.preview).not.toHaveBeenCalled();
});
