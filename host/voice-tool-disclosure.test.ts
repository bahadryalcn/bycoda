import {expect,it,vi} from "vitest";
import {HostVoiceToolDisclosure,type VoiceDisclosureSource} from "./voice-tool-disclosure";
const context={id:"context",version:2,environmentId:"host",threadId:"thread",generationKey:"generation",ownerMessageId:"owner-turn",status:"known" as const,projectIds:["project"],createdAt:1,updatedAt:2};
const disclosure={id:"ticket",contextId:"context",requestId:"request",verified:true,projectIds:["project"]};
const proof={voiceContext:context,voiceDisclosure:disclosure};
const source:VoiceDisclosureSource={threadId:"thread",projectId:"project",family:"conversation",action:"tasks.read"};
function fixture(){let authorized=true;const begin=vi.fn(async()=>({id:"ticket",contextId:"context"})),finish=vi.fn(async()=>proof),fail=vi.fn(async()=>{});const adapter=new HostVoiceToolDisclosure({authorized:async()=>authorized,begin,finish,fail});return{adapter,begin,finish,fail,revoke:()=>{authorized=false;}};}
it("preserves legacy results exactly without adding a causal wrapper or callback",async()=>{
 const f=fixture();expect(await f.adapter.body({ok:true})).toBe('{"result":{"ok":true}}');expect(await f.adapter.body(undefined)).toBe("{}");expect(f.finish).not.toHaveBeenCalled();
});
it("finishes the actual immutable grant source before returning conditional causal metadata",async()=>{
 const f=fixture();await f.adapter.begin("context","request");const captured={...source};f.adapter.bind(captured);captured.projectId="replacement";
 expect(JSON.parse(await f.adapter.body({id:"canonical-task"}))).toEqual({result:{value:{id:"canonical-task"},voiceContext:context,voiceDisclosure:disclosure}});
 expect(f.begin).toHaveBeenCalledWith({contextId:"context",requestId:"request"});expect(f.finish).toHaveBeenCalledWith("ticket",{...source,result:{id:"canonical-task"}});
 expect(()=>f.adapter.bind({...source,projectId:"replacement"})).toThrow("captured");f.adapter.markSent();await f.adapter.fail();expect(f.fail).not.toHaveBeenCalled();
});
it("does not release data when the original owner is revoked during proof finalization",async()=>{
 const f=fixture();await f.adapter.begin("context","request");f.adapter.bind(source);f.finish.mockImplementation(async()=>{f.revoke();return proof;});
 await expect(f.adapter.body({private:"data"})).rejects.toThrow("revoked");await f.adapter.fail();expect(f.fail).toHaveBeenCalledWith("ticket");
});
it("refuses foreign or malformed context metadata instead of adopting a replacement scope",async()=>{
 for(const changed of [{...context,id:"replacement"},{...context,status:"invented"}]){
  const f=fixture();await f.adapter.begin("context","request");f.adapter.bind(source);f.finish.mockResolvedValue({...proof,voiceContext:changed as typeof context});
  await expect(f.adapter.body({private:"data"})).rejects.toThrow();await f.adapter.fail();expect(f.fail).toHaveBeenCalledWith("ticket");
 }
});
it("fails an unfinished ticket on dispatch failure without repeating the original effect",async()=>{
 const f=fixture();await f.adapter.begin("context","request");await f.adapter.fail();expect(f.fail).toHaveBeenCalledOnce();expect(f.finish).not.toHaveBeenCalled();expect(()=>f.adapter.bind({...source,threadId:undefined})).toThrow("conversation");
});
it("preserves pre-serialized native data without parsing or copying its large value",async()=>{
 const begin=vi.fn(async()=>({id:"ticket",contextId:"context"}));const adapter=new HostVoiceToolDisclosure({authorized:async()=>true,begin,finish:async()=>proof,fail:async()=>{}},()=>'{"native":true}');
 await adapter.begin("context","request");adapter.bind(source);expect(JSON.parse(await adapter.body({opaque:true}))).toEqual({result:{value:{native:true},voiceContext:context,voiceDisclosure:disclosure}});
});
