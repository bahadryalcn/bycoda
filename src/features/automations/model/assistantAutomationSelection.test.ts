import {expect,it} from "vitest";
import {assistantAutomationSelection} from "./assistantAutomationSelection";
import type {Automation} from "./automations";
const target={id:"automation",projectId:"project",environmentId:"original",machineId:"machine",token:1};
const row={id:"automation",cwd:"/project",host:{machineId:"machine",environmentId:"original",projectId:"project"}} as Automation;
it("reveals only the exact fresh Host row in visible project scope",()=>{
 expect(assistantAutomationSelection(target,[row],cwd=>cwd==="/project")).toBe(row);
 for(const changed of [{...row,host:{...row.host!,environmentId:"replacement"}},{...row,host:{...row.host!,machineId:"other"}},{...row,host:{...row.host!,projectId:"other"}},{...row,host:{...row.host!,stale:true}},{...row,host:{...row.host!,environmentId:undefined}},{...row,host:undefined}])expect(assistantAutomationSelection(target,[changed],()=>true)).toBeUndefined();
 expect(assistantAutomationSelection(target,[row],()=>false)).toBeUndefined();
});
