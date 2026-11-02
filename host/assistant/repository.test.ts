import {afterEach,expect,it} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HostStore} from "../store";
import {AssistantRepository} from "./repository";
import {AssistantRequestValidationSchema,type AssistantMessage} from "../../src/shared/model/host-contracts/assistant";

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const path=mkdtempSync(join(tmpdir(),"assistant-history-cursor-")),store=new HostStore(join(path,"host.db"));await store.ready;
 const repository=new AssistantRepository(store);await repository.initialize();
 cleanups.push(async()=>{await store.close();rmSync(path,{recursive:true,force:true});});
 const put=(id:string,createdAt=1000,threadId="thread")=>repository.put<AssistantMessage>("messages",{id,version:0,createdAt,updatedAt:createdAt,threadId,role:"user",via:"text",text:id,jobIds:[]},0);
 return {repository,put};
}

it("pages every same-createdAt sibling in canonical insertion order even after an edit changes updatedAt",async()=>{
 const f=await fixture();await f.put("old",100);
 const ids=["z-last-lexical","a-first-lexical","m-middle","q","c","y","b","x","d"];
 const saved=[];for(const id of ids)saved.push(await f.put(id));await f.put("new",2000);
 await f.repository.put("messages",{...saved[1],text:"Edited actual message",updatedAt:99999},saved[1].version);
 let page=await f.repository.messages<AssistantMessage>("thread",3),all=page;
 expect(page.map(message=>message.id)).toEqual(["x","d","new"]);
 let pages=1;
 while(page.length){
  const oldest=page[0];page=await f.repository.messages<AssistantMessage>("thread",3,oldest.createdAt,oldest.id);
  if(page.length){all=[...page,...all];pages++;}
 }
 expect(pages).toBe(4);expect(all.map(message=>message.id)).toEqual(["old",...ids,"new"]);
 expect(new Set(all.map(message=>message.id)).size).toBe(11);
 expect(all.find(message=>message.id===saved[1].id)?.text).toBe("Edited actual message");
 // Compatibility: timestamp-only clients intentionally retain their strict cut.
 expect((await f.repository.messages<AssistantMessage>("thread",100,1000)).map(message=>message.id)).toEqual(["old"]);
});

it("refuses a deleted, foreign, missing or timestamp-mismatched cursor rather than silently losing its siblings",async()=>{
 const f=await fixture();const cursor=await f.put("cursor");await f.put("sibling");await f.put("foreign",1000,"other");
 for(const [before,beforeId] of [[1000,"foreign"],[1000,"missing"],[999,"cursor"],[undefined,"cursor"]] as const){
  await expect(f.repository.messages("thread",3,before,beforeId)).rejects.toThrow("cursor changed or is unavailable");
 }
 await f.repository.trash("messages",cursor.id,cursor.version,2000);
 await expect(f.repository.messages("thread",3,1000,cursor.id)).rejects.toThrow("cursor changed or is unavailable");
 expect((await f.repository.messages<AssistantMessage>("thread",100)).map(message=>message.id)).toEqual(["sibling"]);
});

it("accepts only the bounded paired timestamp/id wire cursor without any client rowid authority",()=>{
 const request={op:"threads.messages",threadId:"thread",limit:100,before:0,beforeId:"actual-message"};
 expect(AssistantRequestValidationSchema.parse(request)).toEqual(request);
 expect(AssistantRequestValidationSchema.safeParse({...request,before:undefined}).success).toBe(false);
 expect(AssistantRequestValidationSchema.safeParse({...request,beforeId:""}).success).toBe(false);
 expect(AssistantRequestValidationSchema.safeParse({...request,rowid:10}).success).toBe(false);
});
