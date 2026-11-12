import { describe, expect, it } from "vitest";
import { workItemMentionMeta } from "./ComposerWorkItemMentionRow";
import type { WorkItemMentionTarget } from "../model/workItemMentionRows";
import type { InboxItem } from "../../inbox/public/workItemMentions";

describe("work item ownership meta", () => {
  const target = (assignees: InboxItem["assignees"]): WorkItemMentionTarget => ({
    kind: "item",
    provider: "jira",
    token: "jira:PROJ-91",
    item: {
      provider: "jira",
      kind: "jira",
      identifier: "PROJ-91",
      number: 91,
      title: "Login bug",
      state: "In Progress",
      repo: "PROJ",
      assignees,
      url: "",
      updatedAt: "",
      labels: [],
      draft: false,
      projectPath: "",
    },
  });
  it("uses the Inbox display names and preserves non-ASCII text", () => {
    expect(
      workItemMentionMeta(target([{ login: "Ayşe Yılmaz" }, { login: "王明" }]), "Atanmamış"),
    ).toBe("Ayşe Yılmaz, 王明 · In Progress · PROJ");
  });
  it("localizes unassigned ownership", () => {
    expect(workItemMentionMeta(target([]), "Atanmamış")).toBe("Atanmamış · In Progress · PROJ");
  });
});
