import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { SearchView } from "../../src/features/search/ui/SearchView";
import type { SearchRequest } from "../../src/features/search/model/appSearch";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../src/features/projects/model/projectGroups";
import { languageReady } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import "./compact-navigation.css";

// Browser-local fixture only. Actions record selections; no Host, filesystem or provider writes.
const projects = ["/fixture/bycoda", "/fixture/mobile", "/fixture/service"];
saveProjectGroups([{ id: "product", name: "Product team", collapsed: false }]);
saveProjectGroupAssignments({ "/fixture/bycoda": "product", "/fixture/mobile": "product" });
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
}));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Fixture() {
  const [cwd, setCwd] = useState(projects[0]);
  const [tab, setTab] = useState<ComponentProps<typeof Sidebar>["tab"]>("sessions");
  const [selected, setSelected] = useState("");
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
          projectRailOpen={false}
          compactProjectRail
          titleBarAbove
          sessions={history}
          busySessionIds={new Set(history.slice(0, 6).map((session) => session.id))}
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
          onToggleProjectRail={() => setSelected("Expand projects")}
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
          onGoBack={() => setView("workspace")}
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
