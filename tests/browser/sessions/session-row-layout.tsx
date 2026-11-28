import { useState, type ComponentProps } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mergeGlobalRecentSessions } from "../../../src/features/sessions/model/globalRecentSessions";
import { pathKey, projectKey } from "../../../src/shared/lib/paths";
import { LastSessionsRows } from "../../../src/app/shell/LastSessionsSection";
import { Sidebar } from "../../../src/app/shell/Sidebar";
import { setWorktreeFocus } from "../../../src/features/source-control/model/worktreeFocus";
import { remoteMachineFor } from "../../../src/features/connections/model/connections";
import { rememberRemoteProject } from "../../../src/features/connections/model/remoteProjects";
import { saveSessionFolders } from "../../../src/features/sessions/model/sessionFolders";
import { setSessionLifecycleList } from "../../../src/features/sessions/model/sessionLifecycleClient";
import type { SessionSummary } from "../../../src/features/sessions/data/sessionStore";
import {
  saveAutoTabGroupLabel,
  saveRailBackgrounds,
  saveTabGroupColor,
  saveTabGroupLabel,
  saveTabGroupMascot,
} from "../../../src/features/workspace/model/tabGroups";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  saveSessionListDisplay,
  type SessionListDensity,
} from "../../../src/features/sessions/model/sessionListDisplay";
import { LiveAgentsPreview } from "../../../src/features/sessions/ui/LiveAgentsPreview";
import type { SessionWait } from "../../../src/features/sessions/model/sessionWait";
import {
  applyThemePreference,
  saveSessionSidebarWidth,
} from "../../../src/features/settings/model/appearance";
import { languageReady } from "../../../src/shared/i18n";
import type { SessionLifecycleView } from "../../../src/features/sessions/model/sessionLifecycle";
import "./session-row-layout.css";

// Isolated browser-local history and preferences. No native writes or provider calls.
const params = new URLSearchParams(location.search);
if (params.has("wide-workspace")) saveSessionSidebarWidth(510);
if (params.has("remote-settle") || params.has("local-bulk-settle")) {
  mockWindows("main");
  const local = params.has("local-bulk-settle");
  const machineId = local ? "fixture-local-host" : "office";
  const remoteSessions = [
    { id: "office-session", title: "Remote project conversation" },
    ...(params.has("bulk")
      ? [
          { id: "office-second", title: "Second remote conversation" },
          { id: "office-third", title: "Unselected remote conversation" },
        ]
      : []),
    ...Array.from({ length: params.has("bulk-large") ? 257 : 0 }, (_, index) => ({
      id: `office-bulk-${index}`,
      title: `Remote conversation ${index + 2}`,
    })),
  ];
  const lifecycle = new Map<string, SessionLifecycleView>();
  mockIPC(
    (command, args) => {
      if (command === "local_host_connect" && local) return { id: machineId };
      if (command === "remote_machines") {
        return [
          {
            id: machineId,
            environmentId: local ? "fixture-local" : "fixture-office",
            name: local
              ? "This computer (local sync)"
              : params.has("worktree-picker")
                ? "Office Mac"
                : "Office",
            endpoint: local ? "http://127.0.0.1:12345" : "http://office.invalid",
          },
        ];
      }
      if (command !== "remote_request" || args.machineId !== machineId) return null;
      if (args.method === "environment.describe") {
        return {
          protocolVersion: 1,
          environmentId: "fixture-office",
          name: "Office",
          providers: [],
          capabilities: ["sessions.lifecycle.v2", "workspace.run"],
        };
      }
      if (args.method === "sessions.list") {
        return remoteSessions.map((row, index) => ({
          ...row,
          projectId: "fixture-project",
          revision: 1,
          status: "idle",
          harness: "codex",
          updatedAt: Date.now() - index * 1000,
        }));
      }
      if (args.method === "workspace.run" && params.has("worktree-picker")) {
        const command = (args.params as { command: string }).command;
        if (command === "git_worktrees") {
          return {
            defaultRoot: "/fixture/bycoda",
            worktrees: [
              { path: "/fixture/bycoda", branch: "main", isMain: true },
              { path: "/fixture/bycoda-feature", branch: "feature", isMain: false },
            ].map((tree) => ({
              ...tree,
              head: "abcdef",
              locked: false,
              prunable: false,
              missing: false,
              dirty: false,
              unpushed: 0,
              sessionIds: [],
            })),
          };
        }
        if (command === "git_submodules") return { paths: [] };
      }
      if (args.method === "sessions.lifecycle.list") {
        return {
          records: [...lifecycle.values()],
          autoSettle: { afterDays: 3 },
        };
      }
      if (args.method === "sessions.lifecycle.settle") {
        const { sessionId } = args.params as { sessionId: string };
        const view: SessionLifecycleView = {
          sessionId,
          state: "settled",
          settledAt: Date.now(),
          participants: [],
        };
        lifecycle.set(sessionId, view);
        return view;
      }
      if (args.method === "sessions.lifecycle.unsettle") {
        const { sessionId } = args.params as { sessionId: string };
        lifecycle.delete(sessionId);
        return { sessionId, state: "active", participants: [] };
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  await import("../../../src/features/connections/model/remoteCommands");
  await remoteMachineFor(local ? "fixture-local" : "fixture-office");
}
if (params.has("global-settle")) {
  mockIPC((command, args) => {
    if (command === "local_host_connect") return { id: "fixture-local-host" };
    if (
      command === "remote_request" &&
      args.machineId === "fixture-local-host" &&
      args.method === "sessions.lifecycle.settle"
    ) {
      const { sessionId } = args.params as { sessionId: string };
      return { sessionId, state: "settled", settledAt: Date.now(), participants: [] };
    }
    if (command === "remote_machines") return [];
    return null;
  });
}
const cwd = params.has("remote-header")
  ? rememberRemoteProject("fixture-office", {
      id: "fixture-project",
      cwd: "/fixture/bycoda",
      name: "bycoda",
    }).key
  : "/fixture/bycoda";
const now = Date.now();
if (params.has("virtual-folders")) {
  saveSessionFolders(cwd, [
    { id: "first", name: "First folder", sessionIds: ["virtual-0"], collapsed: false },
    { id: "closed", name: "Closed folder", sessionIds: ["virtual-1"], collapsed: true },
    { id: "next", name: "Next folder", sessionIds: ["virtual-2"], collapsed: false },
  ]);
}
// ?settled: the Host settled the long-titled row, so it files on the Settled shelf.
if (params.has("settled")) {
  setSessionLifecycleList({
    records: [{ sessionId: "row-long", state: "settled", participants: [], settledAt: now }],
    autoSettle: { afterDays: 3 },
  });
}
const demoCwd = "/fixture/demo-repo";
const demoWorktree = "/fixture/demo-repo-worktree";
saveTabGroupLabel(demoCwd, "demo-repo");
saveTabGroupColor(demoCwd, 5);
saveRailBackgrounds(demoCwd, { header: { color: "#774466", opacity: 22 } });
if (params.has("legacy-remote-label")) {
  saveTabGroupLabel(cwd, "");
  saveAutoTabGroupLabel(cwd, "bycoda (Office Mac)");
} else {
  saveTabGroupLabel(cwd, params.has("remote-header") ? "bycoda-cloud" : "bycoda");
}
saveTabGroupColor(cwd, 7);
saveTabGroupMascot(cwd, "cat");
saveRailBackgrounds(cwd, { header: { color: "#336677", opacity: 25 } });
const density = params.get("density") as SessionListDensity | null;
saveSessionListDisplay({ ...DEFAULT_SESSION_LIST_DISPLAY, density: density ?? "standard" });
applyThemePreference(params.has("light") ? "light" : "dark");
const initial: SessionSummary[] = [
  {
    id: "row-demo",
    cwd: demoCwd,
    worktreeCwd: demoWorktree,
    harness: "codex",
    model: "gpt-6.1",
    title: "Review demo repository changes",
    branch: "feature/demo",
    createdAt: now - 600000,
    updatedAt: now - 30000,
  },
  {
    id: "row-old",
    cwd: demoCwd,
    harness: "codex",
    model: "gpt-6.1",
    title: "Outside last seven days",
    createdAt: now - 9 * 86400000,
    updatedAt: now - 8 * 86400000,
  },
  {
    id: "row-multi",
    cwd,
    harness: "claude",
    model: "claude-sonnet-4-5",
    title: "Design System Clarity Review",
    interrupted: true,
    // The repository matches the project, so rows show the branch without a repeated prefix.
    repo: "bycoda",
    branch: "main",
    providerHistory: {
      providers: ["codex", "claude"] as ("claude" | "codex")[],
      activeHarness: "claude" as const,
      handedOffFrom: "codex" as const,
    },
    createdAt: now - 3_600_000,
    updatedAt: now - 180_000,
  },
  {
    id: "row-working",
    cwd,
    harness: "codex",
    model: "gpt-6.1",
    title: "Arif: 7/24 Sesli Asistan ve İş Takibi",
    managedBy: params.has("managed")
      ? { assistant: true as const, jobId: "fixture-job", managedAt: now }
      : undefined,
    branch: "feature/voice",
    createdAt: now - 7_200_000,
    updatedAt: now - 60_000,
  },
  {
    id: "row-long",
    cwd,
    harness: "codex",
    model: "gpt-6.1",
    title:
      "A deliberately very long conversation title with Unicode Türkçe 日本語 and a long unbreakabletokenxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    branch: "feature/averylongunbreakablebranchnamexxxxxxxxxxxxxxxxxxxxxxxxxx",
    createdAt: now - 86_400_000,
    updatedAt: now - 3_600_000,
  },
].map((row) => ({
  ...row,
  harness: row.harness as "claude" | "codex",
  runtimeMode: "supervised" as const,
}));
// ?statuses: one row per session status: the turn's own background commands read as
// working, delegated tasks and a pull request watch as "Waiting".
const statusRows: SessionSummary[] = [
  ["status-working", "Working on a refactor"],
  ["status-wait-commands", "Running a dev server"],
  ["status-wait-delegated", "Waiting on delegated tasks"],
  ["status-wait-pr", "Waiting on a pull request"],
  ["status-approval", "Needs your approval"],
  ["status-done", "Finished a review"],
].map(([id, title], index) => ({
  id,
  cwd,
  harness: "codex" as const,
  model: "gpt-6.1",
  title,
  branch: "feature/status",
  runtimeMode: "supervised" as const,
  createdAt: now - 7_200_000 + index,
  updatedAt: now - 60_000 * (index + 1),
}));
const statusWaits = new Map<string, SessionWait>([
  ["status-wait-commands", { kind: "commands", count: 2, since: now - 12 * 60_000 }],
  ["status-wait-delegated", { kind: "delegated", count: 1, since: now - 5 * 60_000 }],
  [
    "status-wait-pr",
    { kind: "pull-request", count: 1, since: now - 47 * 60_000, label: "owner/repo#12" },
  ],
]);
const statusLiveAgents = [
  {
    id: "status-working",
    cwd,
    title: "Working on a refactor",
    harness: "codex" as const,
    activity: "",
    startedAt: now - 9 * 60_000,
    needsApproval: false,
    done: false,
  },
  {
    id: "status-wait-commands",
    cwd,
    title: "Running a dev server",
    harness: "codex" as const,
    activity: "",
    startedAt: now - 12 * 60_000,
    needsApproval: false,
    done: false,
  },
];
// ?paged: 40 projects with 3000 deterministic sessions over 60 days, served by an in-memory
// catalog that hands out 30 rows of one project per loadMore, like the paged native history.
const PAGED_PAGE = 30;
const pagedProjects = params.has("paged")
  ? Array.from({ length: 40 }, (_, index) => {
      const projectCwd = `/fixture/p${String(index + 1).padStart(2, "0")}`;
      return { cwd: projectCwd, key: projectKey(projectCwd), sessions: [] as SessionSummary[] };
    })
  : [];
for (let index = 0; index < (pagedProjects.length ? 3000 : 0); index += 1) {
  const project = pagedProjects[index % pagedProjects.length];
  const updatedAt = now - Math.floor((index * 60 * 86_400_000) / 3000);
  project.sessions.push({
    id: `paged-${index}`,
    cwd: project.cwd,
    harness: "codex",
    model: "gpt-6.1",
    title: `Paged conversation ${index}`,
    runtimeMode: "supervised",
    createdAt: updatedAt - 600_000,
    updatedAt,
  });
}
const pagedLoading = new Set<string>();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [pagedLoaded, setPagedLoaded] = useState<Record<string, number>>({});
  const [history, setHistory] = useState(
    params.has("statuses")
      ? statusRows
      : params.has("two-rows")
        ? initial.filter((row) => row.id === "row-working" || row.id === "row-long")
        : params.has("virtual-folders")
          ? Array.from({ length: 100 }, (_, index) => ({
              ...initial[2],
              id: `virtual-${index}`,
              title: `Conversation ${index}`,
              pinned: index >= 5 && index < 10,
            }))
          : initial,
  );
  const [selected, setSelected] = useState("");
  const [projectCwd, setProjectCwd] = useState(params.has("projectless") ? "~" : cwd);
  const [gitCwd, setGitCwd] = useState(cwd);
  const [lastSessionsOpen, setLastSessionsOpen] = useState(params.has("global"));
  // The full history reaches the list; its default Last 7 days filter hides `row-old`.
  const pagedRows = pagedProjects.flatMap((project) =>
    project.sessions.slice(0, pagedLoaded[project.key] ?? 0),
  );
  const lastSessionsRows = mergeGlobalRecentSessions(
    pagedProjects.length ? pagedRows : history,
    [],
    [],
    new Set(
      pagedProjects.length
        ? pagedProjects.map((project) => pathKey(project.cwd))
        : [pathKey(cwd), pathKey(demoCwd)],
    ),
  );
  const pagedCatalog = pagedProjects.length
    ? {
        projects: pagedProjects.map((project) => ({
          key: project.key,
          cwd: project.cwd,
          count: project.sessions.length,
          latestActivityAt: project.sessions[0].updatedAt,
        })),
        settledCount: 0,
        segment: (key: string) => {
          const project = pagedProjects.find((item) => `project:${item.key}` === key);
          if (!project) return { status: "done" as const };
          if (pagedLoading.has(project.key)) return { status: "loading" as const };
          return {
            status:
              (pagedLoaded[project.key] ?? 0) >= project.sessions.length
                ? ("done" as const)
                : ("idle" as const),
          };
        },
        loadMore: (key: string) => {
          const project = pagedProjects.find((item) => `project:${item.key}` === key);
          if (!project || pagedLoading.has(project.key)) return;
          pagedLoading.add(project.key);
          setTimeout(() => {
            pagedLoading.delete(project.key);
            setPagedLoaded((loaded) => ({
              ...loaded,
              [project.key]: Math.min(
                project.sessions.length,
                (loaded[project.key] ?? 0) + PAGED_PAGE,
              ),
            }));
          }, params.has("paged-slow") ? 600 : 50);
        },
      }
    : undefined;
  const selectListedSession = (id: string, path: string) => {
    const row = history.find((row) => row.id === id && row.cwd === path);
    if (!row) return;
    setSelected(id);
    setProjectCwd(path);
    setGitCwd(row.worktreeCwd ?? path);
  };
  const [pinCount, setPinCount] = useState(0);
  const [reminderTarget, setReminderTarget] = useState("");
  const [createdProject, setCreatedProject] = useState("");
  const [createCount, setCreateCount] = useState(0);
  const [tab, setTab] = useState<ComponentProps<typeof Sidebar>["tab"]>("sessions");
  if (params.has("recent-row"))
    return (
      <QueryClientProvider client={client}>
        <div className="min-h-dvh bg-background-base p-4 text-content">
          <div
            className={`${params.has("narrow") ? "w-56" : "w-72"} rounded-lg border border-stroke bg-(--ui-surface) py-1`}
          >
            <LastSessionsRows
              rows={history
                .filter((row) => row.cwd === cwd)
                .map((row, index) => ({
                  ...row,
                  updatedAt: now - (index === 0 ? 260 : 180) * 60000,
                  pinned: !!row.pinned,
                  pinnable: true,
                  remote: false,
                  status: row.interrupted ? ("interrupted" as const) : undefined,
                }))}
              searchActive={false}
              activeSessionId={selected}
              onOpenSession={(id) => setSelected(id)}
              onOpenProject={() => {}}
              groupLabels={{}}
              groupColors={{}}
              groupCustomColors={{}}
              groupLogos={{}}
              groupMascots={{}}
            />
          </div>
          <output aria-label="Selected session">{selected}</output>
          <output aria-label="Pin operations">{pinCount}</output>
        </div>
      </QueryClientProvider>
    );
  return (
    <QueryClientProvider client={client}>
      <div className="flex h-dvh min-w-0 overflow-hidden bg-background-base text-content">
        <Sidebar
          cwd={projectCwd}
          gitCwd={gitCwd}
          onSelectWorkspace={(focus) => setWorktreeFocus(projectCwd, focus)}
          lastSessionsOpen={lastSessionsOpen}
          onOpenLastSessions={() => {
            setLastSessionsOpen(true);
            setTab("sessions");
          }}
          onCloseLastSessions={() => setLastSessionsOpen(false)}
          onSelectListedSession={selectListedSession}
          onNewListedSession={(path) => {
            if (params.has("create-error")) throw new Error("This project is no longer available.");
            setCreatedProject(path);
            setCreateCount((count) => count + 1);
            setProjectCwd(path);
            setGitCwd(path);
            if (path !== projectCwd) {
              setLastSessionsOpen(false);
              setTab("sessions");
            }
          }}
          lastSessionsData={{
            rows: params.has("empty") || params.has("loading") ? [] : lastSessionsRows,
            loading: params.has("loading"),
            error: params.has("error") ? "Fixture recent-history read failed" : null,
            refresh: () => {},
            catalog: pagedCatalog,
            setQuery: pagedCatalog ? () => {} : undefined,
          }}
          open
          projectRailOpen={params.has("wide")}
          compactProjectRail={!params.has("no-rail")}
          sessions={history.filter((row) => row.cwd === projectCwd)}
          busyProjectPaths={params.has("project-tooltip") ? [cwd] : undefined}
          busySessionIds={new Set(params.has("statuses") ? ["status-working"] : ["row-working"])}
          sessionWaits={params.has("statuses") ? statusWaits : undefined}
          unseenFinishedIds={params.has("statuses") ? new Set(["status-done"]) : undefined}
          approvalSessionIds={new Set(params.has("statuses") ? ["status-approval"] : [])}
          activeSessionId={selected || "row-multi"}
          status="idle"
          pending={false}
          onSelectSession={setSelected}
          onRenameSession={async (id, title) => {
            setHistory((rows) => rows.map((row) => (row.id === id ? { ...row, title } : row)));
          }}
          onRegenerateSessionTitle={async (id, path) => {
            if (params.has("title-error")) throw new Error("Fixture title provider unavailable");
            setHistory((rows) =>
              rows.map((row) =>
                row.id === id && row.cwd === path
                  ? { ...row, title: "Restore Draft Editing in Recovered Sessions" }
                  : row,
              ),
            );
          }}
          onSetSessionLinkedWorkItem={(id, linkedWorkItem) =>
            setHistory((rows) =>
              rows.map((row) => (row.id === id ? { ...row, linkedWorkItem } : row)),
            )
          }
          onSetReminders={(ids) => setReminderTarget(ids.join(","))}
          onArchiveSession={() => {}}
          onDeleteSession={() => {}}
          onPinSession={(id, pinned) => {
            setPinCount((value) => value + 1);
            setHistory((rows) => rows.map((row) => (row.id === id ? { ...row, pinned } : row)));
          }}
          onOpenFile={async () => {}}
          tab={tab}
          onTabChange={setTab}
          filesSearchOpen={false}
          onFilesSearchOpenChange={() => {}}
          recentSessions={{
            history,
            live: params.has("rail-header")
              ? history.map((session) => ({
                  ...session,
                  status: "done" as const,
                  activityAt: session.updatedAt,
                }))
              : [],
          }}
          recents={[
            { path: cwd, openedAt: now },
            { path: demoCwd, openedAt: now },
          ]}
          onSelectProject={(path) => {
            setProjectCwd(path);
            setGitCwd(path);
            setLastSessionsOpen(false);
            setTab("sessions");
          }}
          onOpenProject={() => {}}
          onOpenSettings={() => {}}
          onNew={() => {
            setCreatedProject(projectCwd);
            setCreateCount((count) => count + 1);
          }}
        />
        <main className="min-w-0 flex-1 p-8">
          <p className="text-ui-body">Session list layout fixture</p>
          {params.has("statuses") ? (
            <div className="mt-4 w-72 rounded-lg border border-stroke bg-(--ui-surface)">
              <LiveAgentsPreview agents={statusLiveAgents} />
            </div>
          ) : null}
          <output aria-label="Selected session">{selected}</output>
          <output aria-label="Selected Git checkout">{gitCwd}</output>
          <output aria-label="Last Sessions mode">{String(lastSessionsOpen)}</output>
          <output
            aria-label="Loaded rows"
            data-by-project={JSON.stringify(pagedLoaded)}
          >
            {pagedRows.length}
          </output>
          <output aria-label="Created project">{createdProject}</output>
          <output aria-label="Created sessions">{createCount}</output>
          <output aria-label="Pin operations">{pinCount}</output>
          <output aria-label="Reminder target">{reminderTarget}</output>
        </main>
      </div>
    </QueryClientProvider>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
