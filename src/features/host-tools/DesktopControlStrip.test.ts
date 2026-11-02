// @vitest-environment happy-dom
import {act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {DesktopIndicatorPort,DesktopIndicatorView} from "./desktopControlIndicator";
const mock=vi.hoisted(()=>({shortcut:undefined as undefined|((event:{payload:{ok:boolean}})=>void)}));
vi.mock("@tauri-apps/api/event",()=>({listen:async(_name:string,callback:typeof mock.shortcut)=>{mock.shortcut=callback;return()=>{mock.shortcut=undefined;};}}));
import {DesktopControlStrip} from "./DesktopControlStrip";
(globalThis as{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const active:DesktopIndicatorView={revision:1,status:{enabled:true,active:true,stopped:false,assistantName:"Arif"},visible:true,statusError:false,stopError:false,stopping:false};
const stopped:DesktopIndicatorView={...active,revision:3,status:{...active.status!,enabled:false,active:false,stopped:true}};
let root:ReturnType<typeof createRoot>,container:HTMLDivElement,read:ReturnType<typeof vi.fn>,stop:ReturnType<typeof vi.fn>,receive:((state:DesktopIndicatorView)=>void)|undefined,port:DesktopIndicatorPort;
beforeEach(()=>{read=vi.fn(async()=>active);stop=vi.fn(async()=>undefined);port={read,stop,subscribe:async callback=>{receive=callback;return()=>{receive=undefined;};}};container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.useRealTimers();});
async function render(props:Partial<Parameters<typeof DesktopControlStrip>[0]>={}){await act(async()=>root.render(createElement(DesktopControlStrip,{port,...props})));}
it("only reads the shared native state on mount and hides never-active disabled control",async()=>{
 read.mockResolvedValue({...stopped,visible:false});await render();expect(read).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();expect(container.textContent).toBe("");
});
it.each([["launch","Editor","Launching app"],["clipboard-get","Global clipboard","Reading clipboard"],["clipboard-set","Global clipboard","Writing clipboard"],["clipboard-clear","Global clipboard","Clearing clipboard"]])("shows bounded actual %s consequence and independent Stop",async(action,app,label)=>{
 read.mockResolvedValue({...active,status:{...active.status!,currentAction:{app,action}}});await render();expect(container.querySelector('[role="status"]')?.textContent).toContain(`${app} · ${label}`);expect(container.querySelector("button")!.disabled).toBe(false);
});
it("can Stop while a native status read is pending and ignores a pre-Stop late response",async()=>{
 vi.useFakeTimers();await render();let finish!:(value:DesktopIndicatorView)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(stopped);
 await act(async()=>vi.advanceTimersByTime(3000));expect(container.querySelector("button")!.disabled).toBe(false);await act(async()=>container.querySelector("button")!.click());expect(stop).toHaveBeenCalledTimes(1);expect(container.textContent).toBe("");
 await act(async()=>finish(active));expect(container.textContent).toBe("");
});
it("never infers old-source Stop from a global shortcut boolean and refreshes actual controller state",async()=>{
 await render();await act(async()=>mock.shortcut!({payload:{ok:true}}));expect(container.textContent).toContain("Working");expect(container.querySelector("button")).not.toBeNull();
 await act(async()=>receive!(stopped));expect(container.textContent).toBe("");
});
it("keeps a failed physical shortcut visible even when control was previously disabled",async()=>{
 read.mockResolvedValue({...stopped,revision:1,visible:false});await render();await act(async()=>mock.shortcut!({payload:{ok:false}}));expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be stopped");expect(container.querySelector("button")!.disabled).toBe(false);
 read.mockResolvedValue(stopped);await act(async()=>container.querySelector("button")!.click());expect(container.textContent).toBe("");
});
it("keeps original-source failure unknown and retryable without claiming stopped or disclosing stale action",async()=>{
 read.mockResolvedValue({...active,status:{...active.status!,currentAction:{app:"Editor",action:"click"}}});await render();stop.mockRejectedValueOnce(new Error("Original Host changed"));await act(async()=>container.querySelector("button")!.click());
 expect(container.querySelector('[role="status"]')?.textContent).toContain("Status unavailable");expect(container.textContent).not.toContain("Editor");expect(container.querySelector("button")!.disabled).toBe(false);expect(container.textContent).not.toContain("Stopped");
});
it("shows confirmed stopped feedback only in the floating strip and dismisses without any input or new Stop",async()=>{
 const dismiss=vi.fn();read.mockResolvedValue(stopped);await render({floating:true,onDismiss:dismiss});expect(container.querySelector('[role="status"]')?.textContent).toContain("Stopped");await act(async()=>container.querySelector("button")!.click());expect(dismiss).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();
});
