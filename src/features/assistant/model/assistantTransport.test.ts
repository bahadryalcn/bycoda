// @vitest-environment happy-dom
import {beforeEach,expect,it,vi} from "vitest";
const native=vi.hoisted(()=>({environmentId:"original",changeDuringWrite:false,writes:0,invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke}));
vi.mock("../../connections/model/remoteHealth",()=>({subscribeRemoteRecovered:()=>()=>undefined}));
import {assistantRequest} from "./assistantClient";
import {invalidateMachineSnapshot} from "../../automations/model/machineSnapshot";
beforeEach(()=>{
 native.environmentId="original";native.changeDuringWrite=false;native.writes=0;invalidateMachineSnapshot();
 native.invoke.mockReset().mockImplementation(async(command:string,args?:any)=>{
  if(command==="local_host_connect")return{id:"machine",name:"Private test Host",endpoint:"http://127.0.0.1:1",environmentId:native.environmentId};
  if(command!=="remote_request")throw new Error("Unexpected native operation");
  if(args.expectedEnvironmentId&&args.expectedEnvironmentId!==native.environmentId)throw new Error("Native refused a replacement environment");
  if(args.method==="environment.describe")return{environmentId:native.environmentId,capabilities:["assistant.v1"]};
  if(args.method!=="assistant.request")throw new Error("Unsupported owner operation");
  if(args.params.op==="notes.get")return{note:null};
  if(args.params.op==="notes.save"){native.writes++;if(native.changeDuringWrite)native.environmentId="replacement";return{note:{id:"stable-note",title:"Exact title",body:"Exact body",tags:["assistant"],createdAt:1,updatedAt:1}};}
  throw new Error("No fixture snapshot requested");
 });
});
it("passes captured source through the real default owner/native transport and refuses an identical ID on a replacement Host",async()=>{
 await expect(assistantRequest({op:"notes.get",id:"stable-note"},"original")).resolves.toEqual({note:null});
 const read=native.invoke.mock.calls.find(([,args])=>args?.method==="assistant.request")![1];expect(read).toMatchObject({machineId:"machine",expectedEnvironmentId:"original",params:{op:"notes.get",id:"stable-note"}});
 native.environmentId="replacement";
 await expect(assistantRequest({op:"notes.save",id:"stable-note",title:"Exact title",body:"Exact body",expectedUpdatedAt:0},"original")).rejects.toThrow("original connection");expect(native.writes).toBe(0);
});
it("parks a write when the captured route changes before its reply and never retries the effect",async()=>{
 native.changeDuringWrite=true;
 await expect(assistantRequest({op:"notes.save",id:"stable-note",title:"Exact title",body:"Exact body",expectedUpdatedAt:0},"original")).rejects.toThrow(/original connection|outcome is unknown/);
 expect(native.writes).toBe(1);expect(native.invoke.mock.calls.filter(([,args])=>args?.method==="assistant.request")).toHaveLength(1);
});
