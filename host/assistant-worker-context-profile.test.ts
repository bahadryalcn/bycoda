import {expect,it} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HostStore} from "./store";
import {HostAssistant} from "./assistant/service";

it("persists explicit worker context thresholds and rejects crossed limits without overwriting the saved profile",async()=>{
 const folder=mkdtempSync(join(tmpdir(),"assistant-context-profile-")),store=new HostStore(join(folder,"host.db")),service=new HostAssistant(store);await service.ready;
 try{
  const initial=(await service.request({op:"snapshot"},"owner")).snapshot!.profile;expect(initial).toMatchObject({workerSoftContext:150000,workerHardContext:300000,workerCompactPercent:50,workerHandoffPercent:80});
  const saved=(await service.request({op:"profile.update",expectedVersion:initial.version,patch:{workerSoftContext:200000,workerHardContext:400000,workerCompactPercent:60,workerHandoffPercent:90}},"owner")).profile!;expect(saved.workerSoftContext).toBe(200000);
  for(const patch of [{workerHardContext:200000},{workerCompactPercent:90},{workerHandoffPercent:59}])await expect(service.request({op:"profile.update",expectedVersion:saved.version,patch},"owner")).rejects.toThrow("Worker context limits must increase");
  expect((await service.request({op:"snapshot"},"owner")).snapshot!.profile).toEqual(saved);
 }finally{await service.close();await store.close();rmSync(folder,{recursive:true,force:true});}
});
