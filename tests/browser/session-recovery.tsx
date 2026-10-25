import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionRecoveryPanel } from "../../src/app/shell/SessionRecoveryPanel";
import { SessionRecoveryControl } from "../../src/app/shell/SessionRecoveryControl";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { WorkspaceControls } from "../../src/app/shell/WorkspaceControls";
import { newSession } from "../../src/features/sessions/model/session";
import type { SessionSummary } from "../../src/features/sessions/data/sessionStore";
import { saveSessionFolders } from "../../src/features/sessions/model/sessionFolders";
import { markTurnInterrupted } from "../../src/features/sessions/model/inFlight";
import { newTab } from "../../src/features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../src/features/workspace/model/workspaceSnapshot";
import {
  captureSessionRecovery,
  removeRecoverySessions,
} from "../../src/features/workspace/model/sessionRecovery";
import "./w7-shell.css";
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
);

// Navigation-only fixture: no native commands, providers or real host sessions.
const sessions = Array.from({ length: 24 }, (_, index) => {
  const session = {
    ...newSession("codex", `/projects/project-${index % 3}`),
    id: `session-${index}`,
    title: `Recovered conversation ${index + 1}`,
    model: "GPT-6",
    blocks: [
      {
        id: `user-${index}`,
        role: "user" as const,
        text: "Fixture conversation",
        startedAt: Date.now() - 120_000,
        durationMs: 10_000,
      },
    ],
  };
  return index < 3 ? markTurnInterrupted(session) : session;
});
sessions[3].blocks.push({
  id: "failure",
  role: "system",
  text: "Fixture provider failed",
  notice: "error",
});
sessions[4].busy = true;
sessions[5].blocks.push({
  id: "approval",
  role: "system",
  text: "Fixture approval",
  approval: { requestId: 1 },
});
const tabs = sessions.map((session) => newTab(session.id));
const recovery = captureSessionRecovery(
  null,
  collectWorkspaceSnapshot(tabs, sessions, tabs[0].id, sessions[0].cwd, new Map()),
)!;
function RailFixture() {
  const full = new URLSearchParams(location.search).has("full");
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(128);
  const [settings, setSettings] = useState("");
  return (
    <main className="flex h-dvh bg-background-base text-content">
      <ProjectRail
        cwd="/fixture"
        recents={
          full
            ? [
                {
                  path: "/projects/Long descriptive project name for narrow navigation",
                  openedAt: 2,
                },
                { path: "/projects/Another project", openedAt: 1 },
              ]
            : []
        }
        busyPaths={full ? new Set(["/fixture"]) : undefined}
        onSelectProject={() => {}}
        onOpenProject={() => {}}
        onSearch={() => {}}
        onTogglePanel={() => {}}
        onOpenSettings={() => setSettings("general")}
        onOpenServers={() => setSettings("servers")}
        onOpenInbox={() => setSettings("inbox")}
        onOpenNotes={() => setSettings("notes")}
        onOpenAutomations={() => setSettings("automations")}
        onOpenTasks={() => setSettings("tasks")}
        tasksActive={settings === "tasks"}
        recoveryControl={
          <SessionRecoveryControl
            count={count}
            onOpen={() => setOpen(true)}
            onClear={async () => setCount(0)}
          />
        }
      />
      <output data-testid="settings-destination" className="sr-only">
        {settings}
      </output>
      <div className="fixed [inset-block-end:0] [inset-inline-end:0]">
        <WorkspaceControls
          onHiddenGroups={() => setSettings("groupLock")}
          onPullRequests={() => {}}
          onUsage={() => {}}
        />
      </div>
      {open ? (
        <SessionRecoveryPanel
          recovery={recovery}
          sessions={sessions}
          remoteSessions={[]}
          onClose={() => setOpen(false)}
          onOpen={async () => {}}
          onRemove={async () => {}}
        />
      ) : null}
    </main>
  );
}
function SidebarFixture() {
  const [fullSessions] = useState<SessionSummary[]>(() => {
    if (!new URLSearchParams(location.search).has("full")) return [];
    saveSessionFolders("/fixture", [
      { id: "review", name: "Design review", sessionIds: ["list-1"], collapsed: false },
      {
        id: "nested",
        name: "Narrow screen checks",
        parentId: "review",
        sessionIds: ["list-2"],
        collapsed: false,
      },
    ]);
    return Array.from({ length: 6 }, (_, index) => ({
      id: `list-${index}`,
      cwd: "/fixture",
      harness: "codex",
      model: "gpt-6.1",
      runtimeMode: "supervised",
      title:
        index === 2
          ? "Nested review conversation"
          : `Conversation ${index + 1} with a descriptive project title`,
      createdAt: Date.now() - index * 10000,
      updatedAt: Date.now() - index * 10000,
      pinned: index === 0,
      issue: index === 4 ? "failed" : undefined,
    }));
  });
  const [recoveredCount, setRecoveredCount] = useState(40);
  const [tab, setTab] = useState<"sessions" | "files" | "changes" | "inbox">("sessions");
  const [railOpen, setRailOpen] = useState(false);
  return (
    <main className="flex h-dvh bg-background-base text-content">
      <Sidebar
        cwd="/fixture"
        open
        sessions={fullSessions}
        busySessionIds={new Set()}
        approvalSessionIds={new Set()}
        status="idle"
        pending={false}
        tab={tab}
        filesSearchOpen={false}
        projectRailOpen={railOpen}
        compactProjectRail
        onToggleProjectRail={() => setRailOpen((value) => !value)}
        onSelectSession={() => {}}
        onRenameSession={() => {}}
        onOpenFile={() => {}}
        onTabChange={setTab}
        onFilesSearchOpenChange={() => {}}
        onSelectProject={() => {}}
        onOpenProject={() => {}}
        recoveryControl={
          <SessionRecoveryControl
            count={recoveredCount}
            onOpen={() => {}}
            onClear={async () => setRecoveredCount(0)}
          />
        }
      />
      <output data-testid="active-sidebar-tab">{tab}</output>
    </main>
  );
}
function Fixture() {
  const [journal, setJournal] = useState(recovery);
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState("");
  return (
    <main className="h-dvh bg-background-base p-4 text-content">
      <button onClick={() => setOpen(true)}>Recovered sessions 24</button>
      <output data-testid="opened">{result}</output>
      {open ? (
        <SessionRecoveryPanel
          recovery={journal}
          sessions={sessions}
          remoteSessions={[]}
          onClose={() => setOpen(false)}
          onOpen={async (ids, layout) => {
            setResult(JSON.stringify({ ids, layout }));
            if (new URLSearchParams(location.search).has("hold")) {
              await new Promise<void>((resolve) => {
                Object.assign(window, { finishRecovery: resolve });
              });
            }
          }}
          onRemove={async (ids) => setJournal((current) => removeRecoverySessions(current, ids))}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("rail") ? (
    <RailFixture />
  ) : new URLSearchParams(location.search).has("sidebar") ? (
    <SidebarFixture />
  ) : (
    <Fixture />
  ),
);
