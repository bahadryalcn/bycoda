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
import type {
  CodeTerminalController,
  CodeTerminalState,
} from "../../../src/features/terminal/runtime/codeTerminalController";

const params = new URLSearchParams(location.search);
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
  const [dock, setDock] = useState<Dock>({
    projectPath: "/fixture",
    side: "bottom",
    size: 600,
    open: true,
    splitGroups: [["fixture", "fixture-two"]],
    pane: {
      id: "fixture-pane",
      activeFileId: "fixture",
      files: [
        { id: "fixture", path: "Terminal 1", cwd: "/fixture", terminal: true },
        { id: "fixture-two", path: "Terminal 2", cwd: "/fixture", terminal: true },
      ],
    },
  });
  return (
    <div style={{ height: "90dvh", width: "100%", display: "grid" }}>
      <ProjectTerminalDock
        dock={dock}
        focused
        onFocus={() => {}}
        onHide={() => {}}
        onSideChange={() => {}}
        onSizePaint={() => {}}
        onSizeCommit={() => {}}
        onAddTerminal={() => {}}
        onCloseTerminal={() => {}}
        onCloseTerminals={() => {}}
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
  const [controller] = useState(() => {
    const state: CodeTerminalState = {
      id: "fixture-code",
      phase: phase === "running" ? "running" : phase === "unknown" ? "unknown" : "exited",
      shell: "PowerShell",
      output:
        "> pnpm test\r\n RUN  v3.2.0\r\n ✓ src/a.test.ts (4)\r\n ✗ src/b.test.ts (1)\r\n   Expected 2, received 3\r\n",
      truncated: false,
      exitCode: phase === "exited" ? 0 : phase === "failed" ? 1 : null,
      ...(phase === "unknown" ? { error: "Stop requested. Command completion is unknown." } : {}),
    };
    return {
      subscribe: () => () => {},
      snapshot: () => state,
      refresh: async () => "idle" as const,
      stop: async () => {},
    } as unknown as CodeTerminalController;
  });
  return (
    <CodeTerminalDialog
      controller={controller}
      options={{
        cwd: "G:/demo/example",
        projectCwd: "G:/demo/example",
        native: false,
        command: "pnpm test",
        shellKind: "powershell",
        isCurrent: () => true,
      }}
      onClose={() => {}}
      onReport={params.has("no-report") ? undefined : () => true}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("code-terminal") ? (
    <CodeTerminalFixture phase={params.get("code-terminal") || "exited"} />
  ) : params.has("dock") ? (
    <SplitDockFixture />
  ) : params.has("remote") ? (
    <RemoteSuggestionsFixture />
  ) : (
    <div className="project-terminal-dock" style={{ height: "90dvh", width: "100%" }}>
      <TerminalView id="fixture" cwd="/fixture" active />
    </div>
  ),
);
