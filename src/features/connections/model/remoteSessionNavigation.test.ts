// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { newTab, splitPane } from "../../workspace/model/layout";
import { findRemoteSessionTab } from "./remoteSessionNavigation";

it("does not reopen a same-ID session from another project or machine", () => {
  const target = "remote://pc/G:/web-portal";
  const wrongProject = newSession("codex", "remote://pc/G:/db-ai-assistant");
  const wrongMachine = newSession("codex", "remote://mac/G:/web-portal");
  const wanted = newSession("codex", target);
  const tabs = [wrongProject, wrongMachine, wanted].map((session) => newTab(session.id));
  const bindings = () => "host-session";
  expect(
    findRemoteSessionTab(
      tabs,
      [wrongProject, wrongMachine, wanted],
      target,
      "host-session",
      bindings,
    ),
  ).toEqual({ tab: tabs[2], shellId: wanted.id });
  expect(
    findRemoteSessionTab(
      tabs.slice(0, 2),
      [wrongProject, wrongMachine],
      target,
      "host-session",
      bindings,
    ),
  ).toBeUndefined();
});

it("finds the selected conversation in a split pane", () => {
  const other = newSession("codex", "remote://pc/G:/db-ai-assistant");
  const wanted = newSession("codex", "remote://pc/G:/web-portal");
  const tab = newTab(other.id);
  tab.layout = splitPane(tab.layout, other.id, "right", wanted.id);
  expect(
    findRemoteSessionTab([tab], [other, wanted], wanted.cwd, "wanted", (id) =>
      id === wanted.id ? "wanted" : "other",
    ),
  ).toEqual({ tab, shellId: wanted.id });
});
