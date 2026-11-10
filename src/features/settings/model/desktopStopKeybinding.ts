export const DESKTOP_STOP_COMMAND = "App: Stop computer use";
export const DESKTOP_STOP_DEFAULT_SHORTCUT = "Control+Option+Escape";
/** OS-wide opt-in chord that shows the main window and starts voice talk; unset by default. */
export const DESKTOP_TALK_COMMAND = "Voice: Talk to assistant (global)";

/** Settings row for the Talk chord: no default binding. */
export const DESKTOP_TALK_ROW = {
  command: DESKTOP_TALK_COMMAND,
  keys: "",
  when: "Anywhere, even when hidden",
};

/** Commands whose chord is registered OS-wide by the native shell. */
export function isDesktopGlobal(command: string): boolean {
  return command === DESKTOP_STOP_COMMAND || command === DESKTOP_TALK_COMMAND;
}

/** OS-wide chords must carry Command or Control. */
export function requireGlobal(command: string, isGlobal: boolean): void {
  if (isDesktopGlobal(command) && !isGlobal)
    throw new Error("This shortcut needs Command or Control as a global hotkey");
}

type Overrides = Record<string, { disabled?: boolean; shortcut?: string }>;

/** Shares the ordinary override store, including explicit disabling and Reset. */
export function desktopStopShortcut(overrides: Overrides): string | null {
  const value = overrides[DESKTOP_STOP_COMMAND];
  return value?.disabled ? null : (value?.shortcut ?? DESKTOP_STOP_DEFAULT_SHORTCUT);
}

/** No default: the shortcut exists only after the owner records a chord. */
export function desktopTalkShortcut(overrides: Overrides): string | null {
  const value = overrides[DESKTOP_TALK_COMMAND];
  return value?.disabled ? null : (value?.shortcut ?? null);
}
