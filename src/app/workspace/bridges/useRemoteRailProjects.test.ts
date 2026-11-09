// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import type { RemoteRailSession } from "../../../features/connections/model/remoteRailSessions";
import {
  beginRemoteCreate,
  endRemoteCreate,
  resetRemoteCreateIntentsForTests,
} from "../../../features/connections/model/remoteCreateIntent";
import { rememberRemoteSession } from "../../../features/connections/model/connections";
import { useRemoteRailProjects, type RemoteRailProjects } from "./useRemoteRailProjects";

const project = "remote://env/home/me/repo";
const listed: RemoteRailSession[] = ["known", "mine"].map((id) => ({
  project,
  fresh: true,
  session: {
    id,
    projectId: "project",
    revision: 1,
    status: "running",
    updatedAt: 10,
    title: id,
    harness: "claude",
  },
}));

vi.mock("../../../features/connections/model/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/connections/model/connections")>()),
  useRemoteRailSessions: () => listed,
}));

afterEach(() => {
  resetRemoteCreateIntentsForTests();
  localStorage.clear();
});

async function mount(sessions: Session[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let current!: RemoteRailProjects;
  function Harness() {
    current = useRemoteRailProjects({
      visibleRecents: [{ path: project }],
      sessionRecovery: null,
      lockSnapshot: {} as never,
      sessions,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  return {
    result: () => current,
    unmount: () => act(async () => root.unmount()),
  };
}

it("counts a bound remote shell as open even with an empty transcript, as bindings change", async () => {
  const shell = newSession("claude", project);
  const view = await mount([shell]);
  expect(view.result().unopenedRemote.map(({ session }) => session.id)).toEqual(["known", "mine"]);
  await act(async () => rememberRemoteSession(shell.id, "known"));
  expect([...view.result().loadedRemoteHostIds]).toEqual(["known"]);
  expect(view.result().unopenedRemote.map(({ session }) => session.id)).toEqual(["mine"]);
  await view.unmount();
});

it("keeps the session a shell is creating off the rail until the create ends", async () => {
  const shell = newSession("claude", project);
  const view = await mount([shell]);
  let intent!: ReturnType<typeof beginRemoteCreate>;
  await act(async () => {
    intent = beginRemoteCreate(shell.id, project, "env", ["known"]);
  });
  expect(view.result().unopenedRemote.map(({ session }) => session.id)).toEqual(["known"]);
  await act(async () => {
    rememberRemoteSession(shell.id, "mine");
    endRemoteCreate(shell.id, intent);
  });
  expect(view.result().unopenedRemote.map(({ session }) => session.id)).toEqual(["known"]);
  await view.unmount();
});
