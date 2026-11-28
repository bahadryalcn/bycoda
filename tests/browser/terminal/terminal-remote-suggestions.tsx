/** Synthetic SSH snapshots with real xterm, cursor placement and suggestion UI. */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { TerminalTools, type TerminalTool } from "../../../src/features/terminal/ui/TerminalTools";
import { RemoteShellSuggestionsOverlay } from "../../../src/features/terminal/ui/RemoteShellSuggestionsOverlay";
import type { SshShellController } from "../../../src/features/terminal/model/sshShellIntegration";

export function RemoteSuggestionsFixture() {
  const element = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [mode, setMode] = useState<TerminalTool>(null);
  const line = useRef("");
  const unavailable = new URLSearchParams(location.search).has("failed");
  // The prompt-time catalog the shell would have issued; the view filters it per keystroke.
  const catalog = ["clear", "clear previous", "clear older", "git status", "git stash list"];
  const matches = (prefix: string) =>
    catalog.filter((value) => value.startsWith(prefix) && value !== prefix);
  useEffect(() => {
    const term = new Terminal({ cols: 70, rows: 20, fontSize: 14 });
    term.open(element.current!);
    term.write("ubuntu@fixture:~$ ", () => setTerminal(term));
    // The remote echo arrives after the keystroke, as it does over SSH; xterm
    // would otherwise parse a synchronous write before the view sees the edit.
    const echo = (text: string) => queueMicrotask(() => term.write(text));
    const input = term.onData((data) => {
      if (data === "\r") {
        document.documentElement.dataset.remoteExecuted = line.current;
        line.current = "";
        echo("\r\nubuntu@fixture:~$ ");
      } else if (data === "\x7f") {
        line.current = line.current.slice(0, -1);
        echo("\b \b");
      } else if (data.length && data.charCodeAt(0) >= 32) {
        line.current += data;
        echo(data);
      }
    });
    term.focus();
    return () => {
      input.dispose();
      term.dispose();
    };
  }, []);
  const shell: SshShellController = {
    state: undefined,
    waiting: new URLSearchParams(location.search).has("waiting"),
    notice: new URLSearchParams(location.search).has("failed")
      ? "Remote shell integration is unavailable"
      : "",
    noticeDetails: new URLSearchParams(location.search).has("failed")
      ? "Fixture shell unavailable"
      : undefined,
    automatic: true,
    source: "commands",
    request: async () => {},
    dismiss: () => {
      setPreviewEpoch((value) => value + 1);
    },
    accept: async (value) => {
      terminal?.input(value.slice(line.current.length));
    },
    promptReady: !unavailable,
    previewEpoch,
    catalogMatches: matches,
    catalogSelection: (prefix) =>
      unavailable || prefix === null ? undefined : { prefix, suggestions: matches(prefix) },
    selectFromCatalog: (prefix) => !unavailable && prefix !== null,
    acceptCatalog: async (prefix, value) => {
      terminal?.input(value.slice(prefix.length));
      setPreviewEpoch((count) => count + 1);
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
      {terminal && (mode === null || mode === "remote") ? (
        <RemoteShellSuggestionsOverlay
          shell={shell}
          terminal={terminal}
          selectionMode={mode === "remote"}
          onClose={() => setMode(null)}
        />
      ) : null}
      <div ref={element} />
    </div>
  );
}
