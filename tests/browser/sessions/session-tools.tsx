import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { setLanguagePreference, setDomainLanguagePreference } from "../../../src/shared/i18n";
import { Button } from "../../../src/shared/ui/Button";
import { ToolsWorkspace, dockHostTools } from "../../../src/features/host-tools/ToolsWorkspace";
import HostToolsWindow from "../../../src/features/host-tools/HostToolsWindow";
import type { ToolsSession } from "../../../src/features/host-tools/toolsSessionRegistry";
import { calls } from "../host-tools/host-tools-mocks";
import { AgentTranscript } from "../../../src/features/sessions/ui/AgentTranscript";
import type { Block } from "../../../src/features/sessions/model/session";
import { rememberRemoteSession } from "../../../src/features/connections/model/connections";
import "../../../src/styles/index.css";
const query = new URLSearchParams(location.search);
const remotePreview = query.has("remote-preview");
if (query.get("role") === "source" && query.get("shared-device") === "1")
  localStorage.removeItem("session-tools.fixture-device-runtime");
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");
await setLanguagePreference("en");
await setDomainLanguagePreference("technical", "en");
Object.assign(window, { sessionToolsCalls: calls });
const sessions: ToolsSession[] = [
  {
    cwd: "G:/demo/Atlas",
    sessionId: "host-atlas",
    composerSessionId: "composer-atlas",
    composerWindow: "main",
    title: "Refine project navigation",
    projectName: "Atlas",
    status: "Working",
    branch: "feature/session-tools",
    model: "codex · GPT-6",
    initialTab: "browser",
  },
  {
    cwd: remotePreview
      ? "remote://fixture-mac-env/Users/demo/Studio"
      : "remote://mac/Users/demo/Studio",
    sessionId: "host-studio",
    composerSessionId: "composer-studio",
    composerWindow: "main",
    title: "Check mobile sign-in",
    projectName: "Studio",
    status: "Interrupted",
    model: "claude · Sonnet",
    initialTab: "browser",
  },
  {
    cwd: "G:/demo/Notes",
    sessionId: "host-empty",
    composerSessionId: "composer-empty",
    composerWindow: "main",
    title: "New conversation",
    projectName: "Notes",
    status: "Idle",
  },
];
function Source() {
  const [active, setActive] = useState(sessions[remotePreview ? 1 : 0]);
  useEffect(() => {
    dockHostTools(sessions[0]);
    dockHostTools(sessions[1]);
  }, []);
  return (
    <div className="flex h-full flex-col bg-background text-content">
      <div className="flex gap-2 border-b border-stroke p-2">
        {sessions.map((session) => (
          <Button
            key={session.sessionId}
            size="sm"
            variant="ghost"
            aria-pressed={active.sessionId === session.sessionId}
            onClick={() => setActive(session)}
          >
            {session.projectName}
          </Button>
        ))}
      </div>
      <ToolsWorkspace activeConversation={active} accessibleSessions={sessions}>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <h1>{active.title}</h1>
          <p>{active.cwd}</p>
          {remotePreview && active.sessionId === "host-studio" ? (
            <AgentTranscript
              cwd={active.cwd}
              sessionId={active.composerSessionId}
              blocks={[
                {
                  id: "remote-preview-links",
                  role: "assistant",
                  text: "[Open patient panel](http://localhost:3019/patients?view=active#list)\n\n[Open appointments](http://localhost:3019/appointments)",
                },
              ]}
            />
          ) : (
            <p>Conversation content</p>
          )}
        </div>
      </ToolsWorkspace>
    </div>
  );
}
if (remotePreview) rememberRemoteSession("composer-studio", "host-studio");
const resultBlocks: Block[] = [
  { id: "check", role: "user", text: "Check the filter and run the focused tests." },
  {
    id: "filter",
    role: "tool",
    text: "Edit src/filters.ts",
    tool: {
      title: "Edit src/filters.ts",
      status: "completed",
      preview: {
        kind: "write",
        path: "G:/demo/Atlas/src/filters.ts",
        inspection: { kind: "diff", text: "-return rows;\n+return rows.filter(matchesQuery);" },
      },
    },
  },
  {
    id: "test",
    role: "tool",
    text: "pnpm test src/filters.test.ts",
    tool: {
      status: "failed",
      detail: "Filter regression: expected 2 matching rows, received 3.",
    },
  },
  {
    id: "review",
    role: "assistant",
    text: "Updated the filter. The focused test still finds one extra row when the query is empty.",
  },
];

function ResultsSource() {
  const [openFile, setOpenFile] = useState("");
  return (
    <main className="flex h-full flex-col bg-background text-content">
      <AgentTranscript
        blocks={resultBlocks}
        cwd="G:/demo/Atlas"
        sessionId="work-results-fixture"
        onOpenDiff={setOpenFile}
      />
      {openFile && <p>{openFile}</p>}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  query.has("work-results") ? (
    <ResultsSource />
  ) : query.get("role") === "hub" ? (
    <HostToolsWindow {...sessions[0]} />
  ) : (
    <Source />
  ),
);
