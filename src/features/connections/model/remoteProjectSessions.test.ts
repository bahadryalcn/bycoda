// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useRemoteProjectSessions } from "./connections";
import { rememberRemoteProject } from "./remoteProjects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));

it("never renders the previous project's session cards under the new project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const portal = rememberRemoteProject("env", {
    id: "portal",
    cwd: "G:/web-portal",
    name: "portal",
  });
  const db = rememberRemoteProject("env", { id: "db", cwd: "G:/db-ai-assistant", name: "db" });
  for (const project of [portal, db]) {
    localStorage.setItem(
      `bycoda.remote-history.v2:${project.key}`,
      JSON.stringify([{ id: `${project.projectId}-session` }]),
    );
  }
  const frames: { project: string; ids: string[] }[] = [];
  function View({ project }: { project: string }) {
    const result = useRemoteProjectSessions(project);
    frames.push({ project, ids: result.sessions.map((session) => session.id) });
    return null;
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(View, { project: db.key })));
    await act(async () => root.render(createElement(View, { project: portal.key })));
    const portalFrames = frames.filter((frame) => frame.project === portal.key);
    expect(portalFrames.length).toBeGreaterThan(0);
    for (const frame of portalFrames) expect(frame.ids).toEqual(["portal-session"]);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
