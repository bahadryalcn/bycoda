// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { newTab, splitPane } from "../../workspace/model/layout";
import { findRemoteSessionTab, resolveRemoteSessionTarget } from "./remoteSessionNavigation";

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

it("resolves a session still being created to the shell creating it", () => {
  const project = "remote://pc/G:/web-portal";
  const creating = newSession("codex", project);
  const other = newSession("codex", project);
  const tabs = [newTab(other.id), newTab(creating.id)];
  const sessions = [other, creating];
  const unbound = () => undefined;
  const createShellFor = (id: string, sameProject: (path: string) => boolean) =>
    id === "new-host" && sameProject(project) ? creating.id : undefined;
  expect(
    resolveRemoteSessionTarget(tabs, sessions, project, "new-host", unbound, createShellFor),
  ).toEqual({ tab: tabs[1], shellId: creating.id });
  expect(
    resolveRemoteSessionTarget(tabs, sessions, project, "unrelated", unbound, createShellFor),
  ).toBeUndefined();
  // A creating shell that is no longer open here resolves to nothing.
  expect(
    resolveRemoteSessionTarget(
      tabs.slice(0, 1),
      sessions,
      project,
      "new-host",
      unbound,
      createShellFor,
    ),
  ).toBeUndefined();
});

it("prefers the tab bound to the session over a creating shell", () => {
  const project = "remote://pc/G:/web-portal";
  const bound = newSession("codex", project);
  const creating = newSession("codex", project);
  const tabs = [newTab(bound.id), newTab(creating.id)];
  expect(
    resolveRemoteSessionTarget(
      tabs,
      [bound, creating],
      project,
      "host",
      (id) => (id === bound.id ? "host" : undefined),
      () => creating.id,
    ),
  ).toEqual({ tab: tabs[0], shellId: bound.id });
});
