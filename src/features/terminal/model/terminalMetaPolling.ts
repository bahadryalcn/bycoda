/** Whether the title/foreground poll should read the PTY now. Process lookup
 * can fall back to `ps`, so only a terminal the user can see needs it; where the
 * backend reports it cannot name a foreground process, polling is pointless. */
export function shouldPollTerminalMeta(state: {
  onScreen: boolean;
  documentHidden: boolean;
  /** `false` once a status reply said `supported: false`. */
  supported: boolean;
}): boolean {
  return state.supported && state.onScreen && !state.documentHidden;
}
