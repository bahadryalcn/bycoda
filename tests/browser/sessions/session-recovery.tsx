import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionRecoveryPanel } from "../../../src/app/shell/SessionRecoveryPanel";
import { SessionRecoveryControl } from "../../../src/app/shell/SessionRecoveryControl";
import { Sidebar } from "../../../src/app/shell/Sidebar";
import { ProjectRail } from "../../../src/app/shell/ProjectRail";
import { WorkspaceControls } from "../../../src/app/shell/WorkspaceControls";
import { newSession } from "../../../src/features/sessions/model/session";
import type { SessionSummary } from "../../../src/features/sessions/data/sessionStore";
import { saveSessionFolders } from "../../../src/features/sessions/model/sessionFolders";
import { markTurnInterrupted } from "../../../src/features/sessions/model/inFlight";
import { newTab } from "../../../src/features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../../src/features/workspace/model/workspaceSnapshot";
import {
  captureSessionRecovery,
  removeRecoverySessions,
  RecoveryOpenError,
  type SessionRecovery,
} from "../../../src/features/workspace/model/sessionRecovery";
import { remotePath } from "../../../src/features/connections/model/remoteProjects";
import type { RemoteRailSession } from "../../../src/features/connections/model/remoteRailSessions";
import { hideGroup } from "../../../src/features/group-lock/model/groupLock";
import {
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../../../src/features/projects/model/projectGroups";
import { pathKey } from "../../../src/shared/lib/paths";
import "../support/w7-shell.css";
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
/**
 * `?states`: one row per recovery state with fake data only. Local rows that are not in `sessions` are
 * read from the (absent) session store, so they show the verification-failed state; a remote row with a
 * fresh host summary shows its host status, one without shows "not verified"; a row in a hidden group
 * never appears. `?openFail=partial|ack|total` and `?removeFail` make the actions fail.
 */
const STATES_ENV = "fixture-env";
const statesParams = new URLSearchParams(location.search);
const statesMode = statesParams.has("states");
const remoteStub = (index: number, remoteSessionId: string, title: string) => ({
  ...sessions[index],
  id: `remote-${remoteSessionId}`,
  cwd: remotePath(STATES_ENV, `/srv/app-${index}`),
  title,
  remoteSessionId,
});
function buildStatesFixture(): {
  recovery: SessionRecovery;
  shown: typeof sessions;
  remote: RemoteRailSession[];
} {
  saveProjectGroups([{ id: "g-hidden", name: "Hidden group", collapsed: false, lockable: true }]);
  saveProjectGroupAssignments({ [pathKey("/projects/hidden")]: "g-hidden" });
  hideGroup("g-hidden");
  const local = sessions.slice(0, 8);
  const hidden = {
    ...sessions[8],
    id: "hidden-1",
    cwd: "/projects/hidden",
    title: "Hidden group chat",
  };
  const unread = {
    ...sessions[9],
    id: "unread-1",
    title: "Conversation whose record cannot be read",
  };
  const longName = {
    ...sessions[10],
    id: "long-1",
    title:
      "A very long recovered conversation title that keeps going to prove that the row wraps instead of pushing the Open action out of the dialog",
    cwd: "/projects/a-very-long-project-folder-name/with/many/nested/segments/that/never/fit/on/one/line",
  };
  // `?states&calm`: only records that do not need attention, so the attention filter is empty.
  const all = statesParams.has("calm")
    ? [sessions[6], sessions[7]]
    : [...local, hidden, unread, longName];
  const tabsAll = all.map((session) => newTab(session.id));
  const base = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot(tabsAll, all, tabsAll[0].id, all[0].cwd, new Map()),
  )!;
  const remoteStubs = statesParams.has("calm")
    ? []
    : [
        remoteStub(11, "host-working", "Remote build (fresh host status)"),
        remoteStub(12, "host-stale", "Remote chat (cached status)"),
        remoteStub(13, "host-input", "Remote chat waiting for input"),
      ];
  const remote: RemoteRailSession[] =
    remoteStubs.length === 0
      ? []
      : [
          {
            project: remoteStubs[0].cwd,
            fresh: true,
            session: {
              id: "host-working",
              title: remoteStubs[0].title,
              harness: "codex",
              status: "running",
              updatedAt: Date.now() - 30_000,
              revision: 1,
              projectId: "p",
            } as never,
          },
          {
            project: remoteStubs[2].cwd,
            fresh: true,
            session: {
              id: "host-input",
              title: remoteStubs[2].title,
              harness: "codex",
              status: "idle",
              needsInput: true,
              updatedAt: Date.now() - 90_000,
              revision: 1,
              projectId: "p",
            } as never,
          },
        ];
  return {
    recovery: {
      ...base,
      workspace: { ...base.workspace, sessions: [...base.workspace.sessions, ...remoteStubs] },
    },
    // The unread record is deliberately missing from the open sessions.
    shown: all.filter((session) => session.id !== "unread-1"),
    remote,
  };
}
const statesFixture = statesMode ? buildStatesFixture() : null;

function Fixture() {
  const [journal, setJournal] = useState(statesFixture?.recovery ?? recovery);
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState("");
  const params = new URLSearchParams(location.search);
  const openFail = params.get("openFail");
  const removeFail = params.has("removeFail");
  return (
    <main className="h-dvh bg-background-base p-4 text-content">
      <button onClick={() => setOpen(true)}>Recovered sessions 24</button>
      <output data-testid="opened">{result}</output>
      {open ? (
        <SessionRecoveryPanel
          recovery={journal}
          sessions={statesFixture?.shown ?? sessions}
          remoteSessions={statesFixture?.remote ?? []}
          onClose={() => setOpen(false)}
          onOpen={async (ids, layout) => {
            setResult(JSON.stringify({ ids, layout }));
            if (openFail === "partial")
              throw new RecoveryOpenError(ids.slice(0, 1), ids.slice(1, 2), ids.slice(2));
            if (openFail === "ack") throw new RecoveryOpenError(ids, [], [], true);
            if (openFail === "total") throw new Error("Fixture failure");
            if (new URLSearchParams(location.search).has("hold")) {
              await new Promise<void>((resolve) => {
                Object.assign(window, { finishRecovery: resolve });
              });
            }
          }}
          onRemove={async (ids) => {
            if (removeFail) throw new Error("Fixture failure");
            setJournal((current) => removeRecoverySessions(current, ids));
          }}
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
