export const DESKTOP_STOP_COMMAND="App: Stop computer use";
export const DESKTOP_STOP_DEFAULT_SHORTCUT="Control+Option+Escape";

/** Shares the ordinary override store, including explicit disabling and Reset. */
export function desktopStopShortcut(overrides:Record<string,{disabled?:boolean;shortcut?:string}>):string|null {
  const value=overrides[DESKTOP_STOP_COMMAND];
  return value?.disabled?null:value?.shortcut??DESKTOP_STOP_DEFAULT_SHORTCUT;
}
