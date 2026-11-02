import {invoke} from "@tauri-apps/api/core";
import {getCurrentWebviewWindow} from "@tauri-apps/api/webviewWindow";
import {z} from "zod";
export const DESKTOP_INDICATOR_EVENT="desktop_control_indicator_state";
const action=z.strictObject({app:z.string().max(200),action:z.string().max(80)});
export const DesktopIndicatorViewSchema=z.strictObject({revision:z.number().int().nonnegative(),status:z.strictObject({enabled:z.boolean(),active:z.boolean(),stopped:z.boolean(),currentAction:action.optional(),assistantName:z.string().max(80).optional()}).nullable(),statusError:z.boolean(),stopError:z.boolean(),stopping:z.boolean(),visible:z.boolean()});
export type DesktopIndicatorView=z.infer<typeof DesktopIndicatorViewSchema>;
export type DesktopIndicatorPort={read:()=>Promise<DesktopIndicatorView>;stop:()=>Promise<void>;subscribe:(receive:(state:DesktopIndicatorView)=>void)=>Promise<()=>void>};
export const nativeDesktopIndicatorPort:DesktopIndicatorPort={
 read:async()=>DesktopIndicatorViewSchema.parse(await invoke("desktop_control_indicator_state")),
 stop:()=>invoke("desktop_control_indicator_stop"),
 subscribe:receive=>getCurrentWebviewWindow().listen<unknown>(DESKTOP_INDICATOR_EVENT,event=>{const parsed=DesktopIndicatorViewSchema.safeParse(event.payload);if(parsed.success)receive(parsed.data);}),
};
