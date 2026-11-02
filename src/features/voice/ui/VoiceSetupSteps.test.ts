// @vitest-environment happy-dom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
const runtime=vi.hoisted(()=>({callbacks:null as any,construct:vi.fn(),close:vi.fn(),inspect:vi.fn(),secret:vi.fn()}));
vi.mock("../model/localVoice",()=>({LocalVoice:class{constructor(callbacks:unknown){runtime.callbacks=callbacks;runtime.construct();}connect=async()=>{};close=runtime.close;}}));
vi.mock("../model/localVoiceClient",()=>({localVoiceBackend:{inspect:runtime.inspect}}));
vi.mock("../model/realtimeVoiceClient",()=>({realtimeSecret:runtime.secret}));
vi.mock("./VoiceSettings",()=>({VoiceSettings:()=>null}));
import {VoiceSetupSteps} from "./VoiceSetupSteps";
import {loadVoiceSettings,saveVoiceSettings} from "../model/voiceSettings";
let root:Root|undefined,container:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;container?.remove();localStorage.clear();vi.clearAllMocks();});
async function render(step:"provider"|"microphone"){
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);const valid=vi.fn();
  await act(async()=>root!.render(createElement(VoiceSetupSteps,{step,onValidChange:valid,language:"tr-TR"})));return valid;
}
async function click(label:string){await act(async()=>[...container.querySelectorAll("button")].find(button=>button.textContent===label)!.click());}
it("requires an explicit microphone test and ignores a transcript delivered after Stop",async()=>{
  const valid=await render("microphone");expect(runtime.construct).not.toHaveBeenCalled();
  await click("Test microphone");expect(runtime.construct).toHaveBeenCalledOnce();await click("Stop");
  valid.mockClear();await act(async()=>runtime.callbacks.transcript({text:"stale sentence",language:"tr"}));
  expect(valid).not.toHaveBeenCalledWith(true);expect(runtime.close).toHaveBeenCalled();
});
it("does not verify a provider after its settings changed while the check was pending",async()=>{
  let finish!:(value:unknown)=>void;runtime.inspect.mockImplementation(()=>new Promise(done=>{finish=done;}));
  const valid=await render("provider");await click("Check connection");
  await act(async()=>saveVoiceSettings({...loadVoiceSettings(),mode:"openai"}));valid.mockClear();
  await act(async()=>finish({ready:true,missing:[]}));expect(valid).not.toHaveBeenCalledWith(true);
});
