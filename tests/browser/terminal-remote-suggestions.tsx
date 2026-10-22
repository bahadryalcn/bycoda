/** Synthetic SSH snapshots with real xterm, cursor placement and suggestion UI. */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { TerminalTools, type TerminalTool } from "../../src/features/terminal/ui/TerminalTools";
import type {
  SshShellController,
  SshShellState,
} from "../../src/features/terminal/model/sshShellIntegration";

export function RemoteSuggestionsFixture() {
  const element = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [snapshot, setSnapshot] = useState<SshShellState>();
  const [mode, setMode] = useState<TerminalTool>(null);
  const line = useRef("");
  const refresh = () =>
    setSnapshot({
      id: "remote-fixture",
      status: "suggestions",
      shell: "bash",
      user: "ubuntu",
      host: "fixture",
      requestId: "fixture-request",
      prefix: line.current,
      cursor: line.current.length,
      suggestions: [
        "clear",
        "clear previous",
        "clear older",
        "git status",
        "git stash list",
      ].filter((value) => value.startsWith(line.current) && value !== line.current),
    });
  useEffect(() => {
    const term = new Terminal({ cols: 70, rows: 20, fontSize: 14 });
    term.open(element.current!);
    term.write("ubuntu@fixture:~$ ", () => setTerminal(term));
    const input = term.onData((data) => {
      if (data === "\r") {
        document.documentElement.dataset.remoteExecuted = line.current;
        line.current = "";
        term.write("\r\nubuntu@fixture:~$ ");
        setSnapshot(undefined);
      } else if (data === "\x7f") {
        line.current = line.current.slice(0, -1);
        term.write("\b \b", refresh);
      } else if (data.length && data.charCodeAt(0) >= 32) {
        line.current += data;
        term.write(data, refresh);
      }
    });
    term.focus();
    return () => {
      input.dispose();
      term.dispose();
    };
  }, []);
  const shell: SshShellController = {
    state: snapshot,
    waiting: false,
    error: "",
    automatic: true,
    source: "commands",
    request: async () => refresh(),
    dismiss: () => setSnapshot(undefined),
    accept: async (value) => {
      terminal?.input(value.slice(line.current.length));
      setSnapshot(undefined);
    },
    invalidate: () => {},
    setAutomatic: () => {},
    setSource: () => {},
    notifyInput: () => {},
    suspendAutomatic: () => {},
  };
  return (
    <div
      className="project-terminal-dock"
      onKeyDownCapture={(event) => {
        if (event.ctrlKey && event.key === " ") {
          event.preventDefault();
          setMode("remote");
          refresh();
        }
      }}
    >
      <TerminalTools
        terminalId="remote-fixture"
        terminal={terminal}
        mode={mode}
        onModeChange={setMode}
        ready
        suggestionsAllowed={false}
        remoteShell={shell}
      />
      <div ref={element} />
    </div>
  );
}
