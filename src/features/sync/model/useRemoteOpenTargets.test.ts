// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  remoteOpenMatch,
  remoteOpenMatchIn,
  setRemoteOpenTargets,
  useRemoteOpenTargets,
  type RemoteOpenTarget,
} from "./syncRemoteProjects";
import type { RemoteOnlyProject } from "./syncProjects";

const target = (environmentId: string): RemoteOpenTarget => ({
  environmentId,
  name: environmentId,
  request: async () => undefined,
});

it("re-renders on replacement, keeps its snapshot otherwise, and the variant matches", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const seen: (readonly RemoteOpenTarget[])[] = [];
  function Probe() {
    seen.push(useRemoteOpenTargets());
    return null;
  }
  act(() => root.render(createElement(Probe)));
  const first = seen[seen.length - 1];
  act(() => root.render(createElement(Probe)));
  expect(seen[seen.length - 1]).toBe(first);

  const next = [target("env-1")];
  act(() => setRemoteOpenTargets(next));
  expect(seen[seen.length - 1]).toBe(next);

  const project = { path: "/p", hostEnvironmentId: "env-1" } as RemoteOnlyProject;
  expect(remoteOpenMatchIn(project, next)).toEqual(remoteOpenMatch(project));
  expect(remoteOpenMatchIn(project, next)?.path).toBe("/p");
  act(() => setRemoteOpenTargets([]));
  act(() => root.unmount());
});
