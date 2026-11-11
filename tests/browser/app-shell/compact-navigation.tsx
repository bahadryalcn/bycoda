import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../../../src/app/shell/Sidebar";
import { SessionRecoveryControl } from "../../../src/app/shell/SessionRecoveryControl";
import { Badge } from "../../../src/shared/ui/Badge";
import { SearchView } from "../../../src/features/search/ui/SearchView";
import type { SearchRequest } from "../../../src/features/search/model/appSearch";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../../src/features/projects/model/projectGroups";
import { languageReady } from "../../../src/shared/i18n";
import { Button } from "../../../src/shared/ui/Button";
import { TextareaField } from "../../../src/shared/ui/TextareaField";
import { setComposerDraft } from "../../../src/features/sessions/model/draftCache";
import { savePinnedProjects } from "../../../src/features/projects/model/recents";
import { setLinkedGroupStatus } from "../../../src/features/projects/model/linkedWorkspace";
import type { LiveAgent } from "../../../src/features/sessions/model/liveAgents";
import "./compact-navigation.css";

// Browser-local fixture only. Actions record selections; no Host, filesystem or provider writes.
const railPolish = new URLSearchParams(location.search).has("railPolish");
const projects = [
  "/fixture/bycoda",
  "/fixture/mobile",
  "/fixture/service",
  ...(railPolish ? ["/fixture/workspace", "/fixture/workspace/core"] : []),
];
if (new URLSearchParams(location.search).has("railPolish")) savePinnedProjects([projects[2]]);
saveProjectGroups([
  { id: "product", name: "Product team", collapsed: false },
  ...(railPolish
    ? [
        {
          id: "workspace",
          name: "Linked workspace",
          collapsed: false,
          workspaceFile: "/fixture/workspace/project.code-workspace",
          workspaceFolders: ["/fixture/workspace/core"],
        },
      ]
    : []),
]);
saveProjectGroupAssignments({
  "/fixture/bycoda": "product",
  "/fixture/mobile": "product",
  ...(railPolish
    ? { "/fixture/workspace": "product", "/fixture/workspace/core": "workspace" }
    : {}),
});
if (railPolish)
  setLinkedGroupStatus("workspace", {
    state: "missing",
    message: "Workspace file not found or unreadable: /fixture/workspace/project.code-workspace",
  });
const history = Array.from({ length: 9 }, (_, index) => ({
  id: `discussion-${index}`,
  cwd: projects[0],
  harness: "codex" as const,
  model: "gpt-6.1",
  runtimeMode: "supervised" as const,
  title:
    index === 0
      ? "Review compact navigation and unified search"
      : `Product discussion ${index + 1}`,
  createdAt: Date.now() - index * 60_000,
  updatedAt: Date.now() - index * 60_000,
  // Deliberately distinct from the synchronization stamp for detail-card checks.
  ...(new URLSearchParams(location.search).has("activityDate")
    ? { lastActivityAt: new Date(2026, 9, 17, 15, 37).getTime() - index * 60_000 }
    : {}),
}));
// ?draft=1 leaves unsent composer text in a listed, idle discussion.
if (new URLSearchParams(location.search).has("draft"))
  setComposerDraft(history[7].id, "Unsent follow-up");
const attentionCase = new URLSearchParams(location.search).get("attention") ?? "failed";
const railAgents: LiveAgent[] = railPolish
  ? [
      {
        id: "running",
        cwd: projects[0],
        title: "Implement sidebar alignment",
        harness: "codex",
        activity: "Editing",
        needsApproval: false,
        done: false,
      },
      {
        id: "attention",
        cwd: projects[0],
        title: "Review interrupted work",
        harness: "codex",
        activity: "Needs review",
        needsApproval: attentionCase === "warning",
        done: false,
        ...(attentionCase === "warning" ? {} : { issue: "failed" as const }),
      },
      ...(attentionCase === "multiple"
        ? [
            {
              id: "approval",
              cwd: projects[0],
              title: "Approve next step",
              harness: "codex" as const,
              activity: "Needs permission",
              needsApproval: true,
              done: false,
            },
          ]
        : []),
    ]
  : [];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const badgeCount = Number(new URLSearchParams(location.search).get("badgeCount"));
const expandedRail = new URLSearchParams(location.search).has("expandedRail");
const headerNavigation = new URLSearchParams(location.search).has("headerNavigation");
const projectHeader = new URLSearchParams(location.search).has("projectHeader");

function Fixture() {
  const [cwd, setCwd] = useState(projects[0]);
  const [tab, setTab] = useState<ComponentProps<typeof Sidebar>["tab"]>("sessions");
  const [selected, setSelected] = useState("");
  const [projectToggleCount, setProjectToggleCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [request, setRequest] = useState<SearchRequest>();
  const [sidebarOpen, setSidebarOpen] = useState(
    !new URLSearchParams(location.search).has("closed"),
  );
  const [view, setView] = useState("workspace");
  const openSearch = () => {
    setRequest(undefined);
    setSearchOpen(true);
  };
  return (
    <QueryClientProvider client={client}>
      <div className="flex h-dvh min-w-0 overflow-hidden bg-background-base text-content">
        <Sidebar
          cwd={cwd}
          open={sidebarOpen}
          projectRailOpen={expandedRail}
          compactProjectRail
          titleBarAbove={!headerNavigation}
          lastSessionsOpen={headerNavigation && !projectHeader}
          canGoBack={headerNavigation}
          canGoForward={headerNavigation}
          onGoForward={() => setSelected("Forward")}
          sessions={history}
          liveAgents={railAgents}
          recentSessions={
            railPolish
              ? {
                  history,
                  live: history.map((session) => ({
                    ...session,
                    status: "done" as const,
                    activityAt: session.updatedAt,
                  })),
                }
              : undefined
          }
          busySessionIds={new Set(history.slice(0, badgeCount || 6).map((session) => session.id))}
          recoveryControl={
            badgeCount ? (
              <SessionRecoveryControl
                count={badgeCount}
                onOpen={() => setSelected("Recovered sessions")}
              />
            ) : undefined
          }
          approvalSessionIds={new Set()}
          activeSessionId={history[0].id}
          status="idle"
          pending={false}
          onSelectSession={setSelected}
          onOpenFile={async () => {}}
          tab={tab}
          onTabChange={setTab}
          filesSearchOpen={false}
          onFilesSearchOpenChange={() => {}}
          recents={projects.map((path) => ({ path, openedAt: 1 }))}
          onSelectProject={setCwd}
          onOpenProject={() => setSelected("Add project")}
          onToggleProjectRail={() => {
            setSelected("Expand projects");
            setProjectToggleCount((count) => count + 1);
          }}
          onOpenLastSessions={() => setSelected("Last sessions")}
          onShowWorkspace={() => setView("workspace")}
          onOpenCrewSession={() => setSelected("Crew")}
          onSearch={openSearch}
          onSearchConversations={(query) => {
            setRequest({ scope: "conversations", conversationScope: "project", query });
            setSearchOpen(true);
          }}
          onOpenInbox={() => {
            setSelected("Inbox");
            setView("inbox");
          }}
          inboxActive={view === "inbox"}
          onGoBack={() => {
            if (headerNavigation) setSelected("Back");
            else setView("workspace");
          }}
          onOpenNotes={() => setSelected("Notes")}
          onOpenServers={() => setSelected("Servers")}
          onOpenTasks={() => setSelected("Tasks")}
          onOpenAutomations={() => setSelected("Automations")}
          notesEnabled
          onOpenSettings={() => setSelected("Settings")}
          onSelectSettingsSection={(section) => setSelected(section)}
          onNew={() => setSelected("New session")}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-(--ui-surface)">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-4">
            <span className="min-w-0 flex-1 truncate text-ui-body">
              Review workspace navigation
            </span>
            <Button variant="ghost" motion="none" onClick={() => setSidebarOpen((open) => !open)}>
              {sidebarOpen ? "Hide session list" : "Pin session list"}
            </Button>
          </div>
          <div className="fixture-conversation flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
            {badgeCount ? (
              <div aria-label="Representative shared badges" className="flex items-center gap-2">
                <Badge tone="info" data-testid="info-label">
                  Information
                </Badge>
                <Badge variant="count" data-testid="neutral-count">
                  128
                </Badge>
              </div>
            ) : null}
            <article className="ml-auto max-w-prose rounded-(--ui-radius-control) bg-(--ui-surface-raised) p-4">
              <p className="text-ui-body">
                Keep Sessions, Explorer and Changes where they are. Make project and tool navigation
                easier to understand.
              </p>
            </article>
            <article className="max-w-prose space-y-3 text-ui-body leading-relaxed">
              <p className="font-medium">A familiar workspace with less repetition.</p>
              <p>
                The three workspace tabs stay together above the session list. Projects and groups
                open from one place, while frequently used actions remain easy to reach.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Sessions, Explorer and Changes remain in the horizontal row.</li>
                <li>Project navigation opens beside the compact rail.</li>
                <li>Search uses one screen with a clear project scope.</li>
              </ul>
            </article>
          </div>
          <div className="fixture-conversation shrink-0 p-4">
            <TextareaField aria-label="Sample message" placeholder="Write a message…" rows={3} />
          </div>
          <output aria-label="Selected action" className="sr-only">
            {selected}
          </output>
          <output aria-label="Project panel toggle count" className="sr-only">
            {projectToggleCount}
          </output>
        </main>
        {searchOpen && (
          <SearchView
            open
            presentation="dialog"
            cwd={cwd}
            request={request}
            recents={projects.map((path) => ({ path, openedAt: 1 }))}
            history={history}
            sessions={[]}
            onClose={() => setSearchOpen(false)}
            onOpenFile={async () => {}}
            onOpenSession={setSelected}
            onOpenProject={setCwd}
          />
        )}
      </div>
    </QueryClientProvider>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
