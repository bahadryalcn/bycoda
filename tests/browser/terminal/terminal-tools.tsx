import { useState } from "react";
import { ProjectTerminalDock } from "../../../src/features/terminal/ui/ProjectTerminalDock";
import type { ProjectTerminalDock as Dock } from "../../../src/features/projects/model/projectTerminal";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { TerminalView } from "../../../src/features/terminal/ui/TerminalView";
import "../../../src/styles/index.css";
import "../../../src/features/terminal/ui/terminal.css";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { RemoteSuggestionsFixture } from "./terminal-remote-suggestions";
import { CodeTerminalDialog } from "../../../src/features/terminal/ui/CodeTerminalDialog";
import { queueTerminalRun } from "../../../src/features/terminal/model/terminalLaunchCommand";
import type {
  CodeTerminalController,
  CodeTerminalState,
} from "../../../src/features/terminal/runtime/codeTerminalController";

const params = new URLSearchParams(location.search);
const fixtureCommand = "sleep 30";
const sshProject = params.has("project-ssh")
  ? { environmentId: "windows-fixture", cwd: "G:/Projects/demo" }
  : undefined;
if (sshProject) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {
      invoke: async (method: string, input: unknown) => {
        if (method !== "ssh_terminal_spawn") throw new Error(`Unexpected native call ${method}`);
        document.documentElement.dataset.projectSshLaunch = JSON.stringify(input);
        document.dispatchEvent(
          new CustomEvent("test-pty-output", { detail: "PS G:\\Projects\\demo> " }),
        );
      },
    },
  });
}
if (params.has("silent-code"))
  queueTerminalRun("fixture", {
    command: fixtureCommand,
    shellKind: "posix",
    onOutput() {},
    onExit() {},
    onError() {},
  });
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
// Observe public xterm selection events without adding test APIs to the product.
const open = Terminal.prototype.open;
Terminal.prototype.open = function (element) {
  open.call(this, element);
  this.onRender(() => {
    document.documentElement.dataset.terminalTypography = JSON.stringify({
      fontSize: this.options.fontSize,
      fontFamily: this.options.fontFamily,
      fontWeight: this.options.fontWeight,
      lineHeight: this.options.lineHeight,
    });
  });
  this.onWriteParsed(() => {
    const buffer = this.buffer.active;
    if (params.has("silent-code") && buffer.getLine(0)?.translateToString(true))
      document.documentElement.dataset.terminalCommand = buffer.getLine(0)?.translateToString(true);
    document.documentElement.dataset.terminalPrompt = buffer
      .getLine(buffer.baseY + buffer.cursorY)
      ?.translateToString(true);
  });
  this.onSelectionChange(() => {
    document.documentElement.dataset.terminalSelection = this.getSelection();
    document.documentElement.dataset.terminalPosition = JSON.stringify(this.getSelectionPosition());
  });
};
function SplitDockFixture() {
  const silentCode = params.has("silent-code") || !!sshProject;
  const projectPath = sshProject ? "remote://windows-fixture/G:/Projects/demo" : "/fixture";
  const [dock, setDock] = useState<Dock>({
    projectPath,
    side: "bottom",
    size: 600,
    open: true,
    splitGroups: silentCode ? undefined : [["fixture", "fixture-two"]],
    pane: {
      id: "fixture-pane",
      activeFileId: "fixture",
      files: [
        { id: "fixture", path: "Terminal 1", cwd: projectPath, terminal: true },
        ...(silentCode
          ? []
          : [{ id: "fixture-two", path: "Terminal 2", cwd: "/fixture", terminal: true }]),
      ],
    },
    ...(sshProject
      ? { sshShells: { fixture: { connectionId: "windows-machine", project: sshProject } } }
      : {}),
  });
  return (
    <div style={{ height: silentCode ? 256 : "90dvh", width: "100%", display: "grid" }}>
      <ProjectTerminalDock
        dock={dock}
        focused
        onFocus={() => {}}
        onHide={() => {}}
        onSideChange={(side) => setDock((value) => ({ ...value, side }))}
        onSizePaint={() => {}}
        onSizeCommit={() => {}}
        onAddTerminal={() => {}}
        onAddTerminalWithProfile={() => {}}
        onSplitTerminal={() => {}}
        onCloseTerminal={(id) => {
          document.documentElement.dataset.closedTerminal = id;
        }}
        onCloseTerminals={(keepId) => {
          document.documentElement.dataset.closedTerminal = keepId ? `except:${keepId}` : "all";
        }}
        onReorderTerminals={() => {}}
        onSelectTerminal={(id) =>
          setDock((value) => ({ ...value, pane: { ...value.pane, activeFileId: id } }))
        }
      />
    </div>
  );
}
// `?code-terminal=running|exited|failed|unknown` renders the real dialog over a memory-only controller.
function CodeTerminalFixture({ phase }: { phase: string }) {
  const inDock = params.has("code-dock");
  const [controller] = useState(() => {
    const state: CodeTerminalState = {
      id: "fixture-code",
      phase: phase === "running" ? "running" : phase === "unknown" ? "unknown" : "exited",
      shell: "PowerShell",
      output:
        inDock && phase === "running"
          ? ""
          : "> pnpm test\r\n RUN  v3.2.0\r\n ✓ src/a.test.ts (4)\r\n ✗ src/b.test.ts (1)\r\n   Expected 2, received 3\r\n",
      truncated: false,
      exitCode: phase === "exited" ? 0 : phase === "failed" ? 1 : null,
      ...(phase === "unknown" ? { error: "Stop requested. Command completion is unknown." } : {}),
    };
    return {
      subscribe: () => () => {},
      snapshot: () => state,
      canDismiss: () => state.phase === "exited",
      refresh: async () => "idle" as const,
      stop: async () => {},
    } as unknown as CodeTerminalController;
  });
  const projectPath = inDock ? "remote://fixture/demo" : "G:/demo/example";
  const run = {
    controller,
    options: {
      cwd: projectPath,
      projectCwd: projectPath,
      native: false,
      command: inDock ? fixtureCommand : "pnpm test",
      shellKind: inDock ? ("posix" as const) : ("powershell" as const),
      isCurrent: () => true,
    },
    onReport: params.has("no-report") ? undefined : () => true,
  };
  if (!inDock) return <CodeTerminalDialog {...run} onClose={() => {}} />;
  const id = controller.snapshot().id;
  return (
    <div className="h-64 w-full">
      <ProjectTerminalDock
        dock={{
          projectPath,
          size: 256,
          side: "bottom",
          open: true,
          pane: {
            id: "fixture-pane",
            activeFileId: id,
            files: [{ id, cwd: projectPath, path: "Code block", terminal: true }],
          },
          remoteRuns: { [id]: run },
        }}
        focused
        onFocus={() => {}}
        onHide={() => {}}
        onSideChange={() => {}}
        onSizePaint={() => {}}
        onSizeCommit={() => {}}
        onCloseTerminal={() => {}}
        onCloseTerminals={() => {}}
        onReorderTerminals={() => {}}
        onSelectTerminal={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("code-terminal") ? (
    <CodeTerminalFixture phase={params.get("code-terminal") || "exited"} />
  ) : params.has("dock") || sshProject ? (
    <SplitDockFixture />
  ) : params.has("remote") ? (
    <RemoteSuggestionsFixture />
  ) : (
    <div className="project-terminal-dock" style={{ height: "90dvh", width: "100%" }}>
      <TerminalView id="fixture" cwd="/fixture" active />
    </div>
  ),
);
