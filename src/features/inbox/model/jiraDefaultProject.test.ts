import { describe, expect, it } from "vitest";
import { resolveJiraDefaultProject, type JiraDefaultProjects } from "./jiraDefaultProject";

const issue = { url: "https://example.atlassian.net/browse/ENG-1", teamId: "100", jiraBoardId: 7 };
const defaults: JiraDefaultProjects = {
  global: "/global",
  projects: { "100": "/project" },
  boards: { "7": "/board" },
  issues: { [issue.url]: "/explicit" },
};

describe("Jira working folder precedence", () => {
  it("keeps explicit issue choices above every default and supplied folder", () => {
    expect(
      resolveJiraDefaultProject({ ...issue, projectPath: "/existing" }, defaults, "/current"),
    ).toBe("/explicit");
    expect(
      resolveJiraDefaultProject(
        { ...issue, projectPath: "/existing" },
        { ...defaults, issues: {} },
        "/current",
      ),
    ).toBe("/existing");
  });
  it("uses board, project, global, then current behavior", () => {
    expect(resolveJiraDefaultProject(issue, { ...defaults, issues: {} }, "/current")).toBe(
      "/board",
    );
    expect(
      resolveJiraDefaultProject(
        { ...issue, jiraBoardId: undefined },
        { ...defaults, issues: {} },
        "/current",
      ),
    ).toBe("/project");
    expect(
      resolveJiraDefaultProject(
        issue,
        { ...defaults, issues: {}, boards: {}, projects: {} },
        "/current",
      ),
    ).toBe("/global");
    expect(
      resolveJiraDefaultProject(
        issue,
        { global: "", issues: {}, boards: {}, projects: {} },
        "/current",
      ),
    ).toBe("/current");
  });
  it("does not reuse another issue's choice or a board default in list view", () => {
    expect(
      resolveJiraDefaultProject(
        { url: "https://other.atlassian.net/browse/ENG-1" },
        defaults,
        "/current",
      ),
    ).toBe("/global");
    expect(
      resolveJiraDefaultProject(
        { ...issue, jiraBoardId: undefined },
        { ...defaults, issues: {} },
        "/current",
      ),
    ).toBe("/project");
  });
});
