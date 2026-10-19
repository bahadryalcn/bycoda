import type { Terminal } from "@xterm/xterm";
import { terminalSuggestions } from "./terminalSuggestions";

/** Only echoed text at an ordinary local shell prompt. No input history or storage. */
export function localTerminalPrefix(terminal: Terminal) {
  const buffer = terminal.buffer.active;
  if (buffer.type !== "normal" || buffer.viewportY !== buffer.baseY) return null;
  if (terminal.hasSelection?.()) return null;
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  if (!line || line.isWrapped) return null;
  // Appending is safe only at the end of the echoed line. Never replace a draft.
  if (line.translateToString(true, buffer.cursorX).trim()) return null;
  const before = line.translateToString(false, 0, buffer.cursorX);
  // Common Bash/Zsh/PowerShell/cmd prompts, including decorated Git Bash prompts.
  const match = /(?:^|.*\s)(?:[$%#❯➜]|>|[^\r\n>]*>) ([^\r\n]*)$/.exec(before);
  const prefix = match?.[1];
  if (!prefix?.trim()) return null;
  return prefix;
}

export function safeHistoryCommand(value: string): boolean {
  return (
    value.length <= 2048 &&
    !!value.trim() &&
    !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) &&
    !/password|passwd|token|secret|credential|authorization|api_?key|private key|:\/\/|\.env|\.ssh[\\/]/i.test(
      value,
    ) &&
    !value.split(/\s+/).some((word) => word.includes("=") && !word.startsWith("-"))
  );
}

export function localTerminalCompletion(terminal: Terminal, candidates: readonly string[] = []) {
  const prefix = localTerminalPrefix(terminal);
  if (!prefix || !safeHistoryCommand(prefix)) return null;
  const leading = prefix.slice(0, prefix.length - prefix.trimStart().length);
  const suggestions = [
    ...new Set([
      ...candidates.filter(
        (value) => value.startsWith(prefix) && value !== prefix && safeHistoryCommand(value),
      ),
      ...terminalSuggestions(prefix).map((value) => leading + value),
    ]),
  ].slice(0, 12);
  return suggestions.length ? { prefix, suggestions } : null;
}
