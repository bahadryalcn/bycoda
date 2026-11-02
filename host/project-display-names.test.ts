import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { DesktopLive, DESKTOP_BEAT_STALE_MS } from "./desktopLive";
import { createProjectsService } from "./domains/projects/service";
import { projectDisplayNames } from "./project-display-names";

it("lists a renamed real project and creates an unsent session at its original canonical ID/cwd", async () => {
  const root=mkdtempSync(join(tmpdir(),"bycoda-project-names-")),cwd=join(root,"monocode");mkdirSync(cwd);
  const store=new HostStore(join(root,"host.db"));
  const send=vi.fn(),engine=new HostEngine(store,{codex:{send,cancel:vi.fn(),stop:vi.fn()} as any});
  let now=1000;const live=new DesktopLive(()=>now);
  try{
    await engine.ready;
    const registered=await engine.openProject(cwd);
    const beat=(name:string,excludedPaths:string[]=[])=>live.beat({clientId:"owner",sessions:[],projectDirectory:{version:1,projects:[{cwd,name}],groups:[],excludedPaths,excludedGroupIds:[]}});
    const list=async()=>{const rows=await store.projects();return projectDisplayNames(rows,live.projectDirectory(rows,store.environmentId));};
    const service=createProjectsService({list});
    beat("bycoda");
    const [shown]=await service.list({}, {authorized:async()=>true});
    expect(shown).toMatchObject({id:registered.id,cwd:registered.cwd,name:"bycoda"});
    const receipt=await engine.command({type:"create",commandId:"named-project-create",projectId:shown.id,harness:"codex",model:"test",runtimeMode:"supervised"});
    const session=await store.session(receipt.sessionId!);
    expect(session.projectId).toBe(registered.id);expect(session.session.cwd).toBe(registered.cwd);
    expect(session.session.blocks).toEqual([]);expect(send).not.toHaveBeenCalled();
    beat("Renamed again");expect((await service.list())[0].name).toBe("Renamed again");
    beat("Private label",[cwd]);expect((await service.list())[0].name).toBe("monocode");
    now+=DESKTOP_BEAT_STALE_MS+1;expect((await service.list())[0].name).toBe("monocode");
    expect((await store.project(registered.id)).name).toBe("monocode");
  }finally{await engine.close();await store.close();rmSync(root,{recursive:true,force:true});}
});

it("requires both canonical ID and cwd, never borrowing an alias from another project or Host",()=>{
  const registered=[{id:"a",cwd:"/work/monocode",name:"monocode"}];
  const directory={version:1 as const,privacyReady:true,groups:[],projects:[{id:"a",cwd:"/other",name:"Foreign",registered:true}]};
  expect(projectDisplayNames(registered,directory)).toEqual(registered);
  directory.projects[0]={id:"other",cwd:"/work/monocode",name:"Foreign",registered:true};
  expect(projectDisplayNames(registered,directory)).toEqual(registered);
});
