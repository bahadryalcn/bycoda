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
  const openSearch = () => {
    setRequest(undefined);
    setSearchOpen(true);
  };
  return (
    <QueryClientProvider client={client}>
      <div className="flex h-dvh min-w-0 overflow-hidden bg-background-base text-content">
        <Sidebar
          cwd={cwd}
          open
          projectRailOpen={false}
          compactProjectRail
          titleBarAbove
          sessions={history}
          busySessionIds={new Set()}
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
          onOpenInbox={() => setSelected("Inbox")}
          onOpenNotes={() => setSelected("Notes")}
          onOpenServers={() => setSelected("Servers")}
          onOpenTasks={() => setSelected("Tasks")}
          onOpenAutomations={() => setSelected("Automations")}
          notesEnabled
          onOpenSettings={() => setSelected("Settings")}
          onNew={() => setSelected("New session")}
        />
        <main className="min-w-0 flex-1 overflow-auto p-3">
          <output aria-label="Selected action">{selected}</output>
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
