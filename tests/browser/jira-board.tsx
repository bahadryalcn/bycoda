import { useState } from "react";
import { createRoot } from "react-dom/client";
import { JiraBoardView } from "../../src/features/inbox/ui/JiraBoardView";
import type { JiraBoardIssue } from "../../src/features/inbox/model/jiraBoard";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

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
  assignees: [{ login: "Ada" }],
  draft: false,
  repo: "ENG",
  teamId: "1",
  teamName: "Engineering",
  projectPath: "",
});
const issues = [
  issue("ENG-1", "Support Jira board management", "1"),
  issue("ENG-2", "Review authentication flow", "3"),
  issue("ENG-3", "Prepare the next release", "1"),
];
const membership = new Map([
  ["ENG-1", "backlog"],
  ["ENG-2", "sprint:21"],
  ["ENG-3", "backlog"],
]);
Object.assign(window, {
  jiraFixtureCalls: calls,
  jiraFixtureFail: () => {
    fail = true;
  },
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "jira_list_boards")
        return [{ id: 7, name: "Engineering board", kind: "scrum" }];
      if (command === "jira_board_configuration")
        return {
          columns: [
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
            issues.filter((i) => scope === "board" || membership.get(i.identifier) === scope),
          ),
          nextPageToken: null,
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
createRoot(document.getElementById("root")!).render(<Fixture />);
