import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {HostStore} from "./store";
import {RuntimeLogAccess} from "./runtime-log-tools";
import {SocialService} from "./social";
import {prepareVoiceToolDispatch} from "./voice-tools";
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){
  const directory=mkdtempSync(join(tmpdir(),"bycoda-voice-thread-"));const store=new HostStore(join(directory,"host.db"));
  const project=await store.addProject(directory,"A");const other=await store.addProject(join(directory,"other"),"B");
  const device=await store.issueDevice("Voice owner");const deviceHash=createHash("sha256").update(device.token).digest("hex");
  let binding:{id:string;projectId?:string}|null={id:"thread-a",projectId:project.id};
  const resolve=vi.fn(async(id:string)=>binding?.id===id?binding:null);
  const session=vi.fn(async()=>{throw new Error("A thread is not a session.");});
  const access=new RuntimeLogAccess({store,prepareSessionIdentity:session,sessionAuthority:session},Date.now,resolve);
  const social=new SocialService(store,{get:async()=>undefined,set:async()=>{},delete:async()=>{}},{},directory);
  social.setAssistantThreadResolver(resolve);
  cleanups.push(async()=>{await social.dispose();await store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,project,other,device,deviceHash,access,social,session,resolve,bind:(value:typeof binding)=>{binding=value;}};
}
it("mints genuine sessionless subjects and revokes them when a thread is removed",async()=>{
  const s=await fixture();
  const grant=await s.access.issueThreadGrant("thread-a",s.project.id,s.deviceHash);
  expect(await s.access.principalForToken(grant.token)).toEqual({kind:"assistant-thread",threadId:"thread-a",projectId:s.project.id,provider:"assistant"});
  expect(s.session).not.toHaveBeenCalled();
  await expect(s.access.issueThreadGrant("thread-a",s.other.id,s.deviceHash)).rejects.toThrow(/another project/);
  s.bind(null);expect(await s.access.principalForToken(grant.token)).toBeUndefined();
});
it("also revokes a real focused-session grant when its original assistant thread is removed",async()=>{
  const s=await fixture();
  const access=new RuntimeLogAccess({store:s.store,prepareSessionIdentity:async()=>{},sessionAuthority:async()=>({projectId:s.project.id,provider:"codex"})},Date.now,s.resolve);
  const grant=await access.issueSessionGrant("real-focused-session",s.deviceHash,undefined,"thread-a");
  expect(await access.principalForToken(grant.token)).toMatchObject({kind:"session",sessionId:"real-focused-session",assistantThreadId:"thread-a"});
  s.bind(null);expect(await access.principalForToken(grant.token)).toBeUndefined();
});
it("retains native device revocation and never treats a thread as an owner social principal",async()=>{
  const s=await fixture();const grant=await s.social.issueThreadGrant("thread-a",s.project.id,s.deviceHash);
  const principal=await s.social.principalForToken(grant.token);
  expect(principal).toMatchObject({kind:"assistant-thread",actorId:"assistant-thread:thread-a",projectId:s.project.id});expect(principal?.sessionId).toBeUndefined();
  await expect(s.social.call(principal!,"execution.enable",{enabled:true})).rejects.toThrow(/Only the account owner/);
  await s.store.revokeDevice(s.device.id);expect(await s.social.principalForToken(grant.token)).toBeUndefined();
});
it("allows narrow thread notes but requires a real focused session for working-copy tools",async()=>{
  const s=await fixture();const ports={authorized:async()=>true,environmentId:s.store.environmentId,deviceHash:s.deviceHash,threadIdentity:s.resolve,sessionIdentity:s.session,issuers:{conversation:s.access,social:s.social,"runtime-logs":s.access}};
  const dispatch=await prepareVoiceToolDispatch({projectId:s.project.id,threadId:"thread-a",family:"conversation",action:"notes.create",input:{id:"one",body:"Owner note"}},ports);
  expect(await s.access.principalForToken(dispatch.token)).toMatchObject({kind:"assistant-thread",threadId:"thread-a"});dispatch.release();
  expect(await s.access.principalForToken(dispatch.token)).toBeUndefined();
  await expect(prepareVoiceToolDispatch({projectId:s.project.id,threadId:"thread-a",family:"conversation",action:"files.list",input:{}},ports)).rejects.toThrow(/real focused session/);
  expect(s.session).not.toHaveBeenCalled();
});
