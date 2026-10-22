import { useState } from "react";
import { SessionPreviewFixture } from "./session-preview";
import { createRoot } from "react-dom/client";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { SourceControl } from "../../src/features/source-control/ui/SourceControl";
import { UsageFooter } from "../../src/app/shell/UsageFooter";
import { SessionRecoveryControl } from "../../src/app/shell/SessionRecoveryControl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderRateLimits } from "../../src/features/providers/model/rateLimits";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import { InboxView } from "../../src/features/inbox/ui/InboxView";
import { saveInboxConnections, saveInboxSource } from "../../src/features/inbox/model/inboxFilters";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../src/features/projects/model/projectGroups";
import { savePinnedProjects } from "../../src/features/projects/model/recents";
import { languageReady } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import "./w7-shell.css";

// Exercise the production rail without changing a real repository or session.
saveProjectGroups([
  {
    id: "wallet",
    name: "wallet",
    collapsed: false,
    workspaceFile: "G:/wallet/wallet.code-workspace",
    workspaceFolders: ["G:/wallet/api", "G:/wallet/mobile"],
  },
  { id: "team", name: "Team", collapsed: false },
]);
saveProjectGroupAssignments({
  "g:/wallet/api": "wallet",
  "g:/wallet/mobile": "wallet",
  "g:/team/service": "team",
});
savePinnedProjects(["G:/wallet"]);
const layoutClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const layoutNow = Date.now();
for (const provider of ["claude", "codex"] as const) {
  const limits: ProviderRateLimits = {
    provider,
    session: { usedPercent: 24, windowMinutes: 300, resetsAt: layoutNow + 3_600_000 },
    weekly: { usedPercent: 39, windowMinutes: 10080, resetsAt: layoutNow + 86_400_000 },
    monthly: null,
    updatedAt: layoutNow,
    error: null,
    status: "ok",
  };
  layoutClient.setQueryData(["rate-limits", provider, "default"], limits);
  setCachedRateLimits(provider, "default", limits);
}

function ShellLayoutFixture() {
  const [selected, setSelected] = useState("");
  return (
    <QueryClientProvider client={layoutClient}>
      <div className="flex h-dvh min-w-0 flex-col bg-background-base text-content">
        <div className="flex min-h-0 flex-1">
          <ProjectRail
            visible
            cwd="G:/wallet/api"
            recents={Array.from({ length: 18 }, (_, index) => ({
              path: `G:/project-${index}`,
              openedAt: 1,
            }))}
            onSelectProject={setSelected}
            onOpenProject={() => {}}
            onSelectAgent={setSelected}
            notesEnabled
            recentSessions={{
              history: [],
              live: Array.from({ length: 8 }, (_, index) => ({
                id: `recent-${index}`,
                cwd: "G:/wallet/api",
                title: `Recent workspace discussion ${index + 1}`,
                harness: "codex",
                model: "gpt-6.1",
                status: "done",
                activityAt: layoutNow - index * 60_000,
              })),
              onPin: async () => {},
            }}
            recoveryControl={
              <SessionRecoveryControl count={16} onOpen={() => setSelected("recovery")} />
            }
            liveAgents={Array.from({ length: 8 }, (_, index) => ({
              id: `live-${index}`,
              cwd: "G:/wallet/api",
              title: `Improve the shared interface and preserve long session titles ${index + 1}`,
              harness: index % 2 === 0 ? "codex" : "claude",
              activity:
                index >= 6
                  ? "Done"
                  : index === 1
                    ? "Need approval"
                    : "pnpm exec playwright test --project chromium --reporter=list",
              startedAt: layoutNow - 220_000 - index * 15_000,
              needsApproval: index === 1,
              done: index >= 6,
            }))}
          />
          <main className="min-w-0 flex-1 p-4">
            <output aria-label="Selected live session">{selected}</output>
          </main>
        </div>
        <UsageFooter
          providers={["claude", "codex"]}
          onNewTerminal={() => setSelected("terminal")}
        />
      </div>
    </QueryClientProvider>
  );
}

function InboxLayoutFixture() {
  const review = new URL(location.href).searchParams.has("inbox-review");
  const [visible, setVisible] = useState(true);
  return (
    <QueryClientProvider client={layoutClient}>
      <div className="flex h-dvh min-w-0 flex-col bg-background-base text-content">
        {review ? (
          <Button variant="ghost" onClick={() => setVisible(!visible)}>
            {visible ? "Leave Inbox" : "Return to Inbox"}
          </Button>
        ) : null}
        {visible ? (
          <InboxView
            pullRequestsOnly={review}
            cwd="G:/wallet/api"
            recents={[{ path: "G:/wallet/api", openedAt: 1 }]}
            onAsk={async () => ""}
            onAskRestart={async () => ""}
            onAskMount={() => {}}
            onOpenIntegrations={() => {}}
          />
        ) : null}
      </div>
    </QueryClientProvider>
  );
}

function Fixture() {
  const worktreesDemo = new URL(window.location.href).searchParams.has("worktrees");
  const [cwd, setCwd] = useState("G:/wallet/api");
  const [review, setReview] = useState("");
  const [renamedFolder, setRenamedFolder] = useState("");
  return (
    <div className="flex h-screen bg-background-base text-content">
      <ProjectRail
        visible={!worktreesDemo}
        cwd={cwd}
        recents={["G:/wallet", "G:/wallet/api", "G:/wallet/mobile", "G:/team/service"].map(
          (path) => ({ path, openedAt: 1 }),
        )}
        onSelectProject={setCwd}
        onOpenProject={() => {}}
        onRenameProjectFolder={async (path, name) => {
          setRenamedFolder(`${path}:${name}`);
        }}
      />
      <div
        className={
          worktreesDemo
            ? "flex h-full min-w-0 flex-1 flex-col"
            : "flex h-full w-[520px] min-w-0 flex-col border-e border-stroke"
        }
      >
        <output aria-label="Selected project" className="p-3">
          {cwd}
        </output>
        <SourceControl
          cwd={cwd}
          enabled
          repositoryPaths={cwd === "G:/wallet" ? ["G:/wallet/api", "G:/wallet/mobile"] : undefined}
          onOpenRepository={(request) =>
            setReview(
              `${request.type}:${request.cwd}:${"path" in request ? (request.path ?? "all") : request.commit.sha}`,
            )
          }
          onOpenFile={() => {}}
          onOpenAllChanges={() => {}}
          onOpenCommit={() => {}}
        />
      </div>
      <output aria-label="Selected review" className={worktreesDemo ? "sr-only" : "p-3"}>
        {review}
      </output>
      <output aria-label="Renamed folder">{renamedFolder}</output>
    </div>
  );
}
await languageReady;
if (new URL(location.href).searchParams.has("inbox-review")) {
  localStorage.setItem("bycoda.inboxSeen", JSON.stringify({ seeded: true, items: {} }));
  saveInboxConnections({
    github: true,
    linear: false,
    jira: false,
    gitlab: false,
    azuredevops: false,
  });
  saveInboxSource("github");
}
if (new URL(location.href).searchParams.has("inbox-layout")) {
  saveInboxConnections({
    github: false,
    linear: false,
    jira: true,
    gitlab: false,
    azuredevops: false,
  });
  saveInboxSource("jira");
}
createRoot(document.getElementById("root")!).render(
  new URL(location.href).searchParams.has("session-preview") ? (
    <SessionPreviewFixture />
  ) : new URL(location.href).searchParams.has("inbox-layout") ||
    new URL(location.href).searchParams.has("inbox-review") ? (
    <InboxLayoutFixture />
  ) : new URL(location.href).searchParams.has("layout") ? (
    <ShellLayoutFixture />
  ) : (
    <Fixture />
  ),
);
