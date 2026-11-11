import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildGlobalRecentSessions } from "../../../src/features/sessions/model/globalRecentSessions";
import { pathKey } from "../../../src/shared/lib/paths";
import { LastSessionsRows } from "../../../src/app/shell/LastSessionsSection";
import { Sidebar } from "../../../src/app/shell/Sidebar";
import { saveSessionFolders } from "../../../src/features/sessions/model/sessionFolders";
import { setSessionLifecycleList } from "../../../src/features/sessions/model/sessionLifecycleClient";
import type { SessionSummary } from "../../../src/features/sessions/data/sessionStore";
import {
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
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { languageReady } from "../../../src/shared/i18n";
import "./session-row-layout.css";

// Isolated browser-local history and preferences. No native writes or provider calls.
const params = new URLSearchParams(location.search);
const cwd = "/fixture/bycoda";
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
saveTabGroupLabel(cwd, "bycoda");
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
// ?statuses: one row per session status, including the three "Waiting" reasons.
const statusRows: SessionSummary[] = [
  ["status-working", "Working on a refactor"],
  ["status-wait-commands", "Waiting on a dev server"],
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
    title: "Waiting on a dev server",
    harness: "codex" as const,
    activity: "",
    startedAt: now - 12 * 60_000,
    needsApproval: false,
    done: false,
    waiting: statusWaits.get("status-wait-commands"),
  },
];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
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
  const [projectCwd, setProjectCwd] = useState(cwd);
  const [gitCwd, setGitCwd] = useState(cwd);
  const [lastSessionsOpen, setLastSessionsOpen] = useState(params.has("global"));
  const lastSessionsRows = buildGlobalRecentSessions(
    history,
    [],
    [],
    new Set([pathKey(cwd), pathKey(demoCwd)]),
    now,
  );
  const selectListedSession = (id: string, path: string) => {
    const row = history.find((row) => row.id === id && row.cwd === path);
    if (!row) return;
    setSelected(id);
    setProjectCwd(path);
    setGitCwd(row.worktreeCwd ?? path);
  };
  const [pinCount, setPinCount] = useState(0);
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
          }}
          lastSessionsData={{
            rows: params.has("empty") || params.has("loading") ? [] : lastSessionsRows,
            loading: params.has("loading"),
            error: params.has("error") ? "Fixture recent-history read failed" : null,
            refresh: () => {},
          }}
          open
          projectRailOpen={params.has("wide")}
          compactProjectRail
          titleBarAbove
          sessions={history.filter((row) => row.cwd === projectCwd)}
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
          recentSessions={{ history, live: [] }}
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
          <output aria-label="Created project">{createdProject}</output>
          <output aria-label="Created sessions">{createCount}</output>
          <output aria-label="Pin operations">{pinCount}</output>
        </main>
      </div>
    </QueryClientProvider>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
