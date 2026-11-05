import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import { ToolsWorkspace, dockHostTools } from "../../src/features/host-tools/ToolsWorkspace";
import HostToolsWindow from "../../src/features/host-tools/HostToolsWindow";
import type { ToolsSession } from "../../src/features/host-tools/toolsSessionRegistry";
import { calls } from "./host-tools-mocks";
import "../../src/styles/index.css";
const query = new URLSearchParams(location.search);
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
    cwd: "remote://mac/Users/demo/Studio",
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
  const [active, setActive] = useState(sessions[0]);
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
          <p>Conversation content</p>
        </div>
      </ToolsWorkspace>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  query.get("role") === "hub" ? <HostToolsWindow {...sessions[0]} /> : <Source />,
);
