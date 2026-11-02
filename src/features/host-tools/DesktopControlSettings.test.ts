// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("./desktopControlClient",()=>({desktopControlRequest:mock.request,desktopHelperRequest:async()=>({phase:"missing"})}));
import { DesktopControlSettings } from "./DesktopControlSettings";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const config={enabled:false,binaryPath:"",binarySha256:"",allowedApps:[],allowPhysicalInput:false,version:0};
const state={configuration:config,status:{installed:false,verified:false,enabled:false,stopped:false,active:false,upstreamRef:"pinned",protocol:"2.5"}};
let root:ReturnType<typeof createRoot>;
let container:HTMLDivElement;
beforeEach(()=>{mock.request.mockReset().mockResolvedValue(state);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();});
async function render(){await act(async()=>{root.render(createElement(DesktopControlSettings));});}
async function click(label:string){const button=[...container.querySelectorAll("button")].find(node=>node.textContent===label)!;expect(button).toBeTruthy();await act(async()=>button.click());}
it("does not observe the desktop or enable an uninstalled helper on mount",async()=>{
 await render();expect(mock.request).toHaveBeenCalledExactlyOnceWith({op:"status"});
 expect(container.textContent).toContain("Not installed");
 expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});
it("keeps emergency Stop available while a settings save is pending",async()=>{
 mock.request.mockResolvedValueOnce({...state,status:{...state.status,installed:true,verified:true}});
 await render();let resolve!:(value:unknown)=>void;
 mock.request.mockImplementation(input=>input.op==="configure"?new Promise(done=>{resolve=done;}):Promise.resolve(state));
 await click("Save computer controls");
 await click("Stop computer use");
 expect(mock.request.mock.calls.map(([input])=>input.op)).toContain("stop");
 expect(container.textContent).toContain("Stopped");
 await act(async()=>resolve(state));
});
it("ignores an accepted save response arriving after Stop and retains the Stop version and unsaved owner options",async()=>{
 const enabled={...config,enabled:true,version:1};
 mock.request.mockResolvedValueOnce({...state,configuration:enabled,status:{...state.status,installed:true,verified:true}});
 await render();
 await act(async()=>{container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1].click();});
 let resolve!:(value:unknown)=>void;
 mock.request.mockImplementation(input=>input.op==="configure"?new Promise(done=>{resolve=done;}):
  Promise.resolve({...state,configuration:{...config,version:2}}));
 await click("Save computer controls");
 await click("Stop computer use");
 await act(async()=>resolve({...state,configuration:enabled}));
 const switches=container.querySelectorAll('[role="switch"]');
 expect(switches[0].getAttribute("aria-checked")).toBe("false");
 expect(switches[1].getAttribute("aria-checked")).toBe("true");
 expect(container.textContent).toContain("Stopped");
 mock.request.mockResolvedValue({...state,configuration:{...config,version:3}});
 await click("Save computer controls");
 expect(mock.request.mock.calls.filter(([input])=>input.op==="configure").at(-1)?.[0]).toMatchObject({
  expectedVersion:2,configuration:{enabled:false,allowPhysicalInput:true},
 });
});
it("does not let a save's older fallback status erase the newer Stop receipt",async()=>{
 mock.request.mockResolvedValueOnce({...state,status:{...state.status,installed:true,verified:true}});
 await render();
 let resolve!:(value:unknown)=>void;
 mock.request.mockImplementation(input=>input.op==="configure"?Promise.resolve({...state,configuration:{...config,enabled:true,version:1}}):
  input.op==="stop"?Promise.resolve({...state,configuration:{...config,version:2}}):new Promise(done=>{resolve=done;}));
 await click("Save computer controls");
 await click("Stop computer use");
 await act(async()=>resolve({...state,status:{...state.status,installed:true,verified:true,enabled:true,active:true}}));
 expect(container.textContent).toContain("Stopped");
 expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});
it("refreshes status without overwriting an unsaved enable choice or adopting another writer's configuration version",async()=>{
 await render();
 await act(async()=>{container.querySelector<HTMLButtonElement>('[role="switch"]')!.click();});
 mock.request.mockResolvedValue({...state,configuration:{...config,version:9}});
 await click("Refresh");
 expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
 await click("Save computer controls");
 expect(mock.request.mock.calls.filter(([input])=>input.op==="configure").at(-1)?.[0]).toMatchObject({expectedVersion:0,configuration:{enabled:true}});
});
