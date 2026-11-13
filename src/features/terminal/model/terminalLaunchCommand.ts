// Transient: restoring a terminal must never rerun a saved project action.
const commands = new Map<string, string>();
export type TerminalRunShellKind = "powershell" | "posix" | "cmd";
export type TerminalRun = {
  command: string;
  shellKind: TerminalRunShellKind;
  onOutput(data: string): void;
  onExit(code: number | null): void;
  onError(message: string): void;
};
const runs = new Map<string, TerminalRun>();

/** One-shot process input stays in memory and is never restored with a tab. */
export function queueTerminalRun(id: string, run: TerminalRun): void {
  if (runs.has(id)) throw new Error("Terminal command is already queued.");
  runs.set(id, run);
}

export function takeTerminalRun(id: string): TerminalRun | undefined {
  const run = runs.get(id);
  runs.delete(id);
  return run;
}

/** Abandon a terminal that could not be opened, without executing its code. */
export function discardTerminalRun(id: string): void {
  runs.delete(id);
}
export function queueTerminalCommand(id: string, command: string): void {
  commands.set(id, command);
}
export function takeTerminalCommand(id: string): string | undefined {
  const command = commands.get(id);
  commands.delete(id);
  return command;
}
