import type { Terminal } from "@xterm/xterm";
import { terminalSuggestions } from "./terminalSuggestions";

/** Only echoed text at an ordinary local shell prompt. No input history or storage. */
export function localTerminalCompletion(terminal: Terminal) {
  const buffer = terminal.buffer.active;
  if (buffer.type !== "normal" || buffer.viewportY !== buffer.baseY) return null;
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  if (!line || line.isWrapped) return null;
  // Appending is safe only at the end of the echoed line. Never replace a draft.
  if (line.translateToString(true, buffer.cursorX).trim()) return null;
  const before = line.translateToString(false, 0, buffer.cursorX);
  // Common Bash/Zsh/PowerShell/cmd prompts, including decorated Git Bash prompts.
  const match = /(?:^|.*\s)(?:[$%#❯➜]|>|[^\r\n>]*>) ([^\r\n]*)$/.exec(before);
  const prefix = match?.[1];
  if (!prefix?.trim()) return null;
  const leading = prefix.slice(0, prefix.length - prefix.trimStart().length);
  const suggestions = terminalSuggestions(prefix).map((value) => leading + value);
  return suggestions.length ? { prefix, suggestions } : null;
}
