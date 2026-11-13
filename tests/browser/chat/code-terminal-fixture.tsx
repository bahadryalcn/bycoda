import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { AgentTranscript } from "../../../src/features/sessions/ui/AgentTranscript";
import { TextareaField } from "../../../src/shared/ui/TextareaField";

let terminalId = "";
const launches: unknown[] = [];
mockWindows("main");
mockIPC(
  (command, args) => {
    if (command === "terminal_profiles")
      return {
        profiles: [{ id: "pwsh", name: "PowerShell", path: "pwsh", kind: "pwsh" }],
        defaultId: "pwsh",
      };
    if (command === "pty_spawn" || command === "pty_spawn_command") {
      terminalId = (args as { id: string }).id;
      launches.push(args);
    }
    if (command === "pty_status") return { foreground: false, command: null };
    return null;
  },
  { shouldMockEvents: true },
);
Object.assign(window, {
  codeTerminalLaunches: launches,
  finishCodeTerminal: async () => {
    await emit("pty-data", {
      id: terminalId,
      data: btoa("PowerShell fixture output\r\n"),
    });
    await emit("pty-exit", { id: terminalId, code: 7, outputComplete: true });
  },
});

/** Deterministic IPC fixture; never launches a real process. */
export function CodeTerminalFixture() {
  const [draft, setDraft] = useState("Keep my existing draft.");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <AgentTranscript
          sessionId="code-fixture"
          cwd="C:/fixture/project"
          harness="codex"
          codeExecution={{
            sessionId: "code-fixture",
            projectCwd: "C:/fixture/project",
            native: true,
          }}
          onAddToChat={(text) => setDraft((current) => `${current}\n\n${text}`)}
          blocks={[
            { id: "request", role: "user", text: "Run the command and keep the result." },
            {
              id: "reply",
              role: "assistant",
              text: "```powershell\nWrite-Output 'PowerShell fixture output'\nexit 7\n```\n\n```python\nprint('not a shell command')\n```",
            },
          ]}
        />
      </div>
      <div className="p-3">
        <TextareaField
          label="Chat draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    </div>
  );
}
