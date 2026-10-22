// Transient: restoring a terminal must never rerun a saved project action.
const commands = new Map<string, string>();
export function queueTerminalCommand(id: string, command: string): void {
  commands.set(id, command);
}
export function takeTerminalCommand(id: string): string | undefined {
  const command = commands.get(id);
  commands.delete(id);
  return command;
}
