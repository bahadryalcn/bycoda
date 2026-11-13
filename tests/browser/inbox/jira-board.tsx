import { InboxPrChecks } from "../../../src/features/inbox/ui/InboxPrChecks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxView } from "../../../src/features/inbox/ui/InboxView";
import { InboxPrChangesGlance } from "../../../src/features/inbox/ui/InboxPrOverview";
import { InboxComments } from "../../../src/features/inbox/ui/InboxComments";
import { CheckEvidence } from "../../../src/features/inbox/ui/CheckEvidence";
import { LinkedWorkItemUpdateNotice } from "../../../src/features/inbox/ui/LinkedWorkItemUpdateNotice";
import { inboxLabelItems } from "../../../src/features/inbox/ui/InboxPresentation";
import { BadgeList } from "../../../src/shared/ui/BadgeList";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { JiraBoardView } from "../../../src/features/inbox/ui/JiraBoardView";
import { GithubPrActions } from "../../../src/features/inbox/ui/InboxPrActions";
import { InboxFiltersMenu } from "../../../src/features/inbox/ui/InboxFiltersMenu";
import { DEFAULT_INBOX_FILTERS } from "../../../src/features/inbox/model/inboxFilters";
import type { InboxItem } from "../../../src/features/inbox/model/githubTasks";
import { Button } from "../../../src/shared/ui/Button";
import type { JiraBoardIssue } from "../../../src/features/inbox/model/jiraBoard";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

// Offline fixture: no live Jira credentials, requests or mutations.
localStorage.setItem("bycoda.jiraAllowedBoards", "[7]");
localStorage.removeItem("bycoda.jiraHiddenProjects");
const calls: { command: string; args: Record<string, unknown> }[] = [];
let fail = false;
const issue = (key: string, title: string, statusId: string): JiraBoardIssue => ({
  provider: "jira",
  kind: "jira",
  id: key,
  identifier: key,
  number: Number(key.split("-")[1]),
  title,
  url: `https://example.atlassian.net/browse/${key}`,
  state: statusId === "1" ? "To Do" : "In Progress",
  statusId,
  stateType: statusId === "1" ? "new" : "indeterminate",
  updatedAt: "",
  labels: [],
  assignees: [
    { login: "Ada Lovelace", accountId: "ada" },
    { login: "Grace Hopper", accountId: "grace" },
  ],
  draft: false,
  repo: "ENG",
  teamId: "1",
  teamName: "Engineering",
  projectPath: "",
});
const seedIssues = [
  issue("ENG-1", "Support Jira board management", "1"),
  issue("ENG-2", "Review authentication flow", "3"),
  issue("ENG-3", "Prepare the next release", "1"),
];
const dense = new URLSearchParams(location.search).has("dense");
const issues = dense
  ? Array.from({ length: 80 }, (_, index) =>
      issue(
        `ENG-${index + 1}`,
        index % 3 === 0
          ? "[UI/UX] Tekrarlı Ödeme Oluştur penceresinde oluşturma işlemi"
          : `Review payment integration ${index + 1}`,
        ["1", "2", "3", "4", "5", "6", "7", "9"][index % 8]!,
      ),
    )
  : seedIssues;
const pullRequest = {
  ...issues[0],
  provider: "github",
  kind: "pr",
  id: "fixture-pr",
  number: 12,
  repo: "fixture/repository",
  projectPath: "C:/fixture/project",
  state: "open",
  draft: false,
} as InboxItem;
const filterWrites: string[][] = [];
const membership = new Map([
  ["ENG-1", "backlog"],
  ["ENG-2", "sprint:21"],
  ["ENG-3", "backlog"],
]);
Object.assign(window, {
  jiraFixtureCalls: calls,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  inboxFixtureFilterWrites: filterWrites,
  jiraFixtureFail: () => {
    fail = true;
  },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    convertFileSrc: (path: string) => path,
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "git_commit_file_diff")
        return {
          current: "const first = 1;\nexpect(first).toBe(2);\nfinish();",
          original: "",
          binary: false,
          tooLarge: false,
        };
      if (command === "git_github_pr_action") return { ...pullRequest, state: "merged" };
      if (command.endsWith("_status"))
        return {
          connected: command === "jira_status",
          site: "https://example.atlassian.net",
          email: "fixture@example.test",
        };
      if (command === "jira_list_projects") return [{ id: "1", key: "ENG", name: "Engineering" }];
      if (command === "jira_issue_details")
        return {
          body: "## Bulgu\n\nTekrarlı Ödeme Oluştur penceresinde oluşturma işlemi yanıt vermiyor.\n\n| Alan | Değer |\n| --- | --- |\n| Modül | Ödeme İşlemleri |\n| Alt ekran | Tekrarlı Ödemeler |",
          author: "Fixture reporter",
        };
      if (command === "jira_issue_thread")
        return {
          comments: [
            {
              id: "one",
              author: "Fixture reviewer",
              kind: "comment",
              url: "",
              state: "",
              path: "",
              line: null,
              resolved: false,
              threadId: "one",
              replies: [],
              body: "Ready for review.",
              createdAt: "2026-11-12T10:00:00Z",
            },
          ],
          truncated: false,
        };
      if (command === "jira_list_issue_page") {
        const offset = args.nextPageToken ? 40 : 0;
        return {
          issues: structuredClone(issues.slice(offset, offset + 40)),
          nextPageToken: offset === 0 && dense ? "second" : null,
          total: issues.length,
        };
      }
      if (command === "jira_list_boards")
        return [{ id: 7, name: "Engineering board", kind: "scrum" }];
      if (command === "jira_board_configuration")
        return {
          columns: dense
            ? [
                "Pending",
                "On hold",
                "Development in progress",
                "Ready to test",
                "Test",
                "Test approved",
                "Release candidate",
                "Released",
              ].map((name, index) => ({
                name,
                statusIds: [["1", "2", "3", "4", "5", "6", "7", "9"][index]!],
              }))
            : [
                { name: "To Do", statusIds: ["1"] },
                { name: "In Progress", statusIds: ["3"] },
                { name: "Done", statusIds: ["9"] },
              ],
          rankFieldId: 10,
          sprints: [
            { id: 21, name: "Sprint 21", state: "active", goal: "Ship the board experience" },
            { id: 22, name: "Sprint 22", state: "future", goal: "" },
          ],
        };
      if (command === "jira_board_issues") {
        const scope = args.scope === "sprint" ? `sprint:${args.sprintId}` : String(args.scope);
        return {
          issues: structuredClone(
            issues
              .filter((i) => scope === "board" || membership.get(i.identifier) === scope)
              .slice(args.nextPageToken ? 40 : 0, args.nextPageToken ? 80 : dense ? 40 : undefined),
          ),
          nextPageToken: dense && !args.nextPageToken && scope === "board" ? "second" : null,
        };
      }
      if (command === "jira_issue_transitions")
        return [
          { id: "31", name: "Start work", statusId: "3", requiresFields: false },
          { id: "91", name: "Complete", statusId: "9", requiresFields: false },
        ];
      if (command === "jira_issue_transition" || command === "jira_board_move") {
        if (fail) {
          fail = false;
          throw new Error("Jira permission denied");
        }
        const selected = issues.find((i) => i.identifier === args.key)!;
        if (command === "jira_issue_transition") {
          selected.statusId = args.transitionId === "31" ? "3" : "9";
          selected.state = selected.statusId === "3" ? "In Progress" : "Done";
        } else if (args.target !== "rank")
          membership.set(
            selected.identifier,
            args.target === "sprint" ? `sprint:${args.sprintId}` : String(args.target),
          );
        if (args.beforeKey || args.afterKey) {
          issues.splice(issues.indexOf(selected), 1);
          const anchor = issues.findIndex(
            (i) => i.identifier === (args.beforeKey || args.afterKey),
          );
          issues.splice(anchor + (args.afterKey ? 1 : 0), 0, selected);
        }
        return null;
      }
      return null;
    },
  },
});
await setLanguagePreference("en");
document.body.style.cssText =
  "height:100vh;margin:0;background:var(--color-background-base);color:var(--color-content)";
function Fixture() {
  const [revision, setRevision] = useState(0);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <JiraBoardView
        revision={revision}
        onSelect={() => {}}
        onChanged={() => setRevision((r) => r + 1)}
      />
    </div>
  );
}
function SharedControlsFixture() {
  const [item, setItem] = useState(pullRequest);
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_INBOX_FILTERS);
  const [hidden, setHidden] = useState(["2", "stale-project"]);
  return (
    <main className="flex min-w-0 flex-wrap items-center gap-2 p-4">
      <GithubPrActions
        item={item}
        baseRef="main"
        headRef="feature"
        reviewedHeadOid={"a".repeat(40)}
        onChange={setItem}
      />
      <Button onClick={() => setOpen((value) => !value)}>Filters</Button>
      {open ? (
        <InboxFiltersMenu
          x={16}
          y={80}
          source="jira"
          items={issues}
          projects={[]}
          linearProjects={[]}
          linearTeams={[]}
          hiddenLinearTeamIds={[]}
          jiraProjects={[
            { id: "1", key: "ENG", name: "Engineering" },
            { id: "2", key: "DOC", name: "Documentation" },
          ]}
          hiddenJiraProjectIds={hidden}
          filters={filters}
          onChange={setFilters}
          onLinearTeamsChange={() => {}}
          onJiraProjectsChange={(ids) => {
            filterWrites.push(ids);
            setHidden(ids);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  );
}
function InboxFixture() {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div className="flex h-dvh min-w-0 flex-col">
        <InboxView
          cwd="G:/fixture/monocode"
          recents={[
            { path: "G:/fixture/monocode", openedAt: 1 },
            { path: "G:/fixture/portal", openedAt: 1 },
          ]}
          onAsk={async () => ""}
          onAskRestart={async () => ""}
          onAskMount={() => {}}
          onOpenIntegrations={() => {}}
          onStart={() => {}}
        />
      </div>
    </QueryClientProvider>
  );
}
const inbox = new URLSearchParams(location.search).has("inbox");
if (inbox) {
  localStorage.setItem("bycoda.inboxSource", "jira");
  localStorage.setItem("bycoda.inboxSeen", JSON.stringify({ seeded: true, items: {} }));
  localStorage.setItem(
    "bycoda.inboxConnections",
    JSON.stringify({ github: false, linear: false, jira: true, gitlab: false, azuredevops: false }),
  );
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("checks-fixture") ? (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <InboxPrChecks
        view={{
          checks: {
            headOid: "abc",
            checks: [
              {
                name: "Build",
                workflow: "CI",
                state: "fail",
                url: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: "Tests",
                workflow: "CI",
                state: "pending",
                url: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: "Lint",
                workflow: "CI",
                state: "pass",
                url: null,
                startedAt: null,
                completedAt: null,
              },
            ],
          },
          loading: false,
          refreshing: false,
          error: null,
          stale: false,
          refresh: () => {},
        }}
        onRefresh={() => {}}
      />
    </main>
  ) : new URLSearchParams(location.search).has("evidence-fixture") ? (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <CheckEvidence
        annotations={[
          { path: "src/example.ts", line: 2, level: "failure", message: "Assertion failed" },
        ]}
        cwd="/repo"
        repo="acme/app"
        headOid={"a".repeat(40)}
      />
      <LinkedWorkItemUpdateNotice
        sessionId="fixture"
        card={{
          kind: "pr",
          repo: "acme/app",
          number: 42,
          title: "Update sidebar activity",
          url: "https://github.com/acme/app/pull/42",
          state: "open",
          since: 1,
          updatedAt: 2,
          status: "ready",
          counts: { comments: 1, reviews: 0, commits: 0 },
          entries: [],
          truncated: false,
        }}
        onAcknowledge={() => {}}
        onDismiss={() => {}}
        onOpenDiscussion={() => {}}
        onAddToChat={() => {}}
      />
    </main>
  ) : new URLSearchParams(location.search).has("timeline-fixture") ? (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <InboxComments
        thread={
          {
            truncated: false,
            comments: [
              {
                id: "c1",
                kind: "comment",
                author: "Maya",
                body: "Review message",
                createdAt: "2026-10-03T09:00:00Z",
                url: "",
                state: "",
                path: "",
                line: null,
                resolved: false,
                replies: [],
              },
            ],
            commits: [
              {
                oid: "abc1234def",
                messageHeadline: "First commit",
                author: "Maya",
                committedDate: "2026-10-03T10:00:00Z",
                url: "https://example.test/commit/first",
              },
              {
                oid: "def5678abc",
                messageHeadline: "Second commit",
                author: "Maya",
                committedDate: "2026-10-03T10:05:00Z",
                url: "",
              },
            ],
          } as never
        }
        loading={false}
        error={null}
        cwd="/repo"
        provider="github"
      />
    </main>
  ) : new URLSearchParams(location.search).has("changes-fixture") ? (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <BadgeList label="Labels" items={inboxLabelItems([{ name: "Bug", color: "ff0000" }])} />
      <InboxPrChangesGlance
        diff={{
          additions: 20,
          deletions: 10,
          files: [
            { path: "src/first.ts", additions: 15, deletions: 5 },
            { path: "src/second.ts", additions: 5, deletions: 5 },
          ],
          patch: "",
          truncated: false,
        }}
        loading={false}
        error={null}
        onOpenFile={() => {}}
      />
    </main>
  ) : inbox ? (
    <InboxFixture />
  ) : new URLSearchParams(location.search).has("uiControls") ? (
    <SharedControlsFixture />
  ) : (
    <Fixture />
  ),
);
